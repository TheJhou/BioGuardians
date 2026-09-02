"""Detection pipeline — orchestrates the full flow:

1. Fetch CBERS-4A WPM satellite image
2. Load and georeference the image
3. Tile and run YOLOv8 detection
4. Classify species for each detection
5. Save detections and occurrences to the database
"""

import logging
import os
from datetime import date
from typing import Optional

import cv2
import numpy as np

from .config import Settings
from .db import Database, DetectionRecord
from .satellite import Cbers4aFetcher, SatelliteImage
from .geo import GeoReference
from .detector import AnimalDetector, Detection
from .classifier import SpeciesClassifier

logger = logging.getLogger(__name__)


class DetectionPipeline:
    """Orchestrates the full satellite detection pipeline."""

    def __init__(
        self,
        settings: Settings,
        db: Database,
        fetcher: Cbers4aFetcher,
        detector: AnimalDetector,
        classifier: SpeciesClassifier,
    ):
        self._settings = settings
        self._db = db
        self._fetcher = fetcher
        self._detector = detector
        self._classifier = classifier

    async def run(
        self,
        job_id: int,
        bbox: str,
        target_date: date,
    ) -> int:
        """Run the full pipeline for a job.

        Args:
            job_id: database job ID
            bbox: "minLng,minLat,maxLng,maxLat"
            target_date: desired satellite image date

        Returns:
            Total number of detections saved.
        """
        try:
            await self._db.update_job_status(job_id, "processando")

            # Step 1: Fetch satellite image
            logger.info("Job %d: fetching CBERS-4A WPM image for bbox=%s date=%s", job_id, bbox, target_date)
            image = self._fetcher.search_and_download(bbox, target_date)
            await self._db.update_job_status(
                job_id,
                "processando",
                scene_id=image.scene_id,
                imagem_url=image.path,
            )

            # Step 2: Load and georeference
            logger.info("Job %d: loading image %s", job_id, image.path)
            geo = GeoReference(image.path)
            geo.load()

            # Step 3: Read image as numpy array (RGB)
            img_array = self._read_image_as_rgb(image.path)
            if img_array is None:
                raise RuntimeError(f"Failed to read image: {image.path}")

            logger.info(
                "Job %d: image loaded %dx%d, running detection",
                job_id,
                img_array.shape[1],
                img_array.shape[0],
            )

            # Step 4: Run YOLOv8 detection (tiled)
            detections = self._detector.detect_image(img_array)
            logger.info("Job %d: %d raw detections", job_id, len(detections))

            # Step 5: Classify and save each detection
            total_saved = 0
            for det in detections:
                saved = await self._process_detection(
                    job_id, det, geo, img_array, image.capture_date
                )
                if saved:
                    total_saved += 1

            # Step 6: Update job status
            await self._db.update_job_status(
                job_id, "concluido", total_deteccoes=total_saved
            )
            logger.info("Job %d: completed with %d detections", job_id, total_saved)
            return total_saved

        except Exception as exc:
            logger.error("Job %d failed: %s", job_id, exc, exc_info=True)
            await self._db.update_job_status(
                job_id, "erro", erro=str(exc)
            )
            raise

    async def _process_detection(
        self,
        job_id: int,
        det: Detection,
        geo: GeoReference,
        img_array: np.ndarray,
        capture_date: date,
    ) -> bool:
        """Process a single detection: classify, save, and create occurrence."""
        # Get center coordinates
        lat, lon = geo.center_latlon(det.bbox_x, det.bbox_y, det.bbox_w, det.bbox_h)

        # Crop the detected region for classification
        crop = self._crop_detection(img_array, det)

        # Classify species via AI (OpenRouter VLM) or heuristic fallback
        result = self._classifier.classify(
            crop=crop,
            coco_class_name=det.class_name,
            lat=lat,
            lon=lon,
            detection_confidence=det.confidence,
        )

        # Determine species_id: find existing or create new if confident enough
        especie_id: Optional[int] = None
        if result.nome_cientifico and result.confidence >= self._settings.species_confidence_threshold:
            categoria = result.categoria_ameaca or "DD"
            especie_id = await self._db.find_or_create_species(
                nome_cientifico=result.nome_cientifico,
                nome_popular=result.nome_popular,
                categoria_ameaca=categoria,
                descricao=result.descricao,
            )

            # Update species info (overwrite descricao, categoria_ameaca, nome_popular)
            await self._db.update_species_info(
                especie_id=especie_id,
                descricao=result.descricao,
                categoria_ameaca=result.categoria_ameaca,
                nome_popular=result.nome_popular,
            )

        # Save detection record
        bbox_pixel = f"{det.bbox_x},{det.bbox_y},{det.bbox_w},{det.bbox_h}"
        det_record = DetectionRecord(
            job_id=job_id,
            especie_id=especie_id,
            nome_cientifico=result.nome_cientifico,
            confianca=result.confidence if result.nome_cientifico else det.confidence,
            lat=lat,
            lon=lon,
            bbox_pixel=bbox_pixel,
            recorte_url=None,
            metodo_classificacao=result.method,
            modelo_ia=self._settings.openrouter_model if result.method == "ai" else None,
            confianca_ia=result.confidence if result.method == "ai" else None,
        )
        await self._db.save_detection(det_record)

        # Create occurrence if species was identified
        if especie_id:
            await self._db.create_occurrence(
                especie_id=especie_id,
                lat=lat,
                lon=lon,
                data_evento=capture_date,
                base_registro=f"CBERS-4A WPM deteccao automatica ({result.method}, confianca: {result.confidence:.2f})",
            )
            logger.info(
                "Job %d: occurrence created for species_id=%d (%s) at (%.4f, %.4f) [%s]",
                job_id, especie_id, result.nome_cientifico, lat, lon, result.method,
            )

        return True

    def _read_image_as_rgb(self, path: str) -> Optional[np.ndarray]:
        """Read a GeoTIFF as an RGB numpy array using OpenCV.

        For multi-band CBERS-4A WPM images, we select bands that
        correspond to R, G, B. For fused products, bands are typically
        ordered as B, G, R, NIR, PAN.
        """
        try:
            import rasterio

            with rasterio.open(path) as src:
                n_bands = src.count
                if n_bands >= 3:
                    # Assume bands: 1=Blue, 2=Green, 3=Red (CBERS-4A WPM MS)
                    # or 1=R, 2=G, 3=B for fused products.
                    # We read bands 1, 2, 3 and arrange as BGR for OpenCV.
                    band1 = src.read(1)
                    band2 = src.read(2)
                    band3 = src.read(3)
                    # Stack as BGR (OpenCV convention)
                    img = np.dstack([band1, band2, band3])
                elif n_bands == 1:
                    # Panchromatic — single band
                    band1 = src.read(1)
                    img = np.dstack([band1, band1, band1])
                else:
                    logger.warning("Unexpected band count: %d", n_bands)
                    return None

            # Normalize to 0-255 if needed
            if img.dtype != np.uint8:
                img_min = img.min()
                img_max = img.max()
                if img_max > img_min:
                    img = ((img - img_min) / (img_max - img_min) * 255).astype(np.uint8)
                else:
                    img = np.zeros_like(img, dtype=np.uint8)

            return img

        except Exception as exc:
            logger.error("Failed to read image %s: %s", path, exc)
            return None

    def _crop_detection(
        self,
        img_array: np.ndarray,
        det: Detection,
    ) -> np.ndarray:
        """Crop the detected region from the full image."""
        h, w = img_array.shape[:2]
        x1 = max(0, det.bbox_x)
        y1 = max(0, det.bbox_y)
        x2 = min(w, det.bbox_x + det.bbox_w)
        y2 = min(h, det.bbox_y + det.bbox_h)
        return img_array[y1:y2, x1:x2]

    async def run_batch(
        self,
        target_date: date,
        area_ids: Optional[list[int]] = None,
    ) -> dict:
        """Process all protected areas (or a subset by IDs) in batch.

        For each area, computes the bbox from its polygon geometry,
        creates a detection job, and runs the full pipeline.
        Areas are processed with limited concurrency (BATCH_CONCURRENCY).

        Args:
            target_date: desired satellite image date
            area_ids: optional list of area_protegida IDs to process

        Returns:
            Summary dict with total_areas, processadas, erros, total_deteccoes.
        """
        import asyncio

        areas = await self._db.list_protected_areas()
        if area_ids:
            id_set = set(area_ids)
            areas = [a for a in areas if a["id"] in id_set]

        results = {
            "total_areas": len(areas),
            "processadas": 0,
            "erros": 0,
            "total_deteccoes": 0,
        }

        concurrency = self._settings.batch_concurrency
        logger.info(
            "Batch: processing %d protected areas for date %s (concurrency=%d)",
            len(areas), target_date, concurrency,
        )

        async def process_one(area: dict) -> None:
            area_id = area["id"]
            area_name = area["nome"]
            bbox = area["bbox"]

            logger.info("Batch: area %d (%s) bbox=%s", area_id, area_name, bbox)

            try:
                job_id = await self._db.create_job(
                    bbox=bbox,
                    data_captura=target_date,
                    satelite="CBERS-4A",
                    instrumento="WPM",
                    produto="L4_DN",
                )
                total = await self.run(job_id, bbox, target_date)
                results["processadas"] += 1
                results["total_deteccoes"] += total
            except Exception as exc:
                logger.error(
                    "Batch: area %d (%s) failed: %s",
                    area_id, area_name, exc, exc_info=True,
                )
                results["erros"] += 1

        semaphore = asyncio.Semaphore(concurrency)

        async def gated(area: dict) -> None:
            async with semaphore:
                await process_one(area)

        await asyncio.gather(*(gated(a) for a in areas))

        logger.info("Batch: completed — %s", results)
        return results
