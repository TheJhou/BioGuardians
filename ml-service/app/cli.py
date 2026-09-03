"""CLI for the ML service.

Usage:
  # Submit a camera trap ingestion job (async — worker processes it)
  python -m app.cli ingest --source camera_trap --data-dir /data/wildlife-insights
  python -m app.cli ingest --source local_dir --data-dir /data/test-images

  # Classify pending detections (Fase 2 — VLM)
  python -m app.cli classify --limit 100
  python -m app.cli classify --all

  # Check job status
  python -m app.cli status --job-id 42

  # Legacy satellite batch (all protected areas for a date)
  python -m app.cli batch --date 2026-09-01
  python -m app.cli batch --date 2026-09-01 --area-ids 1,2,3
"""

import argparse
import asyncio
import logging
from datetime import date
from typing import Optional

from .config import load_settings
from .db import Database
from .detector import AnimalDetector
from .classifier import SpeciesClassifier
from .pipeline import DetectionPipeline
from .sources.local_dir import LocalDirectorySource
from .sources.camera_trap import CameraTrapSource

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def run_ingest(args: argparse.Namespace) -> None:
    """Submit an ingestion job and run it synchronously (CLI mode)."""
    settings = load_settings()

    db = Database(settings)
    await db.connect()
    logger.info("Database connected")

    detector = AnimalDetector(settings)
    detector.load()

    classifier = SpeciesClassifier(settings)
    classifier.load()

    pipeline = DetectionPipeline(settings, db, detector, classifier)

    # Create job
    job_id = await db.create_job(
        source=args.source,
        data_dir=args.data_dir,
    )
    logger.info("Created job %d (source=%s, data_dir=%s)", job_id, args.source, args.data_dir)

    # Build source and run synchronously
    if args.source == "camera_trap":
        source = CameraTrapSource(data_dir=args.data_dir)
    elif args.source == "local_dir":
        source = LocalDirectorySource(directory=args.data_dir)
    else:
        logger.error("Unknown source: %s", args.source)
        await db.close()
        return

    total = await pipeline.run(job_id, source)

    print()
    print("==> Detection complete:")
    print(f"    Job ID:       {job_id}")
    print(f"    Source:       {args.source}")
    print(f"    Detections:   {total}")
    print(f"    Run 'python -m app.cli classify --all' to classify pending detections")

    await db.close()


async def run_classify(args: argparse.Namespace) -> None:
    """Run Fase 2 classification on pending detections."""
    settings = load_settings()

    db = Database(settings)
    await db.connect()
    logger.info("Database connected")

    detector = AnimalDetector(settings)
    detector.load()

    classifier = SpeciesClassifier(settings)
    classifier.load()

    pipeline = DetectionPipeline(settings, db, detector, classifier)

    if args.all:
        total_classified = 0
        while True:
            count = await pipeline.classify_pending(limit=args.limit)
            if count == 0:
                break
            total_classified += count
            print(f"  Classified {count} detections (total: {total_classified})")
        print()
        print(f"==> Classification complete: {total_classified} detections classified")
    else:
        count = await pipeline.classify_pending(limit=args.limit)
        print()
        print(f"==> Classified {count} detections")
        if count == args.limit:
            print(f"    More pending — run again or use --all")

    await db.close()


async def run_status(args: argparse.Namespace) -> None:
    """Show job status and progress."""
    settings = load_settings()

    db = Database(settings)
    await db.connect()

    job = await db.get_job(args.job_id)
    if not job:
        print(f"Job {args.job_id} not found")
        await db.close()
        return

    print(f"Job {job['id']}:")
    print(f"  Status:              {job['status']}")
    print(f"  Source:              {job.get('source', 'satellite')}")
    print(f"  Total detections:    {job['total_deteccoes']}")
    print(f"  Total images:        {job.get('total_imagens', 0)}")
    print(f"  Images processed:    {job.get('imagens_processadas', 0)}")
    print(f"  Created:             {job.get('criado_em', '?')}")
    print(f"  Completed:           {job.get('concluido_em', '—')}")
    if job.get("erro"):
        print(f"  Error:               {job['erro']}")

    # Detection status breakdown
    async with db._pool.acquire() as conn:
        counts = await conn.fetchrow(
            """SELECT
                   COUNT(*) FILTER (WHERE status = 'detected') AS pending,
                   COUNT(*) FILTER (WHERE status = 'classified') AS classified,
                   COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
                   COUNT(*) FILTER (WHERE status = 'inconclusive') AS inconclusive
               FROM deteccao WHERE job_id = $1""",
            args.job_id,
        )

    if counts:
        print()
        print("  Detection breakdown:")
        print(f"    Pending classification: {counts['pending']}")
        print(f"    Classified:              {counts['classified']}")
        print(f"    Rejected:                {counts['rejected']}")
        print(f"    Inconclusive:            {counts['inconclusive']}")

    await db.close()


async def run_batch(args: argparse.Namespace) -> None:
    """Legacy satellite batch — process all protected areas."""
    settings = load_settings()

    db = Database(settings)
    await db.connect()
    logger.info("Database connected")

    detector = AnimalDetector(settings)
    detector.load()

    classifier = SpeciesClassifier(settings)
    classifier.load()

    pipeline = DetectionPipeline(settings, db, detector, classifier)

    area_ids: Optional[list[int]] = None
    if args.area_ids:
        area_ids = [int(x) for x in args.area_ids.split(",") if x.strip()]

    logger.info("Starting satellite batch for date=%s, area_ids=%s", args.date, area_ids)
    results = await pipeline.run_batch_satellite(args.date, area_ids)

    print()
    print("==> Satellite batch summary:")
    print(f"    Total areas:    {results['total_areas']}")
    print(f"    Processed:      {results['processadas']}")
    print(f"    Errors:         {results['erros']}")
    print(f"    Detections:     {results['total_deteccoes']}")

    await db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="BioGuardians ML CLI — animal detection and classification",
    )
    sub = parser.add_subparsers(dest="command")

    # ingest — submit a camera trap / local dir job
    ingest_parser = sub.add_parser("ingest", help="Process images from a directory")
    ingest_parser.add_argument(
        "--source", type=str, required=True,
        choices=["camera_trap", "local_dir"],
        help="Image source type",
    )
    ingest_parser.add_argument(
        "--data-dir", type=str, required=True,
        help="Path to the dataset directory",
    )
    ingest_parser.set_defaults(func=run_ingest)

    # classify — Fase 2 VLM classification
    classify_parser = sub.add_parser("classify", help="Classify pending detections (Fase 2)")
    classify_parser.add_argument(
        "--limit", type=int, default=100,
        help="Max detections to classify per batch (default: 100)",
    )
    classify_parser.add_argument(
        "--all", action="store_true",
        help="Keep classifying until no pending detections remain",
    )
    classify_parser.set_defaults(func=run_classify)

    # status — show job progress
    status_parser = sub.add_parser("status", help="Show job status and progress")
    status_parser.add_argument(
        "--job-id", type=int, required=True,
        help="Job ID to check",
    )
    status_parser.set_defaults(func=run_status)

    # batch — legacy satellite batch
    batch_parser = sub.add_parser("batch", help="Legacy: satellite batch for all protected areas")
    batch_parser.add_argument(
        "--date", type=date.fromisoformat, required=True,
        help="Target satellite image date (YYYY-MM-DD)",
    )
    batch_parser.add_argument(
        "--area-ids", type=str, default=None,
        help="Comma-separated area IDs to process (default: all)",
    )
    batch_parser.set_defaults(func=run_batch)

    args = parser.parse_args()
    if hasattr(args, "func"):
        asyncio.run(args.func(args))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
