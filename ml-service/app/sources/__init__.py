"""Image sources for the detection pipeline.

A source provides images to the pipeline via iter_images(), returning
ImageItem objects with metadata (lat/lon, timestamp, camera_id, etc.).
The pipeline is agnostic to the origin — satellite, camera trap, or
local directory all implement the same ImageSource protocol.

Implementations:
- SatelliteSource       — CBERS-4A WPM via INPE (existing code, moved)
- CameraTrapSource      — camera trap datasets (stub, awaiting dataset)
- LocalDirectorySource  — local folder of images (tests/debug)
"""
