"""CLI for batch satellite detection.

Usage:
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
from .satellite import Cbers4aFetcher
from .detector import AnimalDetector
from .classifier import SpeciesClassifier
from .pipeline import DetectionPipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def run_batch(args: argparse.Namespace) -> None:
    settings = load_settings()

    db = Database(settings)
    await db.connect()
    logger.info("Database connected")

    fetcher = Cbers4aFetcher(settings)

    detector = AnimalDetector(settings)
    detector.load()

    classifier = SpeciesClassifier(settings)
    classifier.load()

    pipeline = DetectionPipeline(settings, db, fetcher, detector, classifier)

    area_ids: Optional[list[int]] = None
    if args.area_ids:
        area_ids = [int(x) for x in args.area_ids.split(",") if x.strip()]

    logger.info("Starting batch for date=%s, area_ids=%s", args.date, area_ids)
    results = await pipeline.run_batch(args.date, area_ids)

    print()
    print("==> Batch summary:")
    print(f"    Total areas:    {results['total_areas']}")
    print(f"    Processed:      {results['processadas']}")
    print(f"    Errors:         {results['erros']}")
    print(f"    Detections:     {results['total_deteccoes']}")

    await db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="BioGuardians ML batch CLI — satellite detection for protected areas",
    )
    sub = parser.add_subparsers(dest="command")

    batch_parser = sub.add_parser("batch", help="Process all protected areas")
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
