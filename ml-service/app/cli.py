"""CLI for the ML service.

Usage:
  # Process images (classify directly with VLM — no YOLO)
  python -m app.cli ingest --source camera_trap --data-dir /data/wildlife-insights
  python -m app.cli ingest --source camera_trap --data-dir /data/wi --limit 50
  python -m app.cli ingest --source local_dir --data-dir /data/test-images

  # Reclassify pending detections from old YOLO runs
  python -m app.cli classify --limit 100
  python -m app.cli classify --all

  # Check job status
  python -m app.cli status --job-id 42

  # Prepare fine-tuning dataset (download + format)
  python -m app.cli prepare-dataset --data-dir /data/wi --output-dir /data/dataset

  # Fine-tune Qwen2-VL-2B with QLoRA
  python -m app.cli finetune --dataset-dir /data/dataset --output-dir /models/qwen2vl-finetuned
"""

import argparse
import asyncio
import logging
from datetime import date
from typing import Optional

from .config import load_settings
from .db import Database
from .local_classifier import LocalVLMClassifier
from .pipeline import ClassificationPipeline
from .sources.local_dir import LocalDirectorySource
from .sources.camera_trap import CameraTrapSource

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def run_ingest(args: argparse.Namespace) -> None:
    """Process images: classify each with VLM and save to DB."""
    settings = load_settings()

    db = Database(settings)
    await db.connect()
    logger.info("Database connected")

    classifier = LocalVLMClassifier(settings)
    classifier.load()

    pipeline = ClassificationPipeline(settings, db, classifier)

    # Create job
    job_id = await db.create_job(
        source=args.source,
        data_dir=args.data_dir,
        project_id=getattr(args, "project_id", None),
        p_limit=getattr(args, "limit", None),
    )
    logger.info("Created job %d (source=%s, data_dir=%s, limit=%s)",
                job_id, args.source, args.data_dir, getattr(args, "limit", None))

    # Build source and run
    if args.source == "camera_trap":
        source = CameraTrapSource(
            data_dir=args.data_dir,
            project_id=getattr(args, "project_id", None),
            limit=getattr(args, "limit", None),
        )
    elif args.source == "local_dir":
        source = LocalDirectorySource(directory=args.data_dir)
    else:
        logger.error("Unknown source: %s", args.source)
        await db.close()
        return

    total = await pipeline.run(job_id, source)

    print()
    print("==> Classification complete:")
    print(f"    Job ID:       {job_id}")
    print(f"    Source:       {args.source}")
    print(f"    Classified:   {total}")

    await db.close()


async def run_classify(args: argparse.Namespace) -> None:
    """Reclassify pending detections from old YOLO runs."""
    settings = load_settings()

    db = Database(settings)
    await db.connect()
    logger.info("Database connected")

    classifier = LocalVLMClassifier(settings)
    classifier.load()

    pipeline = ClassificationPipeline(settings, db, classifier)

    if args.all:
        total_classified = 0
        while True:
            count = await pipeline.classify_pending(limit=args.limit)
            if count == 0:
                break
            total_classified += count
            print(f"  Classified {count} detections (total: {total_classified})")
        print()
        print(f"==> Reclassification complete: {total_classified} detections")
    else:
        count = await pipeline.classify_pending(limit=args.limit)
        print()
        print(f"==> Classified {count} detections")

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
    print(f"  Total classified:    {job['total_deteccoes']}")
    print(f"  Total images:        {job.get('total_imagens', 0)}")
    print(f"  Images processed:    {job.get('imagens_processadas', 0)}")
    print(f"  Created:             {job.get('criado_em', '?')}")
    print(f"  Completed:           {job.get('concluido_em', '—')}")
    if job.get("erro"):
        print(f"  Error:               {job['erro']}")

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
        print(f"    Pending:    {counts['pending']}")
        print(f"    Classified: {counts['classified']}")
        print(f"    Rejected:   {counts['rejected']}")
        print(f"    Inconclusive: {counts['inconclusive']}")

    await db.close()


def run_prepare_dataset(args: argparse.Namespace) -> None:
    """Prepare fine-tuning dataset from WI export."""
    from .train.prepare_dataset import prepare_dataset
    prepare_dataset(
        data_dir=args.data_dir,
        output_dir=args.output_dir,
        min_per_species=args.min_per_species,
        val_ratio=args.val_ratio,
        max_per_species=args.max_per_species,
    )


def run_finetune(args: argparse.Namespace) -> None:
    """Fine-tune Qwen2-VL-2B with QLoRA."""
    from .train.finetune import finetune
    finetune(
        dataset_dir=args.dataset_dir,
        output_dir=args.output_dir,
        epochs=args.epochs,
        batch_size=args.batch_size,
        grad_accum=args.grad_accum,
        lr=args.lr,
        lora_r=args.lora_r,
        lora_alpha=args.lora_alpha,
        max_samples=args.max_samples,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="BioGuardians ML CLI — VLM-based species classification",
    )
    sub = parser.add_subparsers(dest="command")

    # ingest — process images (classify with VLM)
    ingest_parser = sub.add_parser("ingest", help="Process and classify images")
    ingest_parser.add_argument(
        "--source", type=str, required=True,
        choices=["camera_trap", "local_dir"],
        help="Image source type",
    )
    ingest_parser.add_argument(
        "--data-dir", type=str, required=True,
        help="Path to the dataset directory",
    )
    ingest_parser.add_argument(
        "--project-id", type=str, default=None,
        help="Filter to a single project (camera_trap only)",
    )
    ingest_parser.add_argument(
        "--limit", type=int, default=None,
        help="Max images to process (for testing)",
    )
    ingest_parser.set_defaults(func=run_ingest)

    # classify — reclassify pending detections
    classify_parser = sub.add_parser("classify", help="Reclassify pending detections")
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

    # prepare-dataset — download + format WI images for fine-tuning
    dataset_parser = sub.add_parser("prepare-dataset", help="Prepare fine-tuning dataset from WI export")
    dataset_parser.add_argument(
        "--data-dir", type=str, required=True,
        help="WI export directory (with images.csv)",
    )
    dataset_parser.add_argument(
        "--output-dir", type=str, required=True,
        help="Where to save the dataset",
    )
    dataset_parser.add_argument(
        "--min-per-species", type=int, default=10,
        help="Minimum images per species to include (default: 10)",
    )
    dataset_parser.add_argument(
        "--max-per-species", type=int, default=0,
        help="Cap images per species (0=no limit)",
    )
    dataset_parser.add_argument(
        "--val-ratio", type=float, default=0.15,
        help="Validation split ratio (default: 0.15)",
    )
    dataset_parser.set_defaults(func=run_prepare_dataset)

    # finetune — train Qwen2-VL-2B with QLoRA
    finetune_parser = sub.add_parser("finetune", help="Fine-tune Qwen2-VL-2B with QLoRA")
    finetune_parser.add_argument(
        "--dataset-dir", type=str, required=True,
        help="Dataset directory (with train.jsonl, val.jsonl)",
    )
    finetune_parser.add_argument(
        "--output-dir", type=str, required=True,
        help="Where to save the LoRA adapter",
    )
    finetune_parser.add_argument(
        "--epochs", type=int, default=3,
        help="Number of training epochs (default: 3)",
    )
    finetune_parser.add_argument(
        "--batch-size", type=int, default=2,
        help="Micro-batch size (default: 2 for 8GB VRAM)",
    )
    finetune_parser.add_argument(
        "--grad-accum", type=int, default=8,
        help="Gradient accumulation steps (default: 8)",
    )
    finetune_parser.add_argument(
        "--lr", type=float, default=2e-4,
        help="Learning rate (default: 2e-4)",
    )
    finetune_parser.add_argument(
        "--lora-r", type=int, default=16,
        help="LoRA rank (default: 16)",
    )
    finetune_parser.add_argument(
        "--lora-alpha", type=int, default=32,
        help="LoRA alpha (default: 32)",
    )
    finetune_parser.add_argument(
        "--max-samples", type=int, default=0,
        help="Limit total samples (0=all, for testing)",
    )
    finetune_parser.set_defaults(func=run_finetune)

    args = parser.parse_args()
    if hasattr(args, "func"):
        import inspect
        if inspect.iscoroutinefunction(args.func):
            asyncio.run(args.func(args))
        else:
            args.func(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
