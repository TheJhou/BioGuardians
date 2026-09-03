"""Base abstractions for image sources.

The pipeline consumes images through the ImageSource protocol, so it
does not need to know whether an image came from a satellite, a camera
trap dataset, or a local directory. Each source is responsible for
resolving lat/lon and other metadata that it can provide.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterator, Optional, Protocol


@dataclass
class ImageItem:
    """A single image to be processed by the pipeline.

    Attributes:
        image_id: unique identifier within the source (scene id, filename, etc.)
        path: local filesystem path to the image (already downloaded/available)
        source: source type tag — 'satellite', 'camera_trap', 'local_dir', ...
        lat: latitude of the capture (None if the source does not provide it)
        lon: longitude of the capture
        timestamp: capture date/time
        camera_id: camera trap identifier (camera trap sources only)
        project_id: project identifier (camera trap / WI sources)
        deployment_id: deployment identifier (camera trap / WI sources)
        image_hash: SHA-256 of the image bytes (filled by the pipeline if absent)
        extra: source-specific metadata not covered by the fields above
    """
    image_id: str
    path: str
    source: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    timestamp: Optional[datetime] = None
    camera_id: Optional[str] = None
    project_id: Optional[str] = None
    deployment_id: Optional[str] = None
    image_hash: Optional[str] = None
    extra: dict = field(default_factory=dict)


class ImageSource(Protocol):
    """Provides images for the pipeline to process.

    Implementations yield ImageItem objects. The pipeline iterates
    lazily — sources that fetch remote images should download one at
    a time (or in small batches) rather than loading everything into
    memory, to support datasets with hundreds of thousands of images.
    """

    def iter_images(self) -> Iterator[ImageItem]:
        """Yield ImageItem objects, one per image to process."""
        ...
