"""Basic tests for the ML pipeline (smoke tests without real satellite data)."""

import pytest
from datetime import date
from unittest.mock import MagicMock, AsyncMock, patch
import numpy as np

from app.config import Settings
from app.db import Database, DetectionRecord
from app.geo import GeoReference
from app.detector import AnimalDetector, Detection
from app.classifier import SpeciesClassifier, infer_biome
from app.pipeline import DetectionPipeline


def test_infer_biome_amazon():
    assert infer_biome(-3, -60) == "amazonia"


def test_infer_biome_pantanal():
    assert infer_biome(-18, -56) == "pantanal"


def test_infer_biome_unknown():
    # Coordinates outside Brazil
    assert infer_biome(40, -100) == "unknown"


def test_classifier_jaguar_pantanal():
    settings = Settings(
        database_url="postgresql://test:test@localhost/test",
        inpe_email="test@test.com",
        model_path="models/yolov8s.pt",
        confidence_threshold=0.25,
        species_confidence_threshold=0.5,
        max_cloud_cover=80,
        date_search_range_days=7,
        tile_size=640,
        host="0.0.0.0",
        port=8001,
    )
    clf = SpeciesClassifier(settings)
    clf.load()

    crop = np.zeros((50, 50, 3), dtype=np.uint8)
    result = clf.classify(
        crop=crop,
        coco_class_name="cat",
        lat=-18,
        lon=-56,
        detection_confidence=0.8,
    )
    assert result.nome_cientifico == "panthera onca"
    assert result.method == "heuristic"


def test_classifier_domestic_cow():
    settings = Settings(
        database_url="postgresql://test:test@localhost/test",
        inpe_email="test@test.com",
        model_path="models/yolov8s.pt",
        confidence_threshold=0.25,
        species_confidence_threshold=0.5,
        max_cloud_cover=80,
        date_search_range_days=7,
        tile_size=640,
        host="0.0.0.0",
        port=8001,
    )
    clf = SpeciesClassifier(settings)
    crop = np.zeros((50, 50, 3), dtype=np.uint8)
    result = clf.classify(
        crop=crop,
        coco_class_name="cow",
        lat=-18,
        lon=-56,
        detection_confidence=0.9,
    )
    assert result.nome_cientifico is None  # domestic, not wild fauna


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
