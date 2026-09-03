"""Animal detection using YOLOv8.

Uses a YOLOv8 model (COCO-pretrained) to detect animals in images.
Designed for camera trap photos (ground-level animal photos) where
the COCO model works well. Also handles satellite imagery via the
same interface, though detection rate on satellite images is lower.

COCO animal classes: 14=bird, 15=cat, 16=dog, 17=horse, 18=sheep,
19=cow, 20=elephant, 21=bear, 22=zebra, 23=giraffe.

For camera trap photos of Brazilian fauna (tapir, capivara, paca,
queixada, etc.), the COCO model detects them as generic "dog"/"cat"/
"bird" — sufficient to confirm animal presence and crop the region
for VLM classification. A custom model trained on annotated Brazilian
camera trap data is a future improvement.

SAHI (Slicing Aided Hyper Inference) was removed — camera trap images
are small enough (typically 1920x1080 or less) to process directly.
For very large satellite images, the pipeline can still tile manually
if needed.
"""

import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np

from .config import Settings

logger = logging.getLogger(__name__)

# COCO class IDs that correspond to animals.
ANIMAL_CLASS_IDS = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23]

# Human-readable labels for COCO animal classes.
COCO_ANIMAL_LABELS = {
    14: "bird",
    15: "cat",
    16: "dog",
    17: "horse",
    18: "sheep",
    19: "cow",
    20: "elephant",
    21: "bear",
    22: "zebra",
    23: "giraffe",
}

# Post-filter: reject detections outside this bbox size range (pixels).
# Camera trap: animals occupy a large portion of the frame (50-2000px).
# Satellite: animals are tiny (3-200px) — but satellite detection is
# low-priority now. These thresholds are calibrated for camera trap.
MIN_BBOX_SIZE = 50
MAX_BBOX_SIZE = 2000


@dataclass
class Detection:
    """A single animal detection."""
    bbox_x: int          # pixel x (top-left)
    bbox_y: int          # pixel y (top-left)
    bbox_w: int          # pixel width
    bbox_h: int          # pixel height
    confidence: float
    class_id: int
    class_name: str
    tile_offset_x: int   # offset of the tile within the full image (0 for direct inference)
    tile_offset_y: int


class AnimalDetector:
    """YOLOv8-based animal detector."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._model = None

    def load(self) -> None:
        """Load the YOLOv8 model."""
        from ultralytics import YOLO

        model_path = self._settings.model_path
        logger.info("Loading YOLOv8 model from %s (device=%s)", model_path, self._settings.yolo_device)
        self._model = YOLO(model_path)
        logger.info("YOLOv8 model loaded")

    def detect_image(
        self,
        image: np.ndarray,
        tile_size: Optional[int] = None,
    ) -> list[Detection]:
        """Run detection on a single image.

        Filters detections by bbox size to reject objects that are
        too large or too small to be animals.

        Args:
            image: numpy array (H, W, 3) in BGR (OpenCV convention)
            tile_size: unused (kept for API compatibility)

        Returns:
            List of detections, filtered by size.
        """
        if self._model is None:
            raise RuntimeError("Detector not loaded — call load() first")

        results = self._model(
            image,
            classes=ANIMAL_CLASS_IDS,
            conf=self._settings.confidence_threshold,
            device=self._settings.yolo_device,
            workers=self._settings.yolo_workers,
            verbose=False,
        )

        detections = self._parse_results(results)

        # Filter by bbox size
        filtered = [
            d for d in detections
            if MIN_BBOX_SIZE <= d.bbox_w <= MAX_BBOX_SIZE
            and MIN_BBOX_SIZE <= d.bbox_h <= MAX_BBOX_SIZE
        ]

        rejected = len(detections) - len(filtered)
        if rejected > 0:
            logger.info(
                "Filtered %d detections outside bbox size range (%d-%d px)",
                rejected, MIN_BBOX_SIZE, MAX_BBOX_SIZE,
            )

        logger.info("Detections on %dx%d image: %d", image.shape[1], image.shape[0], len(filtered))
        return filtered

    def detect_batch(
        self,
        images: list[np.ndarray],
    ) -> list[list[Detection]]:
        """Run detection on a batch of images (GPU-accelerated).

        Uses YOLOv8's native batch inference for efficiency. The
        batch size is controlled by YOLO_BATCH_SIZE in settings.

        Args:
            images: list of numpy arrays (H, W, 3) in BGR

        Returns:
            List of detection lists, one per input image (filtered by size).
        """
        if self._model is None:
            raise RuntimeError("Detector not loaded — call load() first")

        if not images:
            return []

        batch_size = getattr(self._settings, "yolo_batch_size", 16)
        all_results: list[list[Detection]] = []

        for i in range(0, len(images), batch_size):
            batch = images[i:i + batch_size]
            logger.info(
                "detect_batch: processing batch %d-%d of %d (batch_size=%d)",
                i, min(i + batch_size, len(images)), len(images), len(batch),
            )

            results = self._model(
                batch,
                classes=ANIMAL_CLASS_IDS,
                conf=self._settings.confidence_threshold,
                device=self._settings.yolo_device,
                workers=self._settings.yolo_workers,
                verbose=False,
            )

            for result in results:
                detections = self._parse_results([result])
                filtered = [
                    d for d in detections
                    if MIN_BBOX_SIZE <= d.bbox_w <= MAX_BBOX_SIZE
                    and MIN_BBOX_SIZE <= d.bbox_h <= MAX_BBOX_SIZE
                ]
                all_results.append(filtered)

        return all_results

    def _parse_results(self, results) -> list[Detection]:
        """Parse YOLOv8 results into Detection objects."""
        detections: list[Detection] = []
        for result in results:
            boxes = result.boxes
            if boxes is None:
                continue
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])

                det = Detection(
                    bbox_x=int(x1),
                    bbox_y=int(y1),
                    bbox_w=int(x2 - x1),
                    bbox_h=int(y2 - y1),
                    confidence=conf,
                    class_id=cls_id,
                    class_name=COCO_ANIMAL_LABELS.get(cls_id, f"class_{cls_id}"),
                    tile_offset_x=0,
                    tile_offset_y=0,
                )
                detections.append(det)

        return detections
