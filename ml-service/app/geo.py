"""Geospatial utilities — moved to sources/satellite.py.

The GeoReference class now lives inside app.sources.satellite as a
private class (_GeoReference), with lazy rasterio imports. This module
re-exports it for backward compatibility.

To use satellite mode, install:
    pip install rasterio pyproj
"""

from .sources.satellite import _GeoReference as GeoReference
