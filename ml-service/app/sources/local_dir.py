"""Local directory image source — iterates image files in a folder.

Useful for testing the pipeline without a satellite or camera trap
dataset. Scans a directory for .jpg/.jpeg/.png files and yields
ImageItem objects with source='local_dir'.

No lat/lon or timestamp is provided (the source has no metadata).
The pipeline will still run detection; classification will rely on
the VLM or heuristic fallback.
"""

import logging
from pathlib import Path
from typing import Iterator

from .base import ImageItem

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = (".jpg", ".jpeg", ".png")


class LocalDirectorySource:
    """Iterates image files from a local directory."""

    def __init__(self, directory: str, recursive: bool = False):
        """
        Args:
            directory: path to the folder containing images
            recursive: if True, scan subdirectories too
        """
        self._directory = Path(directory)
        self._recursive = recursive

    def iter_images(self) -> Iterator[ImageItem]:
        base = self._directory
        if not base.is_dir():
            logger.warning("LocalDirectorySource: %s is not a directory", base)
            return

        glob = "**/*" if self._recursive else "*"
        for path in sorted(base.glob(glob)):
            if not path.is_file():
                continue
            if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            yield ImageItem(
                image_id=path.stem,
                path=str(path),
                source="local_dir",
            )
