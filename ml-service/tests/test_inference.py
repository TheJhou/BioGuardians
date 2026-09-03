"""Test local VLM inference with the fine-tuned adapter."""
import json
import os
import sys
sys.path.insert(0, "/app")

os.environ["LOCAL_VLM_PATH"] = "/models/qwen2vl-finetuned/adapter"
os.environ["YOLO_DEVICE"] = "cuda"
os.environ["OPENROUTER_API_KEY"] = ""  # disable fallback to test local only

from app.local_classifier import LocalVLMClassifier
from app.config import load_settings

settings = load_settings()
clf = LocalVLMClassifier(settings)
clf.load()

if clf._model is None:
    print("ERROR: model not loaded")
    sys.exit(1)

# Pick first image from dataset
with open("/data/dataset/val.jsonl") as f:
    record = json.loads(f.readline())

print(f"Image: {record['image_id']}")
print(f"Expected: {record['scientific']} ({record['common_name']})")
print(f"Image path: {record['image_path']}")
print()

result = clf.classify(record["image_path"], record.get("lat", 0), record.get("lon", 0))
print(f"Result:")
print(f"  scientific: {result.nome_cientifico}")
print(f"  common: {result.nome_popular}")
print(f"  confidence: {result.confidence}")
print(f"  method: {result.method}")
