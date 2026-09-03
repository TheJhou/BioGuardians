"""Smoke test for CameraTrapSource with the real WI dataset."""
import os
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost/dummy")
os.environ.setdefault("IMAGE_STORAGE_DIR", "/app/images")

from app.sources.camera_trap import CameraTrapSource

source = CameraTrapSource(data_dir="/data/wi", limit=2)
for item in source.iter_images():
    print(f"image_id={item.image_id[:8]}...")
    print(f"  path={item.path}")
    print(f"  lat={item.lat} lon={item.lon}")
    print(f"  hash={item.image_hash[:16]}...")
    print(f"  species={item.extra.get('species')} common={item.extra.get('common_name')}")
    print(f"  project={item.project_id} camera={item.camera_id}")
