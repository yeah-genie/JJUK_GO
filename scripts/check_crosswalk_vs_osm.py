# OA-21209 횡단보도 선과 OpenStreetMap 횡단보도(앱 보행 그래프의 횡단 간선, cls=5)가 서로 얼마나 가까운지 센다.
import glob, json, math, collections, csv, gzip, re, sys
LON0, LAT0 = 126.58, 37.35
K = 111320 * math.cos(math.radians(37.5)); KY = 110540
nodes = {}; edges = {}
for f in glob.glob('docs/prototype/seoul/graph/c*.json'):
    d = json.load(open(f))
    for r in d['n']: nodes[r[0]] = (LON0 + r[1] / 1e5, LAT0 + r[2] / 1e5)
    for e in d['e']:
        if e[3] == 5: edges[(e[0], e[1])] = e
osm = []
for (a, b), e in edges.items():
    if a in nodes and b in nodes:
        osm.append(((nodes[a][0] + nodes[b][0]) / 2, (nodes[a][1] + nodes[b][1]) / 2, e[2]))
print('OSM 횡단 간선', len(osm))
oa = []
for r in csv.DictReader(gzip.open(sys.argv[1], 'rt', encoding='utf-8-sig')):
    w = r.get('LNKG_WKT') or ''
    if not w.startswith('LINESTRING'): continue
    p = [tuple(map(float, q.split())) for q in re.findall(r'\(([^)]*)\)', w)[0].split(',')]
    oa.append(((p[0][0] + p[-1][0]) / 2, (p[0][1] + p[-1][1]) / 2, float(r['LNKG_LEN'])))
print('OA-21209', len(oa))
idx = collections.defaultdict(list)
for i, (x, y, l) in enumerate(osm): idx[(int(x * 1000), int(y * 1000))].append(i)
def nearest(x, y):
    best = (1e9, None)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for i in idx.get((int(x * 1000) + dx, int(y * 1000) + dy), []):
                ox, oy, l = osm[i]; d = math.hypot((ox - x) * K, (oy - y) * KY)
                if d < best[0]: best = (d, i)
    return best
ds = []; lr = []
for x, y, l in oa:
    d, i = nearest(x, y); ds.append(d)
    if i is not None and d < 15: lr.append(l / osm[i][2] if osm[i][2] else 0)
n = len(ds)
for t in (5, 10, 15, 25, 50): print(f'OSM 횡단과 {t}m 안: {sum(d < t for d in ds)}/{n} = {100 * sum(d < t for d in ds) / n:.0f}%')
lr.sort(); print('길이 비(OA/OSM) 15m 안 쌍', len(lr), '중앙값', round(lr[len(lr) // 2], 2), '사분위', round(lr[len(lr) // 4], 2), round(lr[3 * len(lr) // 4], 2))
