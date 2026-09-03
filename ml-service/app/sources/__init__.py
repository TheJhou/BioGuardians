"""Image sources for the classification pipeline.

A source provides images to the pipeline via iter_images(), returning
ImageItem objects with metadata (lat/lon, timestamp, camera_id, etc.).

Implementations:
- CameraTrapSource      — Wildlife Insights camera trap datasets
- LocalDirectorySource  — local folder of images (tests/debug)
"""
