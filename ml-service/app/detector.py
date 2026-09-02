"""Animal detection using YOLOv8 + SAHI for small object detection.

Uses a YOLOv8 model with SAHI (Slicing Aided Hyper Inference) to detect
animals in large satellite image tiles. SAHI slices the image into
overlapping patches, runs detection on each, and merges results with NMS.

COCO animal classes: 14=bird, 15=cat, 16=dog, 17=horse, 18=sheep,
19=cow, 20=elephant, 21=bear, 22=zebra, 23=giraffe.

Note: The COCO model is a placeholder. It was trained on ground-level
photos, not satellite imagery. Detection rate on 2m CBERS-4A will be low.
A custom model trained on annotated wildlife satellite data is needed
for production use.
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

# SAHI slicing parameters
SLICE_SIZE = 512
OVERLAP_RATIO = 0.2

# Post-filter: reject detections outside this bbox size range (pixels)
# At 2m resolution, an animal should be roughly 3-50 pixels
MIN_BBOX_SIZE = 3
MAX_BBOX_SIZE = 200


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
    tile_offset_x: int   # offset of the tile within the full image
    tile_offset_y: int


class AnimalDetector:
    """YOLOv8-based animal detector with SAHI small-object support."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._model = None
        self._sahi_model = None

    def load(self) -> None:
        """Load the YOLOv8 model and wrap it for SAHI inference."""
        from ultralytics import YOLO

        model_path = self._settings.model_path
        logger.info("Loading YOLOv8 model from %s", model_path)
        self._model = YOLO(model_path)
        logger.info("YOLOv8 model loaded")

        # Wrap with SAHI for sliced inference on large images
        try:
            from sahi import AutoDetectionModel
            self._sahi_model = AutoDetectionModel.from_pretrained(
                model_type="ultralytics",
                model_path=model_path,
                confidence_threshold=self._settings.confidence_threshold,
                device=self._settings.yolo_device,
            )
            logger.info(
                "SAHI enabled: slice=%dx%d overlap=%.0f%%",
                SLICE_SIZE, SLICE_SIZE, OVERLAP_RATIO * 100,
            )
        except ImportError:
            logger.warning("SAHI not installed, falling back to manual tiling")
            self._sahi_model = None

    def detect_tile(
        self,
        tile: np.ndarray,
        tile_offset_x: int = 0,
        tile_offset_y: int = 0,
    ) -> list[Detection]:
        """Run detection on a single image tile (fallback without SAHI).

        Args:
            tile: numpy array (H, W, 3) in RGB
            tile_offset_x: x offset of this tile in the full image
            tile_offset_y: y offset of this tile in the full image

        Returns:
            List of Detection objects with absolute pixel coordinates.
        """
        if self._model is None:
            raise RuntimeError("Detector not loaded — call load() first")

        results = self._model(
            tile,
            classes=ANIMAL_CLASS_IDS,
            conf=self._settings.confidence_threshold,
            device=self._settings.yolo_device,
            workers=self._settings.yolo_workers,
            verbose=False,
        )

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
                    bbox_x=int(x1) + tile_offset_x,
                    bbox_y=int(y1) + tile_offset_y,
                    bbox_w=int(x2 - x1),
                    bbox_h=int(y2 - y1),
                    confidence=conf,
                    class_id=cls_id,
                    class_name=COCO_ANIMAL_LABELS.get(cls_id, f"class_{cls_id}"),
                    tile_offset_x=tile_offset_x,
                    tile_offset_y=tile_offset_y,
                )
                detections.append(det)

        return detections

    def detect_image(
        self,
        image: np.ndarray,
        tile_size: Optional[int] = None,
    ) -> list[Detection]:
        """Run detection on a full image.

        Uses SAHI sliced inference if available, otherwise falls back
        to manual tiling. Filters detections by bbox size to reject
        objects that are too large or too small to be animals.

        Args:
            image: numpy array (H, W, 3) in BGR (OpenCV convention)
            tile_size: tile dimension in pixels (used by fallback only)

        Returns:
            List of all detections across all tiles, filtered by size.
        """
        if self._sahi_model is not None:
            detections = self._detect_with_sahi(image)
        else:
            detections = self._detect_with_tiling(image, tile_size)

        # Filter by bbox size — reject objects outside plausible animal range
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

        logger.info("Total detections across %dx%d image: %d", image.shape[1], image.shape[0], len(filtered))
        return filtered

    def _detect_with_sahi(self, image: np.ndarray) -> list[Detection]:
        """Run SAHI sliced inference on the full image."""
        from sahi.predict import get_sliced_prediction

        # SAHI expects RGB; our image is BGR (OpenCV convention)
        if image.shape[2] == 3:
            image_rgb = image[:, :, ::-1].copy()  # BGR → RGB
        else:
            image_rgb = image

        result = get_sliced_prediction(
            image_rgb,
            self._sahi_model,
            slice_height=SLICE_SIZE,
            slice_width=SLICE_SIZE,
            overlap_height_ratio=OVERLAP_RATIO,
            overlap_width_ratio=OVERLAP_RATIO,
            perform_standard_pred=True,
            verbose=0,
        )

        detections: list[Detection] = []
        for obj in result.object_prediction_list:
            bbox = obj.bbox
            cls_id = int(obj.category.id) if hasattr(obj.category, 'id') else 0
            cls_name = obj.category.name if hasattr(obj.category, 'name') else "unknown"

            # Only keep animal classes
            if cls_id not in ANIMAL_CLASS_IDS:
                continue

            det = Detection(
                bbox_x=int(bbox.minx),
                bbox_y=int(bbox.miny),
                bbox_w=int(bbox.maxx - bbox.minx),
                bbox_h=int(bbox.maxy - bbox.miny),
                confidence=float(obj.score.value),
                class_id=cls_id,
                class_name=cls_name,
                tile_offset_x=0,
                tile_offset_y=0,
            )
            detections.append(det)

        return detections

    def _detect_with_tiling(self, image: np.ndarray, tile_size: Optional[int] = None) -> list[Detection]:
        """Fallback: manual tiling without SAHI."""
        ts = tile_size or self._settings.tile_size
        h, w = image.shape[:2]
        all_detections: list[Detection] = []

        for y in range(0, h, ts):
            for x in range(0, w, ts):
                tile = image[y : y + ts, x : x + ts]
                if tile.size == 0:
                    continue
                dets = self.detect_tile(tile, tile_offset_x=x, tile_offset_y=y)
                all_detections.extend(dets)
                logger.debug(
                    "Tile (%d, %d): %d detections", x, y, len(dets)
                )

        return all_detections
