"""Configuration loaded from environment variables."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    inpe_email: str
    model_path: str
    confidence_threshold: float
    species_confidence_threshold: float
    max_cloud_cover: float
    date_search_range_days: int
    tile_size: int
    host: str
    port: int
    openrouter_api_key: str
    openrouter_model: str
    yolo_device: str           # "cpu" or "cuda"
    yolo_workers: int          # dataloader workers for YOLOv8
    db_pool_max: int           # asyncpg pool max connections
    batch_concurrency: int     # parallel areas in batch mode
    http_timeout: int          # timeout for OpenRouter API calls (seconds)


def _required(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val


def load_settings() -> Settings:
    return Settings(
        database_url=_required("DATABASE_URL"),
        inpe_email=os.environ.get("INPE_EMAIL", ""),
        model_path=os.environ.get("MODEL_PATH", "models/yolov8s.pt"),
        confidence_threshold=float(os.environ.get("CONFIDENCE_THRESHOLD", "0.25")),
        species_confidence_threshold=float(os.environ.get("SPECIES_CONFIDENCE_THRESHOLD", "0.5")),
        max_cloud_cover=float(os.environ.get("MAX_CLOUD_COVER", "80")),
        date_search_range_days=int(os.environ.get("DATE_SEARCH_RANGE_DAYS", "7")),
        tile_size=int(os.environ.get("TILE_SIZE", "640")),
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8001")),
        openrouter_api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        openrouter_model=os.environ.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-4"),
        yolo_device=os.environ.get("YOLO_DEVICE", "cpu"),
        yolo_workers=int(os.environ.get("YOLO_WORKERS", "4")),
        db_pool_max=int(os.environ.get("DB_POOL_MAX", "20")),
        batch_concurrency=int(os.environ.get("BATCH_CONCURRENCY", "8")),
        http_timeout=int(os.environ.get("HTTP_TIMEOUT", "120")),
    )
