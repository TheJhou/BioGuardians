"""Camera trap dataset image source — Wildlife Insights export.

Parses a Wildlife Insights "all-platform-data" export:

    <data_dir>/
        projects.csv     — project metadata (not used by the pipeline directly)
        cameras.csv      — camera hardware info
        deployments.csv  — camera_id, lat/lon, start/end dates, placename
        sequences.csv    — grouped image sequences (not used by the pipeline)
        images.csv       — one row per image with URL, taxonomy, timestamp

Pipeline behaviour:
1. Parse deployments.csv to build a deployment_id -> (lat, lon, camera info) map
2. Stream images.csv row by row
3. Skip rows where is_blank=1 or species is empty or class is missing
4. Skip Homo sapiens (researchers, etc.)
5. Download the image from the location URL if it has not been cached
6. Yield an ImageItem with lat/lon/timestamp/camera_id/project_id/deployment_id

Images are downloaded lazily as the pipeline iterates — not all upfront.
A local cache under `IMAGE_STORAGE_DIR`/camera_trap/ avoids re-downloading
images across runs. The cache filename is the WI image_id (UUID).
"""

import csv
import hashlib
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional

import httpx

from .base import ImageItem

logger = logging.getLogger(__name__)


class CameraTrapSource:
    """Image source for Wildlife Insights camera trap exports."""

    def __init__(
        self,
        data_dir: str,
        project_id: Optional[str] = None,
        limit: Optional[int] = None,
    ):
        """
        Args:
            data_dir: path to the WI export directory (contains the CSVs)
            project_id: optional filter — only process images from this project
            limit: optional cap on number of images to yield (for testing)
        """
        self._data_dir = Path(data_dir)
        self._project_id = project_id
        self._limit = limit

        from ..config import load_settings
        settings = load_settings()
        self._storage_dir = Path(settings.image_storage_dir) / "camera_trap"
        self._storage_dir.mkdir(parents=True, exist_ok=True)

        # deployment_id -> {"lat": float, "lon": float, "camera_id": str, "placename": str}
        self._deployments = self._load_deployments()

    def _load_deployments(self) -> dict:
        """Load deployments.csv into a lookup map."""
        deployments = {}
        csv_path = self._data_dir / "deployments.csv"
        if not csv_path.exists():
            logger.warning("deployments.csv not found in %s", self._data_dir)
            return deployments

        with open(csv_path, "r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                did = row.get("deployment_id", "").strip()
                if not did:
                    continue
                try:
                    deployments[did] = {
                        "lat": float(row.get("latitude", 0)),
                        "lon": float(row.get("longitude", 0)),
                        "camera_id": row.get("camera_id", "").strip(),
                        "placename": row.get("placename", "").strip(),
                    }
                except (ValueError, TypeError):
                    continue

        logger.info("Loaded %d deployments from CSV", len(deployments))
        return deployments

    def _download_image(self, image_id: str, url: str) -> Optional[Path]:
        """Download an image from a URL to the local cache.

        Returns the local path, or None if download fails.
        """
        dest = self._storage_dir / f"{image_id}.jpg"

        # Skip if already cached
        if dest.exists() and dest.stat().st_size > 0:
            return dest

        try:
            with httpx.Client(timeout=60, follow_redirects=True) as client:
                resp = client.get(url)
                resp.raise_for_status()
            dest.write_bytes(resp.content)
            logger.debug("Downloaded %s -> %s", url, dest)
            return dest
        except Exception as exc:
            logger.warning("Failed to download image %s from %s: %s", image_id, url, exc)
            return None

    def _compute_hash(self, path: Path) -> str:
        """Compute SHA-256 hash of a file for deduplication."""
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()

    def _parse_timestamp(self, ts: str) -> Optional[datetime]:
        """Parse Wildlife Insights timestamp: '2026-04-05 23:07:22'."""
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(ts.strip(), fmt)
            except ValueError:
                continue
        # Fallback: try date only
        try:
            return datetime.strptime(ts.strip()[:10], "%Y-%m-%d")
        except ValueError:
            return None

    def iter_images(self) -> Iterator[ImageItem]:
        """Yield ImageItem objects from the Wildlife Insights export."""
        csv_path = self._data_dir / "images.csv"
        if not csv_path.exists():
            raise FileNotFoundError(f"images.csv not found in {self._data_dir}")

        logger.info("Streaming images.csv from %s", csv_path)

        count = 0
        skipped_blank = 0
        skipped_no_species = 0
        skipped_human = 0
        skipped_no_image_url = 0
        skipped_download = 0

        with open(csv_path, "r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if self._limit and count >= self._limit:
                    break

                # Filter by project if specified
                if self._project_id:
                    if row.get("project_id", "").strip() != self._project_id:
                        continue

                # Skip blank images
                is_blank = row.get("is_blank", "").strip().lower() in ("1", "true", "yes")
                if is_blank:
                    skipped_blank += 1
                    continue

                # Skip humans and unidentified
                genus = row.get("genus", "").strip()
                species = row.get("species", "").strip()
                image_class = row.get("class", "").strip()

                if genus == "Homo" and species == "sapiens":
                    skipped_human += 1
                    continue

                # Skip if no species identified (only genus/family-level IDs are
                # too vague for our pipeline — YOLO + VLM will classify from scratch)
                if not species or species == "Blank" or not image_class:
                    skipped_no_species += 1
                    continue

                image_id = row.get("image_id", "").strip()
                location = row.get("location", "").strip()

                if not image_id or not location:
                    skipped_no_image_url += 1
                    continue

                # Download image to local cache
                local_path = self._download_image(image_id, location)
                if local_path is None:
                    skipped_download += 1
                    continue

                # Resolve lat/lon from deployment
                deployment_id = row.get("deployment_id", "").strip()
                dep = self._deployments.get(deployment_id, {})
                lat = dep.get("lat")
                lon = dep.get("lon")

                # Parse timestamp
                ts_str = row.get("timestamp", "")
                timestamp = self._parse_timestamp(ts_str) if ts_str else None

                # Compute hash for dedup
                image_hash = self._compute_hash(local_path)

                # Build extra metadata for the pipeline
                extra = {
                    "common_name": row.get("common_name", "").strip(),
                    "genus": genus,
                    "species": species,
                    "order": row.get("order", "").strip(),
                    "family": row.get("family", "").strip(),
                    "cv_confidence": row.get("cv_confidence", "").strip(),
                    "uncertainty": row.get("uncertainty", "").strip(),
                    "license": row.get("license", "").strip(),
                    "is_blank": False,  # we filtered blanks
                    "wi_taxon_id": row.get("wi_taxon_id", "").strip(),
                    "wi_location_url": location,
                    "sequence_id": row.get("sequence_id", "").strip(),
                    "identified_by": row.get("identified_by", "").strip(),
                    "fuzzed": row.get("fuzzed", "").strip().lower() == "true",
                    "deployment_fuzzed": dep.get("placename", "") == "" and row.get("deployment_fuzzed", "").strip().lower() == "true",
                }

                yield ImageItem(
                    image_id=image_id,
                    path=str(local_path),
                    source="camera_trap",
                    lat=lat,
                    lon=lon,
                    timestamp=timestamp,
                    camera_id=dep.get("camera_id") or None,
                    project_id=row.get("project_id", "").strip() or None,
                    deployment_id=deployment_id or None,
                    image_hash=image_hash,
                    extra=extra,
                )

                count += 1

        logger.info(
            "CameraTrapSource: yielded %d images (skipped: blank=%d, no_species=%d, "
            "human=%d, no_url=%d, download_fail=%d)",
            count, skipped_blank, skipped_no_species, skipped_human,
            skipped_no_image_url, skipped_download,
        )
