"""Configuration loaded from environment variables.

Satellite-specific settings (INPE_EMAIL, MAX_CLOUD_COVER,
DATE_SEARCH_RANGE_DAYS, TILE_SIZE) are kept as optional with defaults
because SatelliteSource still uses them, but they are no longer
required for the camera trap workflow.
"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    model_path: str
    confidence_threshold: float
    species_confidence_threshold: float
    host: str
    port: int
    openrouter_api_key: str
    openrouter_model: str
    yolo_device: str           # "cpu" or "cuda"
    yolo_workers: int          # dataloader workers for YOLOv8
    yolo_batch_size: int       # batch size for YOLOv8 inference (GPU)
    db_pool_max: int           # asyncpg pool max connections
    batch_concurrency: int     # parallel areas in satellite batch mode
    http_timeout: int          # timeout for OpenRouter API calls (seconds)
    vlm_concurrency: int       # simultaneous VLM calls in Fase 2
    image_storage_dir: str     # where to save crop images

    # Satellite-specific (optional — only needed for SatelliteSource)
    inpe_email: str
    max_cloud_cover: float
    date_search_range_days: int


def _required(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val


def load_settings() -> Settings:
    return Settings(
        database_url=_required("DATABASE_URL"),
        model_path=os.environ.get("MODEL_PATH", "models/yolov8s.pt"),
        confidence_threshold=float(os.environ.get("CONFIDENCE_THRESHOLD", "0.4")),
        species_confidence_threshold=float(os.environ.get("SPECIES_CONFIDENCE_THRESHOLD", "0.3")),
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8001")),
        openrouter_api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        openrouter_model=os.environ.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-4"),
        yolo_device=os.environ.get("YOLO_DEVICE", "cuda"),
        yolo_workers=int(os.environ.get("YOLO_WORKERS", "4")),
        yolo_batch_size=int(os.environ.get("YOLO_BATCH_SIZE", "32")),
        db_pool_max=int(os.environ.get("DB_POOL_MAX", "20")),
        batch_concurrency=int(os.environ.get("BATCH_CONCURRENCY", "4")),
        http_timeout=int(os.environ.get("HTTP_TIMEOUT", "120")),
        vlm_concurrency=int(os.environ.get("VLM_CONCURRENCY", "8")),
        image_storage_dir=os.environ.get("IMAGE_STORAGE_DIR", "/app/images"),
        # Satellite (optional)
        inpe_email=os.environ.get("INPE_EMAIL", ""),
        max_cloud_cover=float(os.environ.get("MAX_CLOUD_COVER", "80")),
        date_search_range_days=int(os.environ.get("DATE_SEARCH_RANGE_DAYS", "7")),
    )
