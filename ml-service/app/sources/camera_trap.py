"""Camera trap dataset image source — Wildlife Insights export.

Parses a Wildlife Insights "all-platform-data" export and downloads
images via the WI GraphQL API (requires WI_EMAIL + WI_PASSWORD).

Flow:
1. Login via POST /v1/auth/sign-in → JWT token
2. For each image in images.csv:
   a. Skip blanks, humans, unidentified
   b. Parse the viewer URL to extract downloadId, projectId, imageUUID
   c. Query POST /graphql-data-file { getDataFilePublicDownloadUrl }
      → returns a signed Google Cloud Storage URL
   d. Download the image from GCS to local cache
   e. Yield ImageItem with metadata from the CSV

The token expires after ~24h. For long runs, the source refreshes
the token if a 401 is returned.

Credentials come from WI_EMAIL and WI_PASSWORD env vars.
"""

import csv
import hashlib
import logging
import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional
from urllib.parse import urlparse

import httpx

from .base import ImageItem

logger = logging.getLogger(__name__)

WI_API_BASE = "https://api.wildlifeinsights.org"
WI_GRAPHQL_DATA_FILE = WI_API_BASE + "/graphql-data-file"
WI_SIGNIN_URL = WI_API_BASE + "/v1/auth/sign-in"

# GraphQL query to get a signed GCS URL for an image
GQL_GET_IMAGE_URL = """query ($downloadId: Int!, $projectId: Int, $imageUUID: String!) {
  getDataFilePublicDownloadUrl(downloadId: $downloadId, projectId: $projectId, imageUUID: $imageUUID) {
    url
  }
}"""

# Pattern: /download/{downloadId}/project/{projectId}/data-files/{imageUUID}
VIEWER_URL_RE = re.compile(
    r"/download/(\d+)/project/(\d+)/data-files/([0-9a-f\-]+)"
)


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

        # WI credentials for image download
        self._wi_email = os.environ.get("WI_EMAIL", "")
        self._wi_password = os.environ.get("WI_PASSWORD", "")
        self._token: Optional[str] = None
        self._token_expires: float = 0  # unix timestamp

        # deployment_id -> {"lat": float, "lon": float, "camera_id": str, "placename": str}
        self._deployments = self._load_deployments()

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    def _ensure_token(self) -> str:
        """Login to WI and cache the token. Refreshes if expired."""
        if self._token and time.time() < self._token_expires - 60:
            return self._token

        if not self._wi_email or not self._wi_password:
            raise RuntimeError(
                "WI_EMAIL and WI_PASSWORD env vars are required to download "
                "images from Wildlife Insights"
            )

        logger.info("Logging in to Wildlife Insights as %s", self._wi_email)
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                WI_SIGNIN_URL,
                json={"email": self._wi_email, "password": self._wi_password},
            )
            resp.raise_for_status()
            data = resp.json()

        self._token = data["token"]
        # Token expires in ~24h (86400s). Use 23h to be safe.
        self._token_expires = time.time() + 23 * 3600
        logger.info("WI token acquired (expires in ~23h)")
        return self._token

    # ------------------------------------------------------------------
    # Deployments
    # ------------------------------------------------------------------

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

    # ------------------------------------------------------------------
    # Image download via WI GraphQL API
    # ------------------------------------------------------------------

    def _parse_viewer_url(self, url: str) -> Optional[dict]:
        """Extract downloadId, projectId, imageUUID from a WI viewer URL.

        URL format: https://app.wildlifeinsights.org/download/{downloadId}/project/{projectId}/data-files/{imageUUID}
        """
        m = VIEWER_URL_RE.search(url)
        if not m:
            return None
        return {
            "downloadId": int(m.group(1)),
            "projectId": int(m.group(2)),
            "imageUUID": m.group(3),
        }

    def _get_image_url(self, download_id: int, project_id: int, image_uuid: str) -> Optional[str]:
        """Query WI GraphQL for the signed GCS URL of an image.

        Retries once with a fresh token if we get 401.
        """
        variables = {
            "downloadId": download_id,
            "projectId": project_id,
            "imageUUID": image_uuid,
        }

        for attempt in range(2):
            token = self._ensure_token()
            try:
                with httpx.Client(timeout=30) as client:
                    resp = client.post(
                        WI_GRAPHQL_DATA_FILE,
                        json={"query": GQL_GET_IMAGE_URL, "variables": variables},
                        headers={"Authorization": f"Bearer {token}"},
                    )

                if resp.status_code == 401:
                    logger.warning("WI token expired, refreshing (attempt %d)", attempt + 1)
                    self._token = None
                    continue

                resp.raise_for_status()
                data = resp.json()
                result = (data.get("data") or {}).get("getDataFilePublicDownloadUrl")
                if result and result.get("url"):
                    return result["url"]

                logger.warning("No URL returned for image %s: %s", image_uuid, str(data)[:200])
                return None

            except Exception as exc:
                logger.warning("GraphQL request failed for image %s: %s", image_uuid, exc)
                if attempt == 0:
                    self._token = None  # force re-login
                    continue
                return None

        return None

    def _download_image(self, image_id: str, viewer_url: str) -> Optional[Path]:
        """Download an image from WI to the local cache.

        1. Parse the viewer URL to extract downloadId/projectId/imageUUID
        2. Query GraphQL for the signed GCS URL
        3. Download the image from GCS

        Returns the local path, or None if download fails.
        """
        dest = self._storage_dir / f"{image_id}.jpg"

        # Skip if already cached
        if dest.exists() and dest.stat().st_size > 0:
            return dest

        # Parse viewer URL
        params = self._parse_viewer_url(viewer_url)
        if not params:
            logger.warning("Cannot parse WI viewer URL: %s", viewer_url[:100])
            return None

        # Get signed GCS URL
        gcs_url = self._get_image_url(
            params["downloadId"], params["projectId"], params["imageUUID"]
        )
        if not gcs_url:
            return None

        # Download from GCS
        try:
            with httpx.Client(timeout=60, follow_redirects=True) as client:
                resp = client.get(gcs_url)
                resp.raise_for_status()

            ct = resp.headers.get("content-type", "")
            if not ct.startswith("image/"):
                logger.warning("WI returned non-image content-type for %s: %s", image_id, ct)
                return None

            dest.write_bytes(resp.content)
            logger.debug("Downloaded %s -> %s (%d bytes)", image_id, dest, len(resp.content))
            return dest

        except Exception as exc:
            logger.warning("Failed to download image %s from GCS: %s", image_id, exc)
            return None

    # ------------------------------------------------------------------
    # Hashing
    # ------------------------------------------------------------------

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
        try:
            return datetime.strptime(ts.strip()[:10], "%Y-%m-%d")
        except ValueError:
            return None

    # ------------------------------------------------------------------
    # Main iteration
    # ------------------------------------------------------------------

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
        skipped_no_url = 0
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
                common_name = row.get("common_name", "").strip()
                if is_blank or common_name.lower() == "blank":
                    skipped_blank += 1
                    continue

                # Skip humans
                genus = row.get("genus", "").strip()
                species = row.get("species", "").strip()
                image_class = row.get("class", "").strip()

                if genus == "Homo" and species == "sapiens":
                    skipped_human += 1
                    continue

                # Skip if no species identified
                if not species or not image_class:
                    skipped_no_species += 1
                    continue

                image_id = row.get("image_id", "").strip()
                location = row.get("location", "").strip()

                if not image_id or not location:
                    skipped_no_url += 1
                    continue

                # Download image via WI API
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

                # Build extra metadata
                extra = {
                    "common_name": common_name,
                    "genus": genus,
                    "species": species,
                    "order": row.get("order", "").strip(),
                    "family": row.get("family", "").strip(),
                    "cv_confidence": row.get("cv_confidence", "").strip(),
                    "uncertainty": row.get("uncertainty", "").strip(),
                    "license": row.get("license", "").strip(),
                    "wi_taxon_id": row.get("wi_taxon_id", "").strip(),
                    "wi_location_url": location,
                    "sequence_id": row.get("sequence_id", "").strip(),
                    "identified_by": row.get("identified_by", "").strip(),
                    "fuzzed": row.get("fuzzed", "").strip().lower() == "true",
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
            skipped_no_url, skipped_download,
        )
