"""Camera trap dataset image source — STUB.

This source will process camera trap datasets (e.g. Wildlife Insights
exports) once the final dataset format is known. The architecture is
prepared: ImageItem supports camera_id, project_id, deployment_id,
timestamp, lat/lon — all optional, filled according to what the
dataset provides.

DO NOT implement parsing yet — the dataset has not been received and
the format (CSV/JSON/folder structure, field names, image locations)
is unknown. When the dataset arrives:

1. Inspect the metadata files (CSV/JSON) to determine:
   - How images are organized (folders, URLs, embedded)
   - Which fields map to ImageItem attributes
   - How to link images to deployments (lat/lon, camera_id)
2. Implement iter_images() to yield ImageItem objects
3. Handle deduplication via image_hash if needed
4. Filter out blank images and human detections if the dataset
   provides those flags

Expected Wildlife Insights structure (preliminary, from the sample
already downloaded at /data/wildlife-insights_*/):
- projects.csv    — project metadata
- cameras.csv     — camera hardware info
- deployments.csv — lat/lon, start/end dates, camera_id
- sequences.csv   — grouped image sequences with taxonomy
- images.csv      — per-image records with URL, taxonomy, timestamp

The implementation will likely:
- Parse deployments.csv to build a deployment_id → (lat, lon) map
- Parse images.csv (or sequences.csv) for image records
- Skip rows where is_blank=1 or species is empty
- Yield ImageItem with lat/lon from the deployment, timestamp from
  the image record, camera_id/project_id/deployment_id from the CSV
- Download the image from the URL in the 'location' column if needed,
  or point directly to a local path if the dataset includes images
"""

import logging
from typing import Iterator

from .base import ImageItem

logger = logging.getLogger(__name__)


class CameraTrapSource:
    """Image source for camera trap datasets.

    STUB — implementation awaits the final dataset format.
    """

    def __init__(self, data_dir: str, project_id: str | None = None):
        """
        Args:
            data_dir: path to the dataset root directory
            project_id: optional filter — only process images from
                this project (maps to Wildlife Insights project_id)
        """
        self._data_dir = data_dir
        self._project_id = project_id

    def iter_images(self) -> Iterator[ImageItem]:
        """Yield ImageItem objects from the camera trap dataset.

        NOT IMPLEMENTED — raises NotImplementedError until the
        dataset format is known and parsing is implemented.
        """
        raise NotImplementedError(
            "CameraTrapSource.iter_images() is not implemented yet. "
            "The camera trap dataset format is not yet defined. "
            "Implement parsing once the dataset is received."
        )
