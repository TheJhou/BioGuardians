"""Download YOLOv8 pre-trained weights on container build."""

import os
import urllib.request
import sys

MODELS = {
    "yolov8s.pt": "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8s.pt",
}

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")


def main() -> None:
    os.makedirs(MODELS_DIR, exist_ok=True)
    for name, url in MODELS.items():
        dest = os.path.join(MODELS_DIR, name)
        if os.path.exists(dest):
            print(f"[skip] {name} already exists")
            continue
        print(f"[download] {name} from {url}")
        try:
            urllib.request.urlretrieve(url, dest)
            print(f"[ok] {name} downloaded")
        except Exception as exc:
            print(f"[warn] failed to download {name}: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
