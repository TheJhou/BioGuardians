"""Detection pipeline — source-agnostic image processing.

Orchestrates the full flow:
1. Iterate images from an ImageSource (satellite, camera trap, local dir)
2. Register each image in imagem_job (checkpoint + idempotency)
3. Run YOLO detection (Fase 1 — local, GPU)
4. Save detections with status='detected'
5. Classification (Fase 2) runs separately via classify_pending()

The pipeline does not know whether images come from a satellite, a
camera trap dataset, or a local folder — it consumes ImageItem
objects from any ImageSource implementation.
"""

import asyncio
import hashlib
import logging
import os
from datetime import date
from typing import Optional

import cv2
import numpy as np

from .config import Settings
from .db import Database, DetectionRecord
from .sources.base import ImageItem, ImageSource
from .detector import AnimalDetector, Detection
from .classifier import SpeciesClassifier

logger = logging.getLogger(__name__)


class DetectionPipeline:
    """Orchestrates detection and classification of images from any source."""

    def __init__(
        self,
        settings: Settings,
        db: Database,
        detector: AnimalDetector,
        classifier: SpeciesClassifier,
    ):
        self._settings = settings
        self._db = db
        self._detector = detector
        self._classifier = classifier

    # ------------------------------------------------------------------
    # Fase 1 — Detection (YOLO, local GPU)
    # ------------------------------------------------------------------

    async def run(self, job_id: int, source: ImageSource) -> int:
        """Run detection (Fase 1) for all images from a source.

        For each image:
        1. Register/update imagem_job (checkpoint)
        2. Skip if already completed (idempotency)
        3. Load image as numpy array
        4. Run YOLO detection
        5. Filter by confidence threshold
        6. Save detections with status='detected'
        7. Update imagem_job status

        Args:
            job_id: deteccao_job ID
            source: ImageSource providing images

        Returns:
            Total number of detections saved.
        """
        await self._db.update_job_status(job_id, "processando")

        total_saved = 0
        total_images = 0

        try:
            for image_item in source.iter_images():
                total_images += 1

                # Checkpoint: register image, skip if already done
                img_record = await self._db.upsert_image_job(job_id, image_item)
                if img_record.status in ("completed", "detected", "classified"):
                    logger.info(
                        "Job %d: image %s already %s, skipping",
                        job_id, image_item.image_id, img_record.status,
                    )
                    continue

                # Load image
                img_array = self._load_image(image_item.path)
                if img_array is None:
                    await self._db.update_image_status(
                        img_record.id, "failed", error="Failed to load image"
                    )
                    logger.warning("Job %d: failed to load image %s", job_id, image_item.path)
                    continue

                await self._db.update_image_status(img_record.id, "processing")

                # YOLO detection
                detections = self._detector.detect_image(img_array)
                logger.info(
                    "Job %d: image %s — %d raw detections",
                    job_id, image_item.image_id, len(detections),
                )

                # Filter by confidence
                filtered = [
                    d for d in detections
                    if d.confidence >= self._settings.confidence_threshold
                ]

                # Save detections
                for det in filtered:
                    saved = await self._save_detection(
                        job_id, img_record.id, det, image_item, img_array
                    )
                    if saved:
                        total_saved += 1

                await self._db.update_image_status(
                    img_record.id, "detected", detection_count=len(filtered)
                )

                # Update job progress
                await self._db.increment_job_progress(job_id)

            await self._db.update_job_status(
                job_id, "concluido", total_deteccoes=total_saved
            )
            logger.info(
                "Job %d: Fase 1 complete — %d images, %d detections",
                job_id, total_images, total_saved,
            )
            return total_saved

        except Exception as exc:
            logger.error("Job %d Fase 1 failed: %s", job_id, exc, exc_info=True)
            await self._db.update_job_status(job_id, "erro", erro=str(exc))
            raise

    async def _save_detection(
        self,
        job_id: int,
        image_job_id: int,
        det: Detection,
        image_item: ImageItem,
        img_array: np.ndarray,
    ) -> bool:
        """Save a single detection to the database (Fase 1, unclassified)."""
        # Determine lat/lon
        lat, lon = self._resolve_lat_lon(det, image_item)

        # Save crop to storage if configured
        recorte_url = self._save_crop(img_array, det, image_item.image_id)

        bbox_pixel = f"{det.bbox_x},{det.bbox_y},{det.bbox_w},{det.bbox_h}"
        det_record = DetectionRecord(
            job_id=job_id,
            especie_id=None,  # classified in Fase 2
            nome_cientifico=None,
            confianca=det.confidence,
            lat=lat,
            lon=lon,
            bbox_pixel=bbox_pixel,
            recorte_url=recorte_url,
            metodo_classificacao="heuristic",  # placeholder, updated in Fase 2
            modelo_ia=None,
            confianca_ia=None,
            image_job_id=image_job_id,
            status="detected",
        )
        await self._db.save_detection(det_record)
        return True

    def _resolve_lat_lon(self, det: Detection, image_item: ImageItem) -> tuple[float, float]:
        """Resolve lat/lon for a detection.

        For satellite images, use the GeoReference from the source
        (stored in image_item.extra). For camera trap / local dir,
        use the image's own lat/lon (from the deployment metadata).
        """
        geo = image_item.extra.get("geo_ref")
        if geo is not None:
            return geo.center_latlon(det.bbox_x, det.bbox_y, det.bbox_w, det.bbox_h)

        # Fallback: use image-level coordinates (camera trap deployment)
        if image_item.lat is not None and image_item.lon is not None:
            return image_item.lat, image_item.lon

        # No coordinates available
        logger.warning(
            "No lat/lon for detection on image %s — using 0,0",
            image_item.image_id,
        )
        return 0.0, 0.0

    def _save_crop(
        self,
        img_array: np.ndarray,
        det: Detection,
        image_id: str,
    ) -> Optional[str]:
        """Save the detected region as a crop image.

        Returns the path to the saved crop, or None if storage is not
        configured or saving fails.
        """
        storage_dir = self._settings.image_storage_dir
        if not storage_dir:
            return None

        try:
            os.makedirs(storage_dir, exist_ok=True)
            h, w = img_array.shape[:2]
            x1 = max(0, det.bbox_x)
            y1 = max(0, det.bbox_y)
            x2 = min(w, det.bbox_x + det.bbox_w)
            y2 = min(h, det.bbox_y + det.bbox_h)
            crop = img_array[y1:y2, x1:x2]

            if crop.size == 0:
                return None

            filename = f"{image_id}_{det.bbox_x}_{det.bbox_y}.jpg"
            filepath = os.path.join(storage_dir, filename)
            cv2.imwrite(filepath, crop)
            return filepath
        except Exception as exc:
            logger.warning("Failed to save crop for %s: %s", image_id, exc)
            return None

    def _load_image(self, path: str) -> Optional[np.ndarray]:
        """Load an image from a file path as a BGR numpy array (OpenCV).

        Handles both regular image files (jpg/png) and GeoTIFFs
        (for satellite sources, via rasterio if available).
        """
        # Try OpenCV first (works for jpg/png — camera trap, local dir)
        img = cv2.imread(path)
        if img is not None:
            return img

        # Fallback: try rasterio (GeoTIFF — satellite source)
        try:
            import rasterio

            with rasterio.open(path) as src:
                n_bands = src.count
                if n_bands >= 3:
                    band1 = src.read(1)
                    band2 = src.read(2)
                    band3 = src.read(3)
                    img = np.dstack([band1, band2, band3])
                elif n_bands == 1:
                    band1 = src.read(1)
                    img = np.dstack([band1, band1, band1])
                else:
                    return None

                if img.dtype != np.uint8:
                    img_min = img.min()
                    img_max = img.max()
                    if img_max > img_min:
                        img = ((img - img_min) / (img_max - img_min) * 255).astype(np.uint8)
                    else:
                        img = np.zeros_like(img, dtype=np.uint8)

                return img
        except ImportError:
            logger.warning("rasterio not available — cannot read GeoTIFF %s", path)
        except Exception as exc:
            logger.warning("Failed to read image %s: %s", path, exc)

        return None

    # ------------------------------------------------------------------
    # Fase 2 — Classification (VLM via OpenRouter, async)
    # ------------------------------------------------------------------

    async def classify_pending(self, limit: int = 100) -> int:
        """Run classification (Fase 2) for detections with status='detected'.

        Loads unclassified detections from the database, crops the
        corresponding image region, sends to the VLM (or heuristic
        fallback), and updates the detection with the classification.

        Runs with VLM_CONCURRENCY simultaneous calls to avoid
        overwhelming the OpenRouter API.

        Args:
            limit: maximum number of detections to classify in this batch

        Returns:
            Number of detections classified.
        """
        pending = await self._db.list_unclassified_detections(limit)

        if not pending:
            logger.info("Fase 2: no pending detections to classify")
            return 0

        logger.info("Fase 2: classifying %d detections", len(pending))

        semaphore = asyncio.Semaphore(self._settings.vlm_concurrency)
        classified_count = 0

        async def classify_one(det: dict) -> None:
            nonlocal classified_count
            async with semaphore:
                try:
                    # Load the crop from the saved file or re-crop from the original image
                    crop = await self._load_crop_for_detection(det)
                    if crop is None:
                        await self._db.update_detection_status(
                            det["id"], "inconclusive"
                        )
                        return

                    # Determine context for the classifier prompt
                    source = det.get("source", "unknown")
                    context = self._build_context(source)

                    result = self._classifier.classify(
                        crop=crop,
                        coco_class_name=det.get("class_name", "unknown"),
                        lat=float(det.get("lat", 0)),
                        lon=float(det.get("lon", 0)),
                        detection_confidence=float(det.get("confianca", 0)),
                        context=context,
                    )

                    # Update detection with classification
                    especie_id = None
                    if result.nome_cientifico and result.confidence >= self._settings.species_confidence_threshold:
                        categoria = result.categoria_ameaca or "DD"
                        especie_id = await self._db.find_or_create_species(
                            nome_cientifico=result.nome_cientifico,
                            nome_popular=result.nome_popular,
                            categoria_ameaca=categoria,
                            descricao=result.descricao,
                        )
                        await self._db.update_species_info(
                            especie_id=especie_id,
                            descricao=result.descricao,
                            categoria_ameaca=result.categoria_ameaca,
                            nome_popular=result.nome_popular,
                        )

                    # Determine final status
                    if result.nome_cientifico:
                        status = "classified"
                    elif result.method == "ai" and result.confidence < 0.1:
                        status = "rejected"
                    else:
                        status = "inconclusive"

                    await self._db.update_detection_classification(
                        detection_id=det["id"],
                        especie_id=especie_id,
                        nome_cientifico=result.nome_cientifico,
                        metodo_classificacao=result.method,
                        modelo_ia=self._settings.openrouter_model if result.method == "ai" else None,
                        confianca_ia=result.confidence if result.method == "ai" else None,
                        status=status,
                    )

                    # Create occurrence if species was identified
                    if especie_id:
                        await self._db.create_occurrence(
                            especie_id=especie_id,
                            lat=float(det["lat"]),
                            lon=float(det["lon"]),
                            data_evento=det.get("timestamp") or date.today(),
                            base_registro=f"Auto-detection ({result.method}, confianca: {result.confidence:.2f})",
                            fonte="camera_trap" if source == "camera_trap" else "deteccao_satelite",
                        )
                        logger.info(
                            "Fase 2: occurrence created for %s at (%.4f, %.4f) [%s]",
                            result.nome_cientifico,
                            float(det["lat"]),
                            float(det["lon"]),
                            result.method,
                        )

                    classified_count += 1

                except Exception as exc:
                    logger.error(
                        "Fase 2: failed to classify detection %d: %s",
                        det["id"], exc, exc_info=True,
                    )
                    await self._db.update_detection_status(det["id"], "inconclusive")

        await asyncio.gather(*(classify_one(d) for d in pending))

        logger.info("Fase 2: classified %d/%d detections", classified_count, len(pending))
        return classified_count

    async def _load_crop_for_detection(self, det: dict) -> Optional[np.ndarray]:
        """Load the crop for a detection.

        Tries the saved crop file first (recorte_url). If not
        available, loads the original image and crops it.
        """
        # Try saved crop
        recorte_url = det.get("recorte_url")
        if recorte_url and os.path.exists(recorte_url):
            crop = cv2.imread(recorte_url)
            if crop is not None:
                return crop

        # Re-crop from original image
        image_path = det.get("image_path")
        if not image_path or not os.path.exists(image_path):
            logger.warning("Fase 2: cannot load crop — no image path for detection %d", det["id"])
            return None

        img = self._load_image(image_path)
        if img is None:
            return None

        bbox = det.get("bbox_pixel", "")
        if not bbox:
            return img  # return full image as fallback

        try:
            parts = [int(float(x)) for x in bbox.split(",")]
            if len(parts) == 4:
                x, y, w, h = parts
                h_img, w_img = img.shape[:2]
                x1 = max(0, x)
                y1 = max(0, y)
                x2 = min(w_img, x + w)
                y2 = min(h_img, y + h)
                return img[y1:y2, x1:x2]
        except (ValueError, IndexError) as exc:
            logger.warning("Fase 2: invalid bbox '%s': %s", bbox, exc)

        return img

    def _build_context(self, source: str) -> str:
        """Build the context string for the classifier prompt."""
        if source == "satellite":
            return "satellite image crop (CBERS-4A WPM) in a Brazilian protected area"
        if source == "camera_trap":
            return "camera trap photo in a Brazilian protected area"
        return "wildlife image in Brazil"

    # ------------------------------------------------------------------
    # Batch (legacy satellite compatibility)
    # ------------------------------------------------------------------

    async def run_batch_satellite(
        self,
        target_date: date,
        area_ids: Optional[list[int]] = None,
    ) -> dict:
        """Process all protected areas using satellite imagery.

        Legacy compatibility — uses SatelliteSource for each area.
        Kept for backward compatibility with the original /batch endpoint.
        """
        from .sources.satellite import SatelliteSource

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
            "Batch satellite: processing %d areas for date %s (concurrency=%d)",
            len(areas), target_date, concurrency,
        )

        async def process_one(area: dict) -> None:
            area_id = area["id"]
            area_name = area["nome"]
            bbox = area["bbox"]

            try:
                job_id = await self._db.create_job(
                    bbox=bbox,
                    data_captura=target_date,
                    satelite="CBERS-4A",
                    instrumento="WPM",
                    produto="L4_DN",
                    source="satellite",
                )

                source = SatelliteSource(
                    bbox=bbox,
                    target_date=target_date,
                    inpe_email=self._settings.inpe_email,
                    max_cloud_cover=self._settings.max_cloud_cover,
                    date_search_range_days=self._settings.date_search_range_days,
                )

                total = await self.run(job_id, source)
                results["processadas"] += 1
                results["total_deteccoes"] += total
            except Exception as exc:
                logger.error("Batch: area %d (%s) failed: %s", area_id, area_name, exc, exc_info=True)
                results["erros"] += 1

        semaphore = asyncio.Semaphore(concurrency)

        async def gated(area: dict) -> None:
            async with semaphore:
                await process_one(area)

        await asyncio.gather(*(gated(a) for a in areas))

        logger.info("Batch satellite: completed — %s", results)
        return results
