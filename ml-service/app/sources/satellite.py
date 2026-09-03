"""Satellite image source — CBERS-4A WPM via INPE.

Wraps the existing Cbers4aFetcher + GeoReference logic behind the
ImageSource interface so the pipeline can consume satellite imagery
without knowing the source details.

Dependencies (rasterio, cbers4asat, pystac-client) are imported lazily
because they are not in requirements.txt for the local GPU setup
(camera trap workflow). If satellite mode is needed, install them
manually: pip install rasterio cbers4asat pystac-client
"""

import logging
import os
from datetime import date, timedelta
from dataclasses import dataclass
from typing import Iterator, Optional

from .base import ImageItem

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


class _GeoReference:
    """Handles pixel-to-lat/lon conversion for a georeferenced image.

    Moved from app/geo.py. Uses rasterio (lazy import).
    """

    def __init__(self, image_path: str):
        self._image_path = image_path
        self._transform = None
        self._crs = None
        self._transformer = None
        self._width = 0
        self._height = 0

    def load(self) -> None:
        import rasterio
        from pyproj import Transformer

        with rasterio.open(self._image_path) as src:
            self._transform = src.transform
            self._crs = src.crs
            self._width = src.width
            self._height = src.height

        if self._crs and self._crs.to_epsg() != 4326:
            self._transformer = Transformer.from_crs(
                self._crs, "EPSG:4326", always_xy=True
            )
        else:
            self._transformer = None

    @property
    def width(self) -> int:
        return self._width

    @property
    def height(self) -> int:
        return self._height

    def pixel_to_latlon(self, x: int, y: int) -> tuple[float, float]:
        import rasterio

        if self._transform is None:
            raise RuntimeError("GeoReference not loaded — call load() first")

        proj_x, proj_y = rasterio.transform.xy(self._transform, y, x)

        if self._transformer:
            lon, lat = self._transformer.transform(proj_x, proj_y)
        else:
            lon, lat = proj_x, proj_y

        return float(lat), float(lon)

    def center_latlon(self, x: int, y: int, w: int, h: int) -> tuple[float, float]:
        return self.pixel_to_latlon(x + w // 2, y + h // 2)


class _Cbers4aFetcher:
    """Fetches CBERS-4A WPM imagery from INPE.

    Moved from app/satellite.py. Uses cbers4asat / pystac-client /
    rasterio (all lazy imports).
    """

    def __init__(self, inpe_email: str, max_cloud_cover: float = 80,
                 date_search_range_days: int = 7):
        self._inpe_email = inpe_email
        self._max_cloud_cover = max_cloud_cover
        self._date_search_range_days = date_search_range_days
        self._api = None
        self._output_dir = os.environ.get("SATELLITE_OUTPUT_DIR", "/tmp/cbers")

    def _ensure_api(self):
        if self._api is not None:
            return
        if not self._inpe_email:
            raise RuntimeError("INPE_EMAIL is required to search CBERS-4A images")
        try:
            from cbers4asat import Cbers4aAPI
            self._api = Cbers4aAPI(self._inpe_email)
        except ImportError:
            logger.warning("cbers4asat not installed, falling back to STAC API")
            self._api = "stac"

    def search_and_download(
        self,
        bbox: str,
        target_date: date,
        output_dir: Optional[str] = None,
    ) -> SatelliteImage:
        self._ensure_api()
        out = output_dir or self._output_dir
        os.makedirs(out, exist_ok=True)

        initial = target_date - timedelta(days=self._date_search_range_days)
        end = target_date + timedelta(days=self._date_search_range_days)

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

    def _try_collection(self, collection, bbox, initial, end, output_dir):
        if self._api == "stac":
            return self._search_stac(collection, bbox, initial, end, output_dir)
        return self._search_cbers4asat(collection, bbox, initial, end, output_dir)

    def _search_cbers4asat(self, collection, bbox, initial, end, output_dir):
        bbox_list = [float(x) for x in bbox.split(",")]
        products = self._api.query(
            location=bbox_list,
            initial_date=initial,
            end_date=end,
            cloud=self._max_cloud_cover,
            limit=10,
            collections=[collection],
        )

        features = products.get("features", []) if isinstance(products, dict) else []
        if not features:
            logger.info("No products found in %s for the given range", collection)
            return None

        best = self._pick_best_feature(features)
        scene_id = best.get("id", "unknown")

        best_fc = {"type": "FeatureCollection", "features": [best]}
        self._api.download(
            best_fc,
            bands=["red", "green", "blue"],
            threads=1,
            outdir=output_dir,
            with_folder=False,
        )

        band_files = sorted(
            [f for f in os.listdir(output_dir) if f.endswith(".tif") and "BAND" in f]
        )
        if not band_files:
            band_files = sorted(
                [f for f in os.listdir(output_dir) if f.endswith(".tif")]
            )

        if not band_files:
            logger.warning("Download completed but no .tif found in %s", output_dir)
            return None

        if len(band_files) >= 3:
            image_path = self._compose_rgb_tif(
                [os.path.join(output_dir, f) for f in band_files[:3]],
                output_dir,
                scene_id,
            )
        else:
            image_path = os.path.join(output_dir, band_files[0])

        product_type = "L4_DN" if "L4_DN" in collection else "PCA_FUSED"
        props = best.get("properties", {})
        cloud = float(props.get("eo:cloud_cover", props.get("cloud_cover", 0)))

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

    def _search_stac(self, collection, bbox, initial, end, output_dir):
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

        best_item = min(
            items,
            key=lambda i: i.properties.get("eo:cloud_cover", 100),
        )

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

        filename = f"{best_item.id}.tif"
        filepath = os.path.join(output_dir, filename)
        resp = httpx.get(tif_asset.href, follow_redirects=True, timeout=120)
        resp.raise_for_status()
        with open(filepath, "wb") as f:
            f.write(resp.content)

        product_type = "L4_DN" if "L4_DN" in collection else "PCA_FUSED"
        cloud = best_item.properties.get("eo:cloud_cover", 0)

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
        CLOUD_THRESHOLD = 30.0

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

        parsed.sort(key=lambda x: x[0], reverse=True)
        recent = parsed[:10]
        acceptable = [p for p in recent if p[1] <= CLOUD_THRESHOLD]

        if acceptable:
            best = min(acceptable, key=lambda x: x[1])
            logger.info(
                "Selected scene: cloud=%.1f%% (date_ord=%d) from %d acceptable",
                best[1], best[0], len(acceptable),
            )
            return best[2]

        best = min(recent, key=lambda x: x[1])
        logger.info(
            "No scene under %.0f%% cloud, using best available: cloud=%.1f%%",
            CLOUD_THRESHOLD, best[1],
        )
        return best[2]

    def _compose_rgb_tif(self, band_paths, output_dir, scene_id):
        import rasterio
        import numpy as np

        logger.info("Composing RGB GeoTIFF from %d bands", len(band_paths))

        bands = []
        profile = None
        for bp in band_paths:
            with rasterio.open(bp) as src:
                if profile is None:
                    profile = src.profile
                bands.append(src.read(1))

        profile.update(count=3, dtype="uint8")

        stacked = []
        for band in bands:
            b_min, b_max = float(band.min()), float(band.max())
            if b_max > b_min:
                normalized = ((band - b_min) / (b_max - b_min) * 255).astype(np.uint8)
            else:
                normalized = np.zeros_like(band, dtype=np.uint8)
            stacked.append(normalized)

        output_path = os.path.join(output_dir, f"{scene_id}_RGB.tif")
        with rasterio.open(output_path, "w", **profile) as dst:
            for i, band_data in enumerate(stacked, 1):
                dst.write(band_data, i)

        logger.info("RGB GeoTIFF composed: %s", output_path)
        return output_path


class SatelliteSource:
    """ImageSource implementation for CBERS-4A WPM satellite imagery.

    Yields one ImageItem per scene. The lat/lon is set to the center
    of the image (individual detections get precise lat/lon from the
    GeoReference during pipeline processing).

    Requires: rasterio, cbers4asat (or pystac-client), pyproj.
    These are NOT in requirements.txt for the local GPU setup —
    install manually if satellite mode is needed.
    """

    def __init__(
        self,
        bbox: str,
        target_date: date,
        inpe_email: str,
        max_cloud_cover: float = 80,
        date_search_range_days: int = 7,
        output_dir: Optional[str] = None,
    ):
        self._bbox = bbox
        self._target_date = target_date
        self._fetcher = _Cbers4aFetcher(
            inpe_email=inpe_email,
            max_cloud_cover=max_cloud_cover,
            date_search_range_days=date_search_range_days,
        )
        self._output_dir = output_dir
        self._image: Optional[SatelliteImage] = None
        self._geo: Optional[_GeoReference] = None

    def iter_images(self) -> Iterator[ImageItem]:
        """Fetch and yield a single satellite scene as an ImageItem."""
        image = self._fetcher.search_and_download(
            self._bbox, self._target_date, self._output_dir
        )
        self._image = image

        # Load georeferencing to get center lat/lon
        geo = _GeoReference(image.path)
        geo.load()
        self._geo = geo

        center_lat, center_lon = geo.pixel_to_latlon(geo.width // 2, geo.height // 2)

        yield ImageItem(
            image_id=image.scene_id,
            path=image.path,
            source="satellite",
            lat=center_lat,
            lon=center_lon,
            timestamp=image.capture_date,
            extra={
                "satellite": image.satellite,
                "instrument": image.instrument,
                "product": image.product,
                "cloud_cover": image.cloud_cover,
                "bbox": self._bbox,
                "geo_ref": geo,  # pipeline uses this for per-detection lat/lon
            },
        )

    @property
    def geo(self) -> Optional[_GeoReference]:
        """Expose the GeoReference for the pipeline to use."""
        return self._geo
