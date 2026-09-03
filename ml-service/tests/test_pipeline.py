"""Basic tests for the ML pipeline (smoke tests without real data)."""

import pytest
from datetime import date
from unittest.mock import MagicMock, AsyncMock, patch
import numpy as np

from app.config import Settings
from app.detector import AnimalDetector, Detection
from app.classifier import SpeciesClassifier, infer_biome
from app.sources.base import ImageItem
from app.sources.local_dir import LocalDirectorySource


def _make_settings(**overrides) -> Settings:
    defaults = dict(
        database_url="postgresql://test:test@localhost/test",
        model_path="models/yolov8s.pt",
        confidence_threshold=0.25,
        species_confidence_threshold=0.5,
        host="0.0.0.0",
        port=8001,
        openrouter_api_key="",
        openrouter_model="anthropic/claude-sonnet-4",
        yolo_device="cpu",
        yolo_workers=4,
        yolo_batch_size=16,
        db_pool_max=10,
        batch_concurrency=4,
        http_timeout=120,
        vlm_concurrency=8,
        image_storage_dir="",
        inpe_email="",
        max_cloud_cover=80,
        date_search_range_days=7,
    )
    defaults.update(overrides)
    return Settings(**defaults)


def test_infer_biome_amazon():
    assert infer_biome(-3, -60) == "amazonia"


def test_infer_biome_pantanal():
    assert infer_biome(-18, -56) == "pantanal"


def test_infer_biome_unknown():
    assert infer_biome(40, -100) == "unknown"


def test_classifier_jaguar_pantanal():
    settings = _make_settings()
    clf = SpeciesClassifier(settings)
    clf.load()

    crop = np.zeros((50, 50, 3), dtype=np.uint8)
    result = clf.classify(
        crop=crop,
        coco_class_name="cat",
        lat=-18,
        lon=-56,
        detection_confidence=0.8,
        context="camera trap photo in a Brazilian protected area",
    )
    assert result.nome_cientifico == "panthera onca"
    assert result.method == "heuristic"


def test_classifier_domestic_cow():
    settings = _make_settings()
    clf = SpeciesClassifier(settings)
    clf.load()

    crop = np.zeros((50, 50, 3), dtype=np.uint8)
    result = clf.classify(
        crop=crop,
        coco_class_name="cow",
        lat=-18,
        lon=-56,
        detection_confidence=0.9,
    )
    assert result.nome_cientifico is None  # domestic, not wild fauna


def test_image_item_defaults():
    item = ImageItem(image_id="test001", path="/data/test.jpg", source="local_dir")
    assert item.lat is None
    assert item.lon is None
    assert item.extra == {}


def test_local_dir_source_nonexistent():
    source = LocalDirectorySource("/nonexistent/path")
    items = list(source.iter_images())
    assert items == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
