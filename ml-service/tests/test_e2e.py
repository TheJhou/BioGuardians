"""End-to-end smoke test: Fase 1 (YOLO detection) + Fase 2 (VLM classification).

Processes a few WI images through the full pipeline with GPU and VLM.
"""
import asyncio
import os
import sys

os.environ.setdefault("DATABASE_URL", "postgresql://thejhoudev:q98kCoEp@163.176.231.121:5432/bioguardians")
os.environ.setdefault("IMAGE_STORAGE_DIR", "/app/images")
os.environ.setdefault("YOLO_DEVICE", "cuda")
os.environ.setdefault("YOLO_BATCH_SIZE", "16")
os.environ.setdefault("VLM_CONCURRENCY", "4")

sys.path.insert(0, "/app")

from app.config import load_settings
from app.db import Database
from app.detector import AnimalDetector
from app.classifier import SpeciesClassifier
from app.pipeline import DetectionPipeline
from app.sources.camera_trap import CameraTrapSource


async def main():
    settings = load_settings()
    print(f"YOLO device: {settings.yolo_device}")
    print(f"OpenRouter model: {settings.openrouter_model}")

    db = Database(settings)
    await db.connect()
    print("Database connected")

    detector = AnimalDetector(settings)
    detector.load()
    print(f"YOLO loaded")

    classifier = SpeciesClassifier(settings)
    classifier.load()
    print(f"Classifier loaded ({'vlm' if settings.openrouter_api_key else 'heuristic'})")

    pipeline = DetectionPipeline(settings, db, detector, classifier)

    # Fase 1: Detection
    print("\n=== FASE 1: Detection ===")
    source = CameraTrapSource(data_dir="/data/wi", limit=5)
    job_id = await db.create_job(source="camera_trap", data_dir="/data/wi")
    print(f"Created job {job_id}")

    total = await pipeline.run(job_id, source)
    print(f"Fase 1 complete: {total} detections")

    # Fase 2: Classification
    print("\n=== FASE 2: Classification ===")
    classified = await pipeline.classify_pending(limit=10)
    print(f"Fase 2 complete: {classified} classified")

    # Summary
    job = await db.get_job(job_id)
    dets = await db.get_job_detections(job_id)
    print(f"\n=== Summary ===")
    print(f"Job {job_id}: {job['status']}, {job['total_deteccoes']} detections")
    for d in dets:
        print(f"  det {d['id']}: {d.get('nome_cientifico') or '?'} "
              f"conf={d['confianca']} status={d['status']} "
              f"metodo={d['metodo_classificacao']} "
              f"especie_id={d.get('especie_id')}")

    await db.close()


asyncio.run(main())
