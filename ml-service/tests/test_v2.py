"""Batch test v2 adapter on 20 validation images across species."""
import os, sys, json, random
sys.path.insert(0, '/app')
os.environ['LOCAL_VLM_PATH'] = '/models/qwen2vl-finetuned-v2/adapter'
os.environ['YOLO_DEVICE'] = 'cuda'
os.environ['DATABASE_URL'] = 'postgresql://dummy:dummy@localhost:5432/dummy'

from app.local_classifier import LocalVLMClassifier
from app.config import load_settings
from collections import defaultdict, Counter

settings = load_settings()
clf = LocalVLMClassifier(settings)
clf.load()

# Load all val records, sample one per species to get diversity
by_species = defaultdict(list)
with open('/data/dataset/val.jsonl') as f:
    for line in f:
        r = json.loads(line)
        by_species[r['scientific']].append(r)

# Pick one random image per species, max 20 species
candidates = []
for sp, records in by_species.items():
    candidates.append(random.choice(records))
    if len(candidates) >= 20:
        break

random.shuffle(candidates)

correct = 0
total = 0
results = []

for record in candidates:
    result = clf.classify(record['image_path'], record.get('lat', 0), record.get('lon', 0))
    is_correct = result.nome_cientifico.lower().strip() == record['scientific'].lower().strip()
    if is_correct:
        correct += 1
    total += 1
    results.append({
        'image_id': record['image_id'],
        'expected': record['scientific'],
        'common': record['common_name'],
        'predicted': result.nome_cientifico,
        'predicted_common': result.nome_popular,
        'confidence': result.confidence,
        'correct': is_correct,
    })
    status = "✓" if is_correct else "✗"
    print(f"{status} {record['scientific']:<35} -> {result.nome_cientifico:<35} ({result.nome_popular}) conf={result.confidence:.2f}")

print()
print(f"Accuracy: {correct}/{total} = {100*correct/total:.1f}%")
print()
print("Per-species results:")
for r in results[:20]:
    print(f"  {r['expected']} ({r['common']}): pred={r['predicted']} ({r['predicted_common']}) conf={r['confidence']:.2f} {'OK' if r['correct'] else 'WRONG'}")
