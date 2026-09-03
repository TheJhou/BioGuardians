"""Satellite imagery fetcher — moved to sources/satellite.py.

This module is kept as a thin re-export for backward compatibility.
The actual implementation (Cbers4aFetcher, SatelliteImage) now lives
in app.sources.satellite, with lazy imports so it doesn't break when
rasterio/cbers4asat are not installed (camera trap workflow).

To use satellite mode, install the optional dependencies:
    pip install rasterio cbers4asat pystac-client pyproj
"""

# Re-export for backward compatibility — imports are lazy inside the
# source module, so this won't fail at import time.
from .sources.satellite import (
    SatelliteImage,
    SatelliteSource,
    _Cbers4aFetcher as Cbers4aFetcher,
)
