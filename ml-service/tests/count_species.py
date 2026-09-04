"""Count all species in the WI dataset with various min thresholds."""
import csv
from collections import Counter

c = Counter()
with open("/data/wi/images.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        if row.get("is_blank", "").strip().lower() in ("1", "true", "yes"):
            continue
        genus = row.get("genus", "").strip()
        species = row.get("species", "").strip()
        if genus == "Homo" or not species:
            continue
        c[f"{genus} {species}"] += 1

print(f"Total unique species: {len(c)}")
print(f"Total images: {sum(c.values())}")
print()
for threshold in [1, 3, 5, 10, 20]:
    valid = {sp: n for sp, n in c.items() if n >= threshold}
    print(f"min_per_species={threshold}: {len(valid)} species, {sum(valid.values())} images")
print()
print("Top 20:")
for sp, n in c.most_common(20):
    print(f"  {sp}: {n}")
print()
print("Bottom 20 (rarest):")
for sp, n in c.most_common()[-20:]:
    print(f"  {sp}: {n}")
