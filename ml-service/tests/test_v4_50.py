"""Batch test v4 adapter on 50 validation images across species."""
import os, sys, json, random
sys.path.insert(0, '/app')
os.environ['LOCAL_VLM_PATH'] = '/models/qwen2vl-finetuned-v4/adapter'
os.environ['YOLO_DEVICE'] = 'cuda'
os.environ['DATABASE_URL'] = 'postgresql://dummy:dummy@localhost:5432/dummy'

from app.local_classifier import LocalVLMClassifier
from app.config import load_settings
from collections import defaultdict

settings = load_settings()
clf = LocalVLMClassifier(settings)
clf.load()

by_species = defaultdict(list)
with open('/data/dataset/val.jsonl') as f:
    for line in f:
        r = json.loads(line)
        if r['scientific'] == 'No CV Result No CV Result':
            continue
        by_species[r['scientific']].append(r)

# Pick 50 random samples across species
candidates = []
for sp, records in by_species.items():
    n = min(3, len(records))
    candidates.extend(random.sample(records, n))
    if len(candidates) >= 50:
        break

random.shuffle(candidates)
candidates = candidates[:50]

correct = 0
total = 0
for rec in candidates:
    result = clf.classify(rec['image_path'], rec.get('lat', 0), rec.get('lon', 0))
    expected = (rec['scientific'] or '').lower().strip()
    predicted = (result.nome_cientifico or '').lower().strip()
    ok = expected == predicted and bool(expected)
    correct += ok
    total += 1
    status = 'OK ' if ok else 'ERR'
    print(f"{status} {rec['scientific']:<35} -> {result.nome_cientifico or 'NONE':<35} ({result.nome_popular or 'none'}) conf={result.confidence:.2f}")

print(f"\nAccuracy: {correct}/{total} = {100*correct/total:.1f}%")
