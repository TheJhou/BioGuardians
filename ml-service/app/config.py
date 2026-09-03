"""Configuration loaded from environment variables.

The ML service runs locally on a machine with GPU (RTX 4060).
It classifies camera trap images using a local fine-tuned VLM
(Qwen2-VL-2B) with OpenRouter/Claude as fallback.
"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    # VLM device (cuda or cpu)
    yolo_device: str           # reused as VLM device — "cuda" or "cpu"
    # OpenRouter (fallback VLM)
    openrouter_api_key: str
    openrouter_model: str
    http_timeout: int          # timeout for OpenRouter API calls (seconds)
    # Species classification threshold
    species_confidence_threshold: float
    # API server
    host: str
    port: int
    # Database pool
    db_pool_max: int
    # VLM concurrency (simultaneous OpenRouter calls)
    vlm_concurrency: int
    # Image storage / cache
    image_storage_dir: str


def _required(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val


def load_settings() -> Settings:
    return Settings(
        database_url=_required("DATABASE_URL"),
        yolo_device=os.environ.get("YOLO_DEVICE", "cuda"),
        openrouter_api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        openrouter_model=os.environ.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-4"),
        http_timeout=int(os.environ.get("HTTP_TIMEOUT", "120")),
        species_confidence_threshold=float(os.environ.get("SPECIES_CONFIDENCE_THRESHOLD", "0.3")),
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8001")),
        db_pool_max=int(os.environ.get("DB_POOL_MAX", "20")),
        vlm_concurrency=int(os.environ.get("VLM_CONCURRENCY", "8")),
        image_storage_dir=os.environ.get("IMAGE_STORAGE_DIR", "/app/images"),
    )
