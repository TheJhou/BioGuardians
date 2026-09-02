"""CBERS-4A WPM satellite imagery fetcher.

Uses the cbers4asat library to search and download images from INPE.
Falls back to the INPE STAC API via pystac-client if needed.
"""

import os
import logging
from datetime import date, timedelta
from dataclasses import dataclass
from typing import Optional

from .config import Settings

logger = logging.getLogger(__name__)

# CBERS-4A WPM collections available on INPE STAC.
COLLECTION_L4_DN = "CBERS4A_WPM_L4_DN"
COLLECTION_FUSED = "CBERS4A_WPM_PCA_FUSED"


@dataclass
class SatelliteImage:
    """Represents a downloaded satellite image with georeferencing."""
    path: str
    scene_id: str
    satellite: str
    instrument: str
    product: str
    capture_date: date
    cloud_cover: float


class Cbers4aFetcher:
    """Fetches CBERS-4A WPM imagery from INPE."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._api = None
        self._output_dir = os.environ.get("SATELLITE_OUTPUT_DIR", "/tmp/cbers")

    def _ensure_api(self):
        """Lazy-init the cbers4asat API client."""
        if self._api is not None:
            return
        if not self._settings.inpe_email:
            raise RuntimeError("INPE_EMAIL is required to search CBERS-4A images")
        try:
            from cbers4asat import Cbers4aAPI
            self._api = Cbers4aAPI(self._settings.inpe_email)
        except ImportError:
            logger.warning("cbers4asat not installed, falling back to STAC API")
            self._api = "stac"  # sentinel value for fallback

    def search_and_download(
        self,
        bbox: str,
        target_date: date,
        output_dir: Optional[str] = None,
    ) -> SatelliteImage:
        """Search for CBERS-4A WPM imagery near target_date and download it.

        Searches a date range (± date_search_range_days) to handle
        the 31-day revisit cycle. Returns the best match (lowest cloud cover).
        """
        self._ensure_api()
        out = output_dir or self._output_dir
        os.makedirs(out, exist_ok=True)

        initial = target_date - timedelta(days=self._settings.date_search_range_days)
        end = target_date + timedelta(days=self._settings.date_search_range_days)

        # Try pan-sharpened (0.8m) first — much better for animal detection.
        # Fall back to L4 DN (2m) if fused is not available.
        for collection in [COLLECTION_FUSED, COLLECTION_L4_DN]:
            try:
                image = self._try_collection(collection, bbox, initial, end, out)
                if image:
                    return image
            except Exception as exc:
                logger.warning("Failed to fetch from %s: %s", collection, exc)

        raise RuntimeError(
            f"No CBERS-4A WPM imagery found for bbox={bbox} "
            f"between {initial} and {end}"
        )

    def _try_collection(
        self,
        collection: str,
        bbox: str,
        initial: date,
        end: date,
        output_dir: str,
    ) -> Optional[SatelliteImage]:
        """Try to find and download an image from a specific collection."""
        if self._api == "stac":
            return self._search_stac(collection, bbox, initial, end, output_dir)
        return self._search_cbers4asat(collection, bbox, initial, end, output_dir)

    def _search_cbers4asat(
        self,
        collection: str,
        bbox: str,
        initial: date,
        end: date,
        output_dir: str,
    ) -> Optional[SatelliteImage]:
        """Search using cbers4asat library."""
        # cbers4asat expects bbox as a list of floats: [xmin, ymin, xmax, ymax]
        # A tuple is interpreted as path_row (Tuple[int, int]).
        bbox_list = [float(x) for x in bbox.split(",")]
        products = self._api.query(
            location=bbox_list,
            initial_date=initial,
            end_date=end,
            cloud=self._settings.max_cloud_cover,
            limit=10,
            collections=[collection],
        )

        # cbers4asat returns a GeoJSON FeatureCollection
        features = products.get("features", []) if isinstance(products, dict) else []
        if not features:
            logger.info("No products found in %s for the given range", collection)
            return None

        # Pick the best: lowest cloud cover
        best = self._pick_best_feature(features)
        scene_id = best.get("id", "unknown")

        # Download — cbers4asat requires bands parameter
        # CBERS-4A WPM RGB bands: red, green, blue
        # Both L4_DN and PCA_FUSED support these band names
        best_fc = {"type": "FeatureCollection", "features": [best]}
        self._api.download(
            best_fc,
            bands=["red", "green", "blue"],
            threads=1,
            outdir=output_dir,
            with_folder=False,
        )

        # Find downloaded band files and compose a single RGB GeoTIFF
        # cbers4asat downloads each band as a separate .tif file
        band_files = sorted(
            [f for f in os.listdir(output_dir) if f.endswith(".tif") and "BAND" in f]
        )
        if not band_files:
            # Fallback: try any .tif file
            band_files = sorted(
                [f for f in os.listdir(output_dir) if f.endswith(".tif")]
            )

        if not band_files:
            logger.warning("Download completed but no .tif found in %s", output_dir)
            return None

        if len(band_files) >= 3:
            # Compose 3 bands into a single RGB GeoTIFF
            image_path = self._compose_rgb_tif(
                [os.path.join(output_dir, f) for f in band_files[:3]],
                output_dir,
                scene_id,
            )
        else:
            # Single band — use as-is
            image_path = os.path.join(output_dir, band_files[0])

        product_type = "L4_DN" if "L4_DN" in collection else "PCA_FUSED"
        props = best.get("properties", {})
        cloud = float(props.get("eo:cloud_cover", props.get("cloud_cover", 0)))

        # Parse capture date from properties
        capture_date = initial
        date_str = props.get("datetime", "")
        if date_str:
            try:
                capture_date = date.fromisoformat(date_str[:10])
            except ValueError:
                pass

        return SatelliteImage(
            path=image_path,
            scene_id=str(scene_id),
            satellite="CBERS-4A",
            instrument="WPM",
            product=product_type,
            capture_date=capture_date,
            cloud_cover=cloud,
        )

    def _search_stac(
        self,
        collection: str,
        bbox: str,
        initial: date,
        end: date,
        output_dir: str,
    ) -> Optional[SatelliteImage]:
        """Fallback: search using pystac-client directly."""
        from pystac_client import Client
        import httpx

        stac_url = "https://data.inpe.br/bdc/stac/v1"
        client = Client.open(stac_url)

        bbox_parts = [float(x) for x in bbox.split(",")]
        search = client.search(
            collections=[collection],
            intersects={
                "type": "Polygon",
                "coordinates": [[
                    [bbox_parts[0], bbox_parts[1]],
                    [bbox_parts[2], bbox_parts[1]],
                    [bbox_parts[2], bbox_parts[3]],
                    [bbox_parts[0], bbox_parts[3]],
                    [bbox_parts[0], bbox_parts[1]],
                ]],
            },
            datetime=f"{initial.isoformat()}/{end.isoformat()}",
            max_items=5,
        )

        items = list(search.items())
        if not items:
            return None

        # Pick best item (lowest cloud cover).
        best_item = min(
            items,
            key=lambda i: i.properties.get("eo:cloud_cover", 100),
        )

        # Download the first asset (GeoTIFF).
        assets = best_item.assets
        tif_asset = None
        for key, asset in assets.items():
            if asset.media_type and "tiff" in asset.media_type.lower():
                tif_asset = asset
                break
            if key.lower() in ("pan", "b1", "image", "visual"):
                tif_asset = asset
                break

        if not tif_asset:
            logger.warning("No GeoTIFF asset found in STAC item")
            return None

        # Download via httpx
        filename = f"{best_item.id}.tif"
        filepath = os.path.join(output_dir, filename)
        resp = httpx.get(tif_asset.href, follow_redirects=True, timeout=120)
        resp.raise_for_status()
        with open(filepath, "wb") as f:
            f.write(resp.content)

        product_type = "L4_DN" if "L4_DN" in collection else "PCA_FUSED"
        cloud = best_item.properties.get("eo:cloud_cover", 0)

        # Parse date from item datetime
        item_date = initial
        if best_item.datetime:
            item_date = best_item.datetime.date()

        return SatelliteImage(
            path=filepath,
            scene_id=best_item.id,
            satellite="CBERS-4A",
            instrument="WPM",
            product=product_type,
            capture_date=item_date,
            cloud_cover=float(cloud),
        )

    def _pick_best_feature(self, features: list) -> dict:
        """Pick the best scene from up to 10 recent features.

        Strategy:
        1. Sort by date (most recent first)
        2. Among scenes with cloud <= 40%, pick the one with lowest cloud
        3. If no scene has cloud <= 40%, pick the least cloudy overall
        """
        CLOUD_THRESHOLD = 40.0

        # Parse all features into (timestamp, cloud, feature) tuples
        parsed = []
        for feat in features:
            props = feat.get("properties", {})
            date_str = props.get("datetime", "")
            cloud = float(props.get("eo:cloud_cover", props.get("cloud_cover", 100)))
            timestamp = 0
            if date_str:
                try:
                    timestamp = date.fromisoformat(date_str[:10]).toordinal()
                except (ValueError, TypeError):
                    pass
            parsed.append((timestamp, cloud, feat))

        if not parsed:
            return features[0]

        # Sort by most recent first
        parsed.sort(key=lambda x: x[0], reverse=True)

        # Take the 10 most recent (already limited by query, but be safe)
        recent = parsed[:10]

        # Filter to cloud <= 40%
        acceptable = [p for p in recent if p[1] <= CLOUD_THRESHOLD]

        if acceptable:
            # Among acceptable, pick lowest cloud
            best = min(acceptable, key=lambda x: x[1])
            logger.info(
                "Selected scene: cloud=%.1f%% (date_ord=%d) from %d acceptable",
                best[1], best[0], len(acceptable),
            )
            return best[2]

        # No scene under 40% cloud — pick the least cloudy available
        best = min(recent, key=lambda x: x[1])
        logger.info(
            "No scene under %.0f%% cloud, using best available: cloud=%.1f%%",
            CLOUD_THRESHOLD, best[1],
        )
        return best[2]

    def _compose_rgb_tif(
        self,
        band_paths: list[str],
        output_dir: str,
        scene_id: str,
    ) -> str:
        """Compose 3 separate band TIFs into a single RGB GeoTIFF.

        cbers4asat downloads each band as a separate file (BAND1, BAND2, BAND3).
        This method stacks them into a single 3-band GeoTIFF preserving georeferencing.

        Args:
            band_paths: list of paths to individual band TIFs (blue, green, red)
            output_dir: directory to write the composed file
            scene_id: scene identifier for the output filename

        Returns:
            Path to the composed RGB GeoTIFF.
        """
        import rasterio
        from rasterio.merge import merge as _unused  # noqa: F401

        logger.info("Composing RGB GeoTIFF from %d bands", len(band_paths))

        # Read each band and stack into a single array
        bands = []
        profile = None
        for bp in band_paths:
            with rasterio.open(bp) as src:
                if profile is None:
                    profile = src.profile
                bands.append(src.read(1))

        # Update profile for 3-band output
        profile.update(count=3, dtype="uint8")

        # Normalize each band to 0-255 and stack
        import numpy as np
        stacked = []
        for band in bands:
            b_min, b_max = float(band.min()), float(band.max())
            if b_max > b_min:
                normalized = ((band - b_min) / (b_max - b_min) * 255).astype(np.uint8)
            else:
                normalized = np.zeros_like(band, dtype=np.uint8)
            stacked.append(normalized)

        # Write as BGR order (OpenCV convention expected by pipeline)
        # cbers4asat bands: BAND1=Blue, BAND2=Green, BAND3=Red
        # rasterio writes band order: 1, 2, 3 → we write B, G, R
        output_path = os.path.join(output_dir, f"{scene_id}_RGB.tif")
        with rasterio.open(output_path, "w", **profile) as dst:
            for i, band_data in enumerate(stacked, 1):
                dst.write(band_data, i)

        logger.info("RGB GeoTIFF composed: %s", output_path)
        return output_path
