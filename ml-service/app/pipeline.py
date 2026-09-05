"""Classification pipeline — source-agnostic image processing.

Orchestrates the full flow WITHOUT YOLO:
1. Iterate images from an ImageSource (camera trap, local dir, satellite)
2. Register each image in imagem_job (checkpoint + idempotency)
3. Classify each image using the local fine-tuned VLM (Qwen2-VL-2B)
4. Fall back to OpenRouter/Claude if local model is unavailable or uncertain
5. Save species + occurrence to the database

The pipeline does not know whether images come from a satellite, a
camera trap dataset, or a local folder — it consumes ImageItem
objects from any ImageSource implementation.
"""

import asyncio
import logging
import os
from datetime import date
from typing import Optional

from .config import Settings
from .db import Database, DetectionRecord
from .sources.base import ImageItem, ImageSource
from .local_classifier import LocalVLMClassifier, ClassificationResult

logger = logging.getLogger(__name__)


class ClassificationPipeline:
    """Orchestrates classification of images from any source.

    No YOLO detection — the VLM classifies the full image directly.
    """

    def __init__(
        self,
        settings: Settings,
        db: Database,
        classifier: LocalVLMClassifier,
    ):
        self._settings = settings
        self._db = db
        self._classifier = classifier
        # Serializes species find-or-create — concurrent tasks could
        # otherwise race and duplicate the same new species.
        self._species_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Main processing
    # ------------------------------------------------------------------

    async def run(self, job_id: int, source: ImageSource) -> int:
        """Process all images from a source: classify and save to DB.

        For each image:
        1. Register/update imagem_job (checkpoint)
        2. Skip if already completed (idempotency)
        3. Classify with local VLM (or OpenRouter fallback)
        4. Save detection + species + occurrence to DB
        5. Update imagem_job status

        Classification runs concurrently (vlm_concurrency) — useful when
        the backend is OpenRouter (network-bound). With the local model
        the calls serialize on the GPU anyway. Image iteration stays
        sequential so sources keep control of their own rate limits.

        Args:
            job_id: deteccao_job ID
            source: ImageSource providing images

        Returns:
            Number of successfully classified images.
        """
        await self._db.update_job_status(job_id, "processando")

        counters = {"images": 0, "classified": 0, "rejected": 0, "duplicates": 0}
        concurrency = max(1, self._settings.vlm_concurrency)
        sem = asyncio.Semaphore(concurrency)
        threshold = self._settings.species_confidence_threshold

        async def process_image(image_item: ImageItem) -> None:
            async with sem:
                counters["images"] += 1

                # Checkpoint: register image, skip if already done
                img_record = await self._db.upsert_image_job(job_id, image_item)
                if img_record.status in ("completed", "classified"):
                    logger.info(
                        "Job %d: image %s already %s, skipping",
                        job_id, image_item.image_id, img_record.status,
                    )
                    return

                # Dedup: same file content (hash) or same capture event
                # (deployment + timestamp) already processed under another ID
                dup = await self._db.find_processed_duplicate(
                    image_hash=image_item.image_hash,
                    deployment_id=image_item.deployment_id,
                    timestamp=image_item.timestamp,
                    exclude_id=img_record.id,
                )
                if dup:
                    logger.info(
                        "Job %d: image %s is a duplicate of imagem_job %d "
                        "(job %d, status=%s), skipping",
                        job_id, image_item.image_id,
                        dup["id"], dup["job_id"], dup["status"],
                    )
                    await self._db.update_image_status(
                        img_record.id, "completed", detection_count=0
                    )
                    await self._db.increment_job_progress(job_id)
                    counters["duplicates"] += 1
                    return

                await self._db.update_image_status(img_record.id, "processing")

                # Classify the image
                try:
                    result = await asyncio.to_thread(
                        self._classifier.classify,
                        image_path=image_item.path,
                        lat=image_item.lat or 0,
                        lon=image_item.lon or 0,
                        context=self._build_context(image_item.source),
                    )
                except Exception as exc:
                    logger.error(
                        "Job %d: classification failed for %s: %s",
                        job_id, image_item.image_id, exc,
                    )
                    await self._db.update_image_status(
                        img_record.id, "failed", error=str(exc)
                    )
                    return

                # Save to database
                if result.nome_cientifico and result.confidence >= threshold:
                    await self._save_classification(
                        job_id, img_record.id, image_item, result
                    )
                    counters["classified"] += 1
                    status = "classified"
                else:
                    # Save as rejected detection (no species or low confidence)
                    await self._save_rejected(
                        job_id, img_record.id, image_item, result
                    )
                    counters["rejected"] += 1
                    status = "completed"  # imagem_status enum has no "rejected"

                await self._db.update_image_status(
                    img_record.id, status, detection_count=1
                )
                await self._db.increment_job_progress(job_id)

                logger.info(
                    "Job %d: image %s — %s (conf=%.2f, method=%s)",
                    job_id, image_item.image_id,
                    result.nome_cientifico or "no species",
                    result.confidence, result.method,
                )

        sentinel = object()
        pending: set[asyncio.Task] = set()

        def next_item(it):
            try:
                return next(it)
            except StopIteration:
                return sentinel

        try:
            it = iter(source.iter_images())
            while True:
                # Iterate in a thread — sources download lazily and would
                # block the event loop (sync httpx) otherwise.
                item = await asyncio.to_thread(next_item, it)
                if item is sentinel:
                    break
                pending.add(asyncio.create_task(process_image(item)))
                # Backpressure: don't let unprocessed tasks pile up
                if len(pending) >= concurrency * 4:
                    done, pending = await asyncio.wait(
                        pending, return_when=asyncio.FIRST_COMPLETED
                    )
                    for t in done:
                        if t.exception():
                            raise t.exception()

            if pending:
                results = await asyncio.gather(*pending, return_exceptions=True)
                for r in results:
                    if isinstance(r, Exception):
                        raise r

            await self._db.update_job_status(
                job_id, "concluido", total_deteccoes=counters["classified"]
            )
            logger.info(
                "Job %d: complete — %d images, %d classified, %d rejected, %d duplicates",
                job_id, counters["images"], counters["classified"],
                counters["rejected"], counters["duplicates"],
            )
            return counters["classified"]

        except Exception as exc:
            logger.error("Job %d failed: %s", job_id, exc, exc_info=True)
            await self._db.update_job_status(job_id, "erro", erro=str(exc))
            raise

    # ------------------------------------------------------------------
    # Database persistence
    # ------------------------------------------------------------------

    async def _save_classification(
        self,
        job_id: int,
        image_job_id: int,
        image_item: ImageItem,
        result: ClassificationResult,
    ) -> int:
        """Save a successful classification: species + detection + occurrence."""
        # Find or create species (serialized to avoid duplicate inserts)
        categoria = result.categoria_ameaca or "DD"
        async with self._species_lock:
            especie_id = await self._db.find_or_create_species(
                nome_cientifico=result.nome_cientifico,
                nome_popular=result.nome_popular,
                categoria_ameaca=categoria,
                descricao=result.descricao,
            )

        # Update species metadata
        await self._db.update_species_info(
            especie_id=especie_id,
            descricao=result.descricao,
            categoria_ameaca=result.categoria_ameaca,
            nome_popular=result.nome_popular,
        )

        # Save detection record
        det_record = DetectionRecord(
            job_id=job_id,
            especie_id=especie_id,
            nome_cientifico=result.nome_cientifico,
            confianca=result.confidence,
            lat=image_item.lat or 0,
            lon=image_item.lon or 0,
            bbox_pixel=None,  # no YOLO bbox — full image
            recorte_url=image_item.path,  # the image itself
            metodo_classificacao="ai",  # DB CHECK constraint only allows 'ai' or 'heuristic'
            modelo_ia=self._settings.openrouter_model if result.method == "openrouter" else "qwen2vl-local",
            confianca_ia=result.confidence,
            image_job_id=image_job_id,
            status="classified",
        )
        await self._db.save_detection(det_record)

        # Create occurrence — skip if the same capture event was already
        # recorded (same species, same place, same date)
        data_evento = image_item.timestamp.date() if image_item.timestamp else date.today()
        lat = image_item.lat or 0
        lon = image_item.lon or 0
        async with self._species_lock:
            exists = await self._db.occurrence_exists(especie_id, lat, lon, data_evento)
            if not exists:
                await self._db.create_occurrence(
                    especie_id=especie_id,
                    lat=lat,
                    lon=lon,
                    data_evento=data_evento,
                    base_registro=f"Auto-classification ({result.method}, confianca: {result.confidence:.2f})",
                    fonte="camera_trap" if image_item.source == "camera_trap" else "deteccao_ia",
                )
                logger.info(
                    "Occurrence created: %s at (%.4f, %.4f) [%s]",
                    result.nome_cientifico, lat, lon, result.method,
                )
            else:
                logger.info(
                    "Occurrence already exists for %s on %s at (%.4f, %.4f) — skipped",
                    result.nome_cientifico, data_evento, lat, lon,
                )

        return especie_id

    async def _save_rejected(
        self,
        job_id: int,
        image_job_id: int,
        image_item: ImageItem,
        result: ClassificationResult,
    ) -> None:
        """Save a rejected classification (no species or low confidence)."""
        det_record = DetectionRecord(
            job_id=job_id,
            especie_id=None,
            nome_cientifico=None,
            confianca=result.confidence,
            lat=image_item.lat or 0,
            lon=image_item.lon or 0,
            bbox_pixel=None,
            recorte_url=image_item.path,
            metodo_classificacao="ai",  # DB CHECK constraint only allows 'ai' or 'heuristic'
            modelo_ia=self._settings.openrouter_model if result.method == "openrouter" else "qwen2vl-local",
            confianca_ia=result.confidence,
            image_job_id=image_job_id,
            status="rejected",
        )
        await self._db.save_detection(det_record)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_context(self, source: str) -> str:
        """Build the context string for the classifier prompt."""
        if source == "satellite":
            return "satellite image crop in a Brazilian protected area"
        if source == "camera_trap":
            return "camera trap photo in a Brazilian protected area"
        return "wildlife image in Brazil"

    # ------------------------------------------------------------------
    # Legacy: classify_pending (kept for backward compatibility)
    # ------------------------------------------------------------------

    async def classify_pending(self, limit: int = 100) -> int:
        """Re-classify pending detections (status='detected' from old YOLO runs).

        This is kept for backward compatibility with jobs that were created
        before the YOLO removal. New jobs classify inline in run().
        """
        pending = await self._db.list_unclassified_detections(limit)
        if not pending:
            logger.info("No pending detections to reclassify")
            return 0

        logger.info("Reclassifying %d pending detections", len(pending))
        classified = 0

        for det in pending:
            try:
                image_path = det.get("image_path") or det.get("recorte_url")
                if not image_path or not os.path.exists(image_path):
                    await self._db.update_detection_status(det["id"], "inconclusive")
                    continue

                result = await asyncio.to_thread(
                    self._classifier.classify,
                    image_path=image_path,
                    lat=float(det.get("lat", 0)),
                    lon=float(det.get("lon", 0)),
                    context=self._build_context(det.get("source", "camera_trap")),
                )

                if result.nome_cientifico and result.confidence >= self._settings.species_confidence_threshold:
                    categoria = result.categoria_ameaca or "DD"
                    especie_id = await self._db.find_or_create_species(
                        nome_cientifico=result.nome_cientifico,
                        nome_popular=result.nome_popular,
                        categoria_ameaca=categoria,
                        descricao=result.descricao,
                    )
                    await self._db.update_detection_classification(
                        detection_id=det["id"],
                        especie_id=especie_id,
                        nome_cientifico=result.nome_cientifico,
                        metodo_classificacao="ai",
                        modelo_ia=self._settings.openrouter_model if result.method == "openrouter" else "qwen2vl-local",
                        confianca_ia=result.confidence,
                        status="classified",
                    )
                    await self._db.create_occurrence(
                        especie_id=especie_id,
                        lat=float(det["lat"]),
                        lon=float(det["lon"]),
                        data_evento=det.get("timestamp") or date.today(),
                        base_registro=f"Auto-classification ({result.method}, confianca: {result.confidence:.2f})",
                        fonte="camera_trap",
                    )
                    classified += 1
                else:
                    await self._db.update_detection_classification(
                        detection_id=det["id"],
                        especie_id=None,
                        nome_cientifico=None,
                        metodo_classificacao="ai",
                        modelo_ia=self._settings.openrouter_model if result.method == "openrouter" else "qwen2vl-local",
                        confianca_ia=result.confidence,
                        status="rejected",
                    )

            except Exception as exc:
                logger.error("Reclassification failed for det %d: %s", det["id"], exc)

        logger.info("Reclassified %d/%d detections", classified, len(pending))
        return classified
