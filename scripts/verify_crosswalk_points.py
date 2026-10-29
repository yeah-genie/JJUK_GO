# 서울 횡단보도 표준 CSV의 좌표가 횡단보도의 어디를 가리키는지(가운데/끝), 이단 횡단이 몇 점으로 들어가는지
# OA-21209 대로변 횡단보도 선(전체 횡단 선)과 대조해 확인한다.
# 사용: python3 scripts/verify_crosswalk_points.py <표준CSV(cp949)> <oa21209_rows.csv.gz>
import csv, gzip, math, re, sys, collections, statistics as st
K = 111320 * math.cos(math.radians(37.5)); KY = 110540
C = [r for r in csv.DictReader(open(sys.argv[1], encoding='cp949')) if r['경도'] and r['위도']]
P = [((float(r['경도']), float(r['위도'])), r['횡단보도종류'], r['보행등유무']) for r in C]
grid = collections.defaultdict(list)
for i, (p, _, _) in enumerate(P): grid[(int(p[0] * 1000), int(p[1] * 1000))].append(i)
L = []
for r in csv.DictReader(gzip.open(sys.argv[2], 'rt', encoding='utf-8-sig')):
    w = r.get('LNKG_WKT') or ''
    if not w.startswith('LINESTRING'): continue
    q = [tuple(map(float, s.split())) for s in re.findall(r'\(([^)]*)\)', w)[0].split(',')]
    L.append((q[0], q[-1], float(r['LNKG_LEN'])))
ts = []; perline = collections.Counter(); kind_len = collections.defaultdict(list); kind_cnt = collections.defaultdict(collections.Counter)
for a, b, ln in L:
    ax, ay = 0.0, 0.0; bx, by = (b[0] - a[0]) * K, (b[1] - a[1]) * KY; seg2 = bx * bx + by * by
    if seg2 < 4: continue
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); hits = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for i in grid.get((int(mid[0] * 1000) + dx, int(mid[1] * 1000) + dy), []):
                px, py = (P[i][0][0] - a[0]) * K, (P[i][0][1] - a[1]) * KY
                t = (px * bx + py * by) / seg2
                if -0.15 <= t <= 1.15:
                    off = abs(px * by - py * bx) / math.sqrt(seg2)
                    if off <= 4: hits.append((i, t))
    perline[min(len(hits), 3)] += 1
    for i, t in hits:
        ts.append(t)
    if len(hits) == 1:
        k = P[hits[0][0]][1]; kind_len[k].append(ln)
    for i, _ in hits: kind_cnt[P[i][1]][min(len(hits), 3)] += 1
print('대로변 횡단 선', len(L), '· 선 위(4m 안)에 놓인 서울시 점 개수별 선 수 (0,1,2,3+):', dict(sorted(perline.items())))
b = collections.Counter(min(9, max(0, int((t + 0.15) / 0.13))) for t in ts)
print('선 위 점의 위치(0=한쪽 끝, 0.5=가운데, 1=반대쪽 끝) 분포:')
for k in range(10): print(f'  {-0.15 + k * 0.13:+.2f}~{-0.15 + (k + 1) * 0.13:+.2f}', b[k])
print('  가운데(0.35~0.65) 비율', round(100 * sum(0.35 <= t <= 0.65 for t in ts) / len(ts)), '%  · 양 끝(0.15 미만/0.85 초과)', round(100 * sum(t < 0.15 or t > 0.85 for t in ts) / len(ts)), '%')
print('종류별: 선 하나에 점이 1/2/3+개인 경우, 선 하나에 점 1개일 때 길이 중앙값')
for k, c in sorted(kind_cnt.items(), key=lambda kv: -sum(kv[1].values())):
    print(f'  {k}: {dict(sorted(c.items()))} · 길이 {round(st.median(kind_len[k]), 1) if kind_len[k] else "-"}m (n={len(kind_len[k])})')
