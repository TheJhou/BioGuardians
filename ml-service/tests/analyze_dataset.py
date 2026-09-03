"""Analyze the Wildlife Insights dataset for fine-tuning planning."""
import csv
from collections import Counter
from pathlib import Path

DATA_DIR = Path("/data/wi")
csv_path = DATA_DIR / "images.csv"

total = 0
with_url = 0
blank = 0
human = 0
no_species = 0
has_species = 0

species_counts = Counter()
class_counts = Counter()
order_counts = Counter()
family_counts = Counter()
genus_counts = Counter()
project_ids = Counter()

with open(csv_path, "r", encoding="utf-8", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        total += 1

        project_ids[row.get("project_id", "").strip()] += 1

        location = row.get("location", "").strip()
        if location:
            with_url += 1

        is_blank = row.get("is_blank", "").strip().lower() in ("1", "true", "yes")
        common = row.get("common_name", "").strip()
        if is_blank or common.lower() == "blank":
            blank += 1
            continue

        genus = row.get("genus", "").strip()
        species = row.get("species", "").strip()
        img_class = row.get("class", "").strip()

        if genus == "Homo" and species == "sapiens":
            human += 1
            continue

        if not species or not img_class:
            no_species += 1
            continue

        has_species += 1
        scientific = f"{genus} {species}"
        species_counts[scientific] += 1
        class_counts[img_class] += 1
        order_counts[row.get("order", "").strip()] += 1
        family_counts[row.get("family", "").strip()] += 1
        genus_counts[genus] += 1

print(f"=== Dataset Overview ===")
print(f"Total images: {total:,}")
print(f"With download URL: {with_url:,}")
print(f"Blank: {blank:,}")
print(f"Human: {human:,}")
print(f"No species: {no_species:,}")
print(f"Has species (trainable): {has_species:,}")
print(f"Projects: {len(project_ids)}")

print(f"\n=== Top 10 Projects ===")
for pid, cnt in project_ids.most_common(10):
    print(f"  {pid}: {cnt:,}")

print(f"\n=== Class distribution ===")
for cls, cnt in class_counts.most_common():
    print(f"  {cls}: {cnt:,}")

print(f"\n=== Top 20 Species ===")
for sp, cnt in species_counts.most_common(20):
    print(f"  {sp}: {cnt:,}")

print(f"\n=== Species count summary ===")
print(f"  Total unique species: {len(species_counts)}")
print(f"  Species with >=10 images: {sum(1 for c in species_counts.values() if c >= 10)}")
print(f"  Species with >=50 images: {sum(1 for c in species_counts.values() if c >= 50)}")
print(f"  Species with >=100 images: {sum(1 for c in species_counts.values() if c >= 100)}")
print(f"  Species with >=500 images: {sum(1 for c in species_counts.values() if c >= 500)}")
