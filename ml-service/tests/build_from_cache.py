"""Build train/val JSONL from already-cached images.

Reads the WI CSV and existing /data/dataset/images/*.jpg files, then
writes train.jsonl, val.jsonl and species.json without downloading.
This lets us start fine-tuning while the full download continues later.
"""
import csv
import json
import os
from collections import defaultdict
from pathlib import Path

data_dir = Path("/data/wi")
output_dir = Path("/data/dataset")
images_dir = output_dir / "images"

deployments = {}
dep_path = data_dir / "deployments.csv"
if dep_path.exists():
    with open(dep_path, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            did = row.get("deployment_id", "").strip()
            if did:
                try:
                    deployments[did] = {
                        "lat": float(row.get("latitude", 0)),
                        "lon": float(row.get("longitude", 0)),
                    }
                except (ValueError, TypeError):
                    pass

species_records = defaultdict(list)
with open(data_dir / "images.csv", "r", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        if row.get("is_blank", "").strip().lower() in ("1", "true", "yes"):
            continue
        common = row.get("common_name", "").strip()
        if common.lower() == "blank":
            continue
        genus = row.get("genus", "").strip()
        species = row.get("species", "").strip()
        if genus == "Homo" and species == "sapiens":
            continue
        if not species or not row.get("class", "").strip():
            continue
        image_id = row.get("image_id", "").strip()
        if not image_id:
            continue
        if not (images_dir / f"{image_id}.jpg").exists():
            continue
        scientific = f"{genus} {species}"
        dep_id = row.get("deployment_id", "").strip()
        dep = deployments.get(dep_id, {})
        species_records[scientific].append({
            "image_id": image_id,
            "image_path": str(images_dir / f"{image_id}.jpg"),
            "scientific": scientific,
            "common_name": common,
            "class": row.get("class", "").strip(),
            "order": row.get("order", "").strip(),
            "family": row.get("family", "").strip(),
            "genus": genus,
            "species": species,
            "lat": dep.get("lat"),
            "lon": dep.get("lon"),
            "timestamp": row.get("timestamp", "").strip(),
        })

# Use same min-per-species=3 as the latest full prepare run
valid = {sp: recs for sp, recs in species_records.items() if len(recs) >= 3}
print(f"Species total: {len(species_records)}, valid (>=5): {len(valid)}")
print(f"Cached images usable: {sum(len(r) for r in valid.values())}")

species_map = {}
for i, sp in enumerate(sorted(valid.keys())):
    recs = valid[sp]
    species_map[sp] = {
        "id": i,
        "scientific": sp,
        "common_name": recs[0]["common_name"],
        "class": recs[0]["class"],
        "order": recs[0]["order"],
        "family": recs[0]["family"],
        "count": len(recs),
    }

with open(output_dir / "species.json", "w", encoding="utf-8") as f:
    json.dump(species_map, f, indent=2, ensure_ascii=False)

train_records = []
val_records = []
for sp, recs in valid.items():
    val_count = max(1, int(len(recs) * 0.15))
    val_items = recs[:val_count]
    train_items = recs[val_count:]
    train_records.extend(train_items)
    val_records.extend(val_items)

with open(output_dir / "train.jsonl", "w", encoding="utf-8") as f:
    for r in train_records:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

with open(output_dir / "val.jsonl", "w", encoding="utf-8") as f:
    for r in val_records:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

print(f"Wrote {len(train_records)} train, {len(val_records)} val records")
print(f"Output: {output_dir}")
