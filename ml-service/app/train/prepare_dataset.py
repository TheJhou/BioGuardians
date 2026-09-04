"""Download Wildlife Insights images and prepare a fine-tuning dataset.

Downloads all trainable images (non-blank, non-human, with species label)
from the WI export via the authenticated GraphQL API, then creates
train/val JSONL files formatted for Qwen2-VL fine-tuning.

Usage:
    python -m app.train.prepare_dataset \
        --data-dir /data/wi \
        --output-dir /data/dataset \
        --min-per-species 10

Output structure:
    /data/dataset/
        images/          # downloaded .jpg files
        train.jsonl      # training split
        val.jsonl        # validation split
        species.json     # label mapping
"""

import argparse
import csv
import json
import logging
import os
import random
import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

WI_API_BASE = "https://api.wildlifeinsights.org"
WI_GRAPHQL = WI_API_BASE + "/graphql-data-file"
WI_SIGNIN = WI_API_BASE + "/v1/auth/sign-in"

GQL_GET_URL = """query ($downloadId: Int!, $projectId: Int, $imageUUID: String!) {
  getDataFilePublicDownloadUrl(downloadId: $downloadId, projectId: $projectId, imageUUID: $imageUUID) {
    url
  }
}"""

VIEWER_URL_RE = re.compile(r"/download/(\d+)/project/(\d+)/data-files/([0-9a-f\-]+)")


class TokenBucket:
    """Thread-safe token bucket rate limiter."""

    def __init__(self, rate: float, capacity: float):
        self.rate = rate          # tokens per second
        self.capacity = capacity  # burst capacity
        self.tokens = capacity
        self.last = time.time()
        self.lock = threading.Lock()

    def acquire(self):
        with self.lock:
            now = time.time()
            elapsed = now - self.last
            self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
            self.last = now
            if self.tokens < 1.0:
                wait = (1.0 - self.tokens) / self.rate
                time.sleep(wait)
                self.tokens = 0.0
            else:
                self.tokens -= 1.0


class WIDownloader:
    """Download images from Wildlife Insights via authenticated GraphQL."""

    def __init__(self, email: str, password: str, cache_dir: Path, rate_limiter: TokenBucket):
        self._email = email
        self._password = password
        self._cache_dir = cache_dir
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._token: Optional[str] = None
        self._token_expires: float = 0
        self._client = httpx.Client(timeout=60, follow_redirects=True)
        self._rate_limiter = rate_limiter

    def _ensure_token(self) -> str:
        if self._token and time.time() < self._token_expires - 60:
            return self._token
        logger.info("Logging in to WI as %s", self._email)
        r = self._client.post(
            WI_SIGNIN,
            json={"email": self._email, "password": self._password},
        )
        r.raise_for_status()
        self._token = r.json()["token"]
        self._token_expires = time.time() + 23 * 3600
        logger.info("Token acquired")
        return self._token

    def _parse_url(self, url: str) -> Optional[dict]:
        m = VIEWER_URL_RE.search(url)
        if not m:
            return None
        return {
            "downloadId": int(m.group(1)),
            "projectId": int(m.group(2)),
            "imageUUID": m.group(3),
        }

    def download(self, image_id: str, viewer_url: str) -> Optional[Path]:
        dest = self._cache_dir / f"{image_id}.jpg"
        if dest.exists() and dest.stat().st_size > 0:
            return dest

        params = self._parse_url(viewer_url)
        if not params:
            logger.warning("Cannot parse URL for %s", image_id)
            return None

        for attempt in range(5):
            try:
                token = self._ensure_token()
                # Global rate limiter to avoid WI API 429s and keep GCS busy
                self._rate_limiter.acquire()
                r = self._client.post(
                    WI_GRAPHQL,
                    json={"query": GQL_GET_URL, "variables": params},
                    headers={"Authorization": f"Bearer {token}"},
                )
                if r.status_code == 401:
                    self._token = None
                    continue
                if r.status_code == 429:
                    wait = min(60, 2 ** attempt) + random.uniform(0, 2)
                    logger.warning("Rate limited for %s, waiting %.1fs", image_id, wait)
                    time.sleep(wait)
                    continue
                r.raise_for_status()
                data = r.json()
                result = (data.get("data") or {}).get("getDataFilePublicDownloadUrl")
                if not result or not result.get("url"):
                    logger.warning("No URL for %s (attempt %d)", image_id, attempt + 1)
                    time.sleep(1)
                    continue

                gcs_url = result["url"]
                img_resp = self._client.get(gcs_url)
                img_resp.raise_for_status()

                ct = img_resp.headers.get("content-type", "")
                # GCS sometimes returns application/octet-stream for JPEGs
                if not ct.startswith("image/") and ct != "application/octet-stream":
                    logger.warning("Not image for %s: %s", image_id, ct)
                    return None

                # Verify it's actually an image by checking magic bytes
                content = img_resp.content
                if not (content[:2] == b'\xff\xd8' or content[:4] == b'\x89PNG'):
                    logger.warning("Invalid image magic bytes for %s", image_id)
                    return None

                dest.write_bytes(img_resp.content)
                return dest

            except Exception as exc:
                logger.warning("Download failed for %s (attempt %d): %s",
                               image_id, attempt + 1, exc)
                self._token = None
                time.sleep(2)

        return None


def prepare_dataset(data_dir: str, output_dir: str, min_per_species: int = 10,
                    val_ratio: float = 0.15, max_per_species: int = 0,
                    max_total: int = 0):
    """Download images and create train/val JSONL files.

    Args:
        data_dir: WI export directory (with images.csv, deployments.csv)
        output_dir: where to save the dataset
        min_per_species: minimum images per species to include
        val_ratio: fraction of images per species for validation
        max_per_species: cap images per species (0 = no limit)
        max_total: cap total images across all species (0 = no limit)
    """
    data_dir = Path(data_dir)
    output_dir = Path(output_dir)
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    email = os.environ.get("WI_EMAIL", "")
    password = os.environ.get("WI_PASSWORD", "")
    if not email or not password:
        raise RuntimeError("WI_EMAIL and WI_PASSWORD required")

    # 6 GraphQL req/s with burst of 8; tune if 429s appear
    rate_limiter = TokenBucket(rate=6.0, capacity=8.0)
    downloader = WIDownloader(email, password, images_dir, rate_limiter)

    # Load deployments for coordinates
    deployments = {}
    dep_path = data_dir / "deployments.csv"
    if dep_path.exists():
        with open(dep_path, "r", encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                did = row.get("deployment_id", "").strip()
                if did:
                    try:
                        deployments[did] = {
                            "lat": float(row.get("latitude", 0)),
                            "lon": float(row.get("longitude", 0)),
                        }
                    except (ValueError, TypeError):
                        pass

    # Parse images.csv and group by species
    species_records = defaultdict(list)
    csv_path = data_dir / "images.csv"

    logger.info("Parsing %s", csv_path)
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            is_blank = row.get("is_blank", "").strip().lower() in ("1", "true", "yes")
            common = row.get("common_name", "").strip()
            if is_blank or common.lower() == "blank":
                continue

            genus = row.get("genus", "").strip()
            species = row.get("species", "").strip()
            img_class = row.get("class", "").strip()
            if genus == "Homo" and species == "sapiens":
                continue
            if not species or not img_class:
                continue

            image_id = row.get("image_id", "").strip()
            location = row.get("location", "").strip()
            if not image_id or not location:
                continue

            scientific = f"{genus} {species}"
            dep_id = row.get("deployment_id", "").strip()
            dep = deployments.get(dep_id, {})

            species_records[scientific].append({
                "image_id": image_id,
                "location": location,
                "scientific": scientific,
                "common_name": common,
                "class": img_class,
                "order": row.get("order", "").strip(),
                "family": row.get("family", "").strip(),
                "genus": genus,
                "species": species,
                "lat": dep.get("lat"),
                "lon": dep.get("lon"),
                "timestamp": row.get("timestamp", "").strip(),
            })

    # Filter species with enough images
    valid_species = {
        sp: records for sp, records in species_records.items()
        if len(records) >= min_per_species
    }

    logger.info("Total species: %d, valid (>= %d images): %d",
                len(species_records), min_per_species, len(valid_species))
    logger.info("Total trainable images: %d",
                sum(len(r) for r in valid_species.values()))

    # Create species label mapping
    species_map = {}
    for i, sp in enumerate(sorted(valid_species.keys())):
        records = valid_species[sp]
        species_map[sp] = {
            "id": i,
            "scientific": sp,
            "common_name": records[0]["common_name"],
            "class": records[0]["class"],
            "order": records[0]["order"],
            "family": records[0]["family"],
            "count": len(records),
        }

    with open(output_dir / "species.json", "w", encoding="utf-8") as f:
        json.dump(species_map, f, indent=2, ensure_ascii=False)

    # Download images with concurrent workers and create train/val splits
    train_records = []
    val_records = []
    total = sum(len(r) for r in valid_species.values())
    downloaded = 0
    failed = 0

    # Build the full list of items to download, tagged with split
    all_items = []
    for sp, records in valid_species.items():
        if max_per_species > 0 and len(records) > max_per_species:
            records = records[:max_per_species]
        val_count = max(1, int(len(records) * val_ratio))
        val_items = records[:val_count]
        train_items = records[val_count:]
        for item in val_items:
            all_items.append((item, "val"))
        for item in train_items:
            all_items.append((item, "train"))

    if max_total > 0 and len(all_items) > max_total:
        all_items = all_items[:max_total]

    # Download concurrently — 8 workers. WI API may rate-limit (429), handled
    # by exponential backoff; bursts are allowed, so 8 workers maximize throughput.
    results = {}  # image_id -> (local_path, item, split)
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {}
        for item, split in all_items:
            fut = pool.submit(downloader.download, item["image_id"], item["location"])
            futures[fut] = (item, split)

        for fut in as_completed(futures):
            item, split = futures[fut]
            try:
                local_path = fut.result()
            except Exception as exc:
                logger.warning("Error for %s: %s", item["image_id"], exc)
                local_path = None

            if local_path is None:
                failed += 1
            else:
                downloaded += 1
                results[item["image_id"]] = (local_path, item, split)

            done = downloaded + failed
            if done % 100 == 0:
                logger.info("Progress: %d/%d downloaded, %d failed (%.0f%%)",
                            downloaded, total, failed, 100 * done / len(all_items))

    # Build records in original order (train first, then val)
    for item, split in all_items:
        r = results.get(item["image_id"])
        if r is None:
            continue
        local_path, _, _ = r
        record = {
            "image_id": item["image_id"],
            "image_path": str(local_path),
            "scientific": item["scientific"],
            "common_name": item["common_name"],
            "class": item["class"],
            "order": item["order"],
            "family": item["family"],
            "genus": item["genus"],
            "species": item["species"],
            "lat": item["lat"],
            "lon": item["lon"],
            "timestamp": item["timestamp"],
        }
        if split == "val":
            val_records.append(record)
        else:
            train_records.append(record)

    # Write JSONL files
    with open(output_dir / "train.jsonl", "w", encoding="utf-8") as f:
        for r in train_records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    with open(output_dir / "val.jsonl", "w", encoding="utf-8") as f:
        for r in val_records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    logger.info("Dataset prepared: %d train, %d val, %d failed",
                len(train_records), len(val_records), failed)
    logger.info("Output: %s", output_dir)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(description="Prepare WI fine-tuning dataset")
    parser.add_argument("--data-dir", required=True, help="WI export directory")
    parser.add_argument("--output-dir", required=True, help="Dataset output directory")
    parser.add_argument("--min-per-species", type=int, default=10)
    parser.add_argument("--max-per-species", type=int, default=0,
                        help="Cap images per species (0=no limit)")
    parser.add_argument("--val-ratio", type=float, default=0.15)
    parser.add_argument("--max-total", type=int, default=0,
                        help="Cap total images (0=no limit)")
    args = parser.parse_args()

    prepare_dataset(
        data_dir=args.data_dir,
        output_dir=args.output_dir,
        min_per_species=args.min_per_species,
        val_ratio=args.val_ratio,
        max_per_species=args.max_per_species,
        max_total=args.max_total,
    )
