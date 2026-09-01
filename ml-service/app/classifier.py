"""Species classification for detected animals.

Phase 1 (MVP): heuristic mapping from COCO animal classes + geographic
context (biome inferred from coordinates) to likely Brazilian species.

Phase 2 (future): fine-tuned ResNet/EfficientNet on a Brazilian fauna
satellite dataset.
"""

import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np

from .config import Settings

logger = logging.getLogger(__name__)


@dataclass
class ClassificationResult:
    """Result of species classification for a detection."""
    nome_cientifico: Optional[str]
    confidence: float
    method: str  # 'heuristic' or 'model'


# ---- Heuristic mapping tables ----

# Maps COCO animal class to candidate Brazilian species by biome.
# Biomes are inferred from coordinates (simplified).
# This is intentionally conservative — only high-confidence mappings.
SPECIES_BY_BIOME = {
    # COCO class "cow" — domestic, not wild fauna. Skip in most cases.
    "cow": {
        "_default": None,  # domestic cattle, not a wild species
    },
    # COCO class "horse" — domestic. Skip.
    "horse": {
        "_default": None,
    },
    # COCO class "sheep" — domestic. Skip.
    "sheep": {
        "_default": None,
    },
    # COCO class "bird" — many possibilities, too broad without a model.
    "bird": {
        "_default": None,  # cannot classify to species from "bird" alone
    },
    # COCO class "dog" — could be bush dog (Speothos venaticus) in Amazon.
    "dog": {
        "amazonia": ("speothos venaticus", 0.3),  # low confidence — could be domestic
        "_default": None,
    },
    # COCO class "cat" — could be jaguar, puma, ocelot depending on biome.
    "cat": {
        "amazonia": ("panthera onca", 0.35),
        "mata_atlantica": ("panthera onca", 0.30),
        "pantanal": ("panthera onca", 0.40),
        "cerrado": ("puma concolor", 0.25),
        "caatinga": ("leopardus tigrinus", 0.20),
        "_default": None,
    },
    # COCO class "elephant" — no native elephants in Brazil. Skip.
    "elephant": {
        "_default": None,
    },
    # COCO class "bear" — no native bears in Brazil (except spectacled bear
    # historically, but extirpated). Skip.
    "bear": {
        "_default": None,
    },
    # COCO class "zebra" — no native zebras. Skip.
    "zebra": {
        "_default": None,
    },
    # COCO class "giraffe" — no native giraffes. Skip.
    "giraffe": {
        "_default": None,
    },
}


# Simplified biome inference from coordinates (bounding box in Brazil).
# This is a rough approximation — real biome boundaries are complex.
def infer_biome(lat: float, lon: float) -> str:
    """Infer a Brazilian biome from coordinates (simplified)."""
    # Amazon: north, west
    if lat < -5 and lon < -45:
        return "amazonia"
    if lat < -10 and lon < -40:
        return "amazonia"
    # Pantanal: center-west, around -16 to -22, -54 to -58
    if -22 < lat < -16 and -58 < lon < -54:
        return "pantanal"
    # Cerrado: central Brazil
    if -20 < lat < -5 and -55 < lon < -40:
        return "cerrado"
    # Caatinga: northeast
    if -15 < lat < -3 and -42 < lon < -34:
        return "caatinga"
    # Mata Atlantica: eastern coast
    if lat < -5 and -42 < lon < -35:
        return "mata_atlantica"
    if -33 < lat < -5 and -52 < lon < -35:
        return "mata_atlantica"
    # Pampa: south
    if lat < -28 and lon > -55:
        return "pampa"
    return "unknown"


class SpeciesClassifier:
    """Classifies detected animals to Brazilian species."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._model = None

    def load(self) -> None:
        """Load the classification model (Phase 2).

        Phase 1 uses heuristics only — no model to load.
        """
        logger.info("Species classifier: using heuristic mapping (Phase 1)")

    def classify(
        self,
        crop: np.ndarray,
        coco_class_name: str,
        lat: float,
        lon: float,
        detection_confidence: float,
    ) -> ClassificationResult:
        """Classify a detected animal crop to a Brazilian species.

        Args:
            crop: cropped image of the detected animal (numpy array)
            coco_class_name: COCO class name from the detector
            lat: latitude of detection center
            lon: longitude of detection center
            detection_confidence: YOLOv8 detection confidence

        Returns:
            ClassificationResult with species name or None.
        """
        biome = infer_biome(lat, lon)
        species_map = SPECIES_BY_BIOME.get(coco_class_name, {})

        # Try biome-specific mapping first, then default.
        result = species_map.get(biome, species_map.get("_default"))

        if result is None:
            return ClassificationResult(
                nome_cientifico=None,
                confidence=0.0,
                method="heuristic",
            )

        nome_cientifico, base_confidence = result
        # Combine detection confidence with classification confidence.
        combined = min(base_confidence * detection_confidence, 1.0)

        return ClassificationResult(
            nome_cientifico=nome_cientifico,
            confidence=combined,
            method="heuristic",
        )
