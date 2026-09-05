"""Download ALL images from the WI export, regardless of label.

Unlike prepare_dataset (which filters to labeled species for training),
this downloads every row with a valid image_id + location URL —
including blanks and unidentified images — so the OpenRouter pipeline
can classify them all.

Already-cached images are skipped, so it resumes safely.

Run inside the container:
    WI_EMAIL=... WI_PASSWORD=... python tests/download_all.py
"""
import csv
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, "/app")
from app.train.prepare_dataset import WIDownloader, TokenBucket

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

data_dir = Path("/data/wi")
output_dir = Path("/data/dataset")
images_dir = output_dir / "images"
images_dir.mkdir(parents=True, exist_ok=True)

email = os.environ.get("WI_EMAIL", "")
password = os.environ.get("WI_PASSWORD", "")
if not email or not password:
    raise RuntimeError("WI_EMAIL and WI_PASSWORD required")

rate_limiter = TokenBucket(rate=6.0, capacity=8.0)
downloader = WIDownloader(email, password, images_dir, rate_limiter)

rows = []
with open(data_dir / "images.csv", "r", encoding="utf-8", newline="") as f:
    for row in csv.DictReader(f):
        image_id = row.get("image_id", "").strip()
        location = row.get("location", "").strip()
        if image_id and location:
            rows.append((image_id, location))

total = len(rows)
logger.info("Downloading %d images (cached ones are skipped)", total)

downloaded = 0
failed = 0
with ThreadPoolExecutor(max_workers=8) as pool:
    futures = {
        pool.submit(downloader.download, iid, loc): iid
        for iid, loc in rows
    }
    for fut in as_completed(futures):
        try:
            path = fut.result()
        except Exception as exc:
            logger.warning("Error for %s: %s", futures[fut], exc)
            path = None
        if path is None:
            failed += 1
        else:
            downloaded += 1
        done = downloaded + failed
        if done % 500 == 0:
            logger.info("Progress: %d/%d ok, %d failed (%.0f%%)",
                        downloaded, total, failed, 100 * done / total)

logger.info("Done: %d downloaded, %d failed of %d", downloaded, failed, total)
