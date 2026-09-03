"""End-to-end smoke test: VLM classification (no YOLO).

Processes a few WI images through the full pipeline:
1. Download from WI via authenticated GraphQL
2. Classify with local VLM (or OpenRouter fallback)
3. Save species + occurrence to production DB
"""
import asyncio
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(name)s %(levelname)s: %(message)s")

os.environ.setdefault("DATABASE_URL", "postgresql://thejhoudev:q98kCoEp@163.176.231.121:5432/bioguardians")
os.environ.setdefault("IMAGE_STORAGE_DIR", "/app/images")
os.environ.setdefault("YOLO_DEVICE", "cuda")

sys.path.insert(0, "/app")

from app.config import load_settings
from app.db import Database
from app.local_classifier import LocalVLMClassifier
from app.pipeline import ClassificationPipeline
from app.sources.camera_trap import CameraTrapSource


async def main():
    settings = load_settings()
    print(f"Device: {settings.yolo_device}")
    print(f"OpenRouter model: {settings.openrouter_model}")

    db = Database(settings)
    await db.connect()
    print("Database connected")

    classifier = LocalVLMClassifier(settings)
    classifier.load()
    print(f"Classifier loaded (local={'yes' if classifier._model else 'no'}, openrouter={'yes' if settings.openrouter_api_key else 'no'})")

    pipeline = ClassificationPipeline(settings, db, classifier)

    # Process 5 images
    print("\n=== Processing ===")
    source = CameraTrapSource(data_dir="/data/wi", limit=5)
    job_id = await db.create_job(source="camera_trap", data_dir="/data/wi")
    print(f"Created job {job_id}")

    total = await pipeline.run(job_id, source)
    print(f"\nComplete: {total} classified")

    # Summary
    job = await db.get_job(job_id)
    dets = await db.get_job_detections(job_id)
    print(f"\n=== Summary ===")
    print(f"Job {job_id}: {job['status']}, {job['total_deteccoes']} classified")
    for d in dets:
        print(f"  det {d['id']}: {d.get('nome_cientifico') or '?'} "
              f"conf={d['confianca']} status={d['status']} "
              f"metodo={d['metodo_classificacao']} "
              f"especie_id={d.get('especie_id')}")

    await db.close()


asyncio.run(main())
