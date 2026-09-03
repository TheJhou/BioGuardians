import os, json
imgs = os.listdir('/data/dataset/images')
print(f"Images: {len(imgs)}")
d = json.load(open('/data/dataset/species.json'))
print(f"Species: {len(d)}")
for k, v in sorted(d.items(), key=lambda x: -x[1]['count'])[:10]:
    print(f"  {v['scientific']}: {v['count']}")
print("---")
print(open('/data/dataset/train.jsonl').readline()[:200])
