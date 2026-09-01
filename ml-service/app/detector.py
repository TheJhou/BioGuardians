"""Animal detection using YOLOv8.

Uses a pre-trained YOLOv8 model to detect animals in satellite image tiles.
COCO animal classes: 14=bird, 15=cat, 16=dog, 17=horse, 18=sheep,
19=cow, 20=elephant, 21=bear, 22=zebra, 23=giraffe.
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
    """YOLOv8-based animal detector."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._model = None

    def load(self) -> None:
        """Load the YOLOv8 model."""
        from ultralytics import YOLO

        model_path = self._settings.model_path
        logger.info("Loading YOLOv8 model from %s", model_path)
        self._model = YOLO(model_path)
        logger.info("YOLOv8 model loaded")

    def detect_tile(
        self,
        tile: np.ndarray,
        tile_offset_x: int = 0,
        tile_offset_y: int = 0,
    ) -> list[Detection]:
        """Run detection on a single image tile.

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
        """Run detection on a full image by tiling it.

        Args:
            image: numpy array (H, W, 3) in RGB
            tile_size: tile dimension in pixels (default from settings)

        Returns:
            List of all detections across all tiles.
        """
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

        logger.info("Total detections across %dx%d image: %d", w, h, len(all_detections))
        return all_detections
