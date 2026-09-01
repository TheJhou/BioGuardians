"""Geospatial utilities — convert pixel coordinates to lat/lon."""

import logging
from typing import Optional

import rasterio
from pyproj import Transformer

logger = logging.getLogger(__name__)


class GeoReference:
    """Handles pixel-to-lat/lon conversion for a georeferenced image."""

    def __init__(self, image_path: str):
        self._image_path = image_path
        self._transform = None
        self._crs = None
        self._transformer = None
        self._width = 0
        self._height = 0

    def load(self) -> None:
        """Load the image geotransform and CRS."""
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
        """Convert pixel (x, y) to WGS84 (lat, lon).

        Args:
            x: pixel column (0-based, left-to-right)
            y: pixel row (0-based, top-to-bottom)

        Returns:
            (latitude, longitude) in WGS84 (EPSG:4326)
        """
        if self._transform is None:
            raise RuntimeError("GeoReference not loaded — call load() first")

        # rasterio: (col, row) → projected (x, y)
        proj_x, proj_y = rasterio.transform.xy(self._transform, y, x)

        if self._transformer:
            lon, lat = self._transformer.transform(proj_x, proj_y)
        else:
            lon, lat = proj_x, proj_y

        return float(lat), float(lon)

    def bbox_to_latlon_bounds(
        self, x: int, y: int, w: int, h: int
    ) -> tuple[float, float, float, float]:
        """Convert a pixel bounding box to lat/lon bounds.

        Returns (min_lat, min_lon, max_lat, max_lon).
        """
        lat1, lon1 = self.pixel_to_latlon(x, y)
        lat2, lon2 = self.pixel_to_latlon(x + w, y + h)
        return (
            min(lat1, lat2),
            min(lon1, lon2),
            max(lat1, lat2),
            max(lon1, lon2),
        )

    def center_latlon(self, x: int, y: int, w: int, h: int) -> tuple[float, float]:
        """Get the center lat/lon of a pixel bounding box."""
        return self.pixel_to_latlon(x + w // 2, y + h // 2)
