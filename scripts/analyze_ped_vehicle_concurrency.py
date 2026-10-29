#!/usr/bin/env python3
"""보행신호(Pd)와 차량 직진신호(St)가 동시에 초록인 비율로 보행 코드가 어느 도로를 건너는지 판정한다.

규칙(교통 신호의 일반 원칙): 보행자는 자기와 나란히 가는 직진 차량과 같은 때 건너고, 자기가 건너는 도로의 직진 차량과는 동시에 초록이 아니다.
  - '같은 방위' 가설: 보행 nt = 북쪽 도로를 건넘(동서로 걸음) → 동서(et/wt) 직진과 동시에 초록.  → 보행 코드와 '직각' 축 직진과 겹침
  - '시계방향 한 칸' 가설: 보행 et = 북쪽 도로를 건넘(동서로 걸음) → 동서 직진과 겹침.      → 보행 코드와 '같은' 축 직진과 겹침
입력: data 브랜치 segments(csv.gz, movement Pd/St). 사용: python3 scripts/analyze_ped_vehicle_concurrency.py <segments 폴더>
"""
import csv, glob, gzip, sys, collections
from datetime import datetime

def t(s): return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
GREEN_PD = {'protected-Movement-Allowed', 'permissive-Movement-Allowed'}
GREEN_ST = {'protected-Movement-Allowed'}
AXIS = {'nt': 'NS', 'st': 'NS', 'et': 'EW', 'wt': 'EW'}
segs = collections.defaultdict(list)  # (itst, mv, dir) -> [(a,b,green)]
for f in glob.glob(sys.argv[1] + '/**/*.csv.gz', recursive=True):
    for r in csv.DictReader(gzip.open(f, 'rt')):
        g = r['state'] in (GREEN_PD if r['movement'] == 'Pd' else GREEN_ST)
        segs[(r['itst_id'], r['movement'], r['direction'])].append((t(r['start_utc']), t(r['end_utc']) + 1, g))

def overlap(A, B):
    """A,B: 초록 구간 목록. 겹치는 초록 시간 합."""
    s = 0.0; j = 0
    A = sorted(A); B = sorted(B)
    for a0, a1 in A:
        for b0, b1 in B:
            if b0 >= a1: break
            s += max(0, min(a1, b1) - max(a0, b0))
    return s

def observed(S):
    return [(a, b) for a, b, _ in S]

res = collections.Counter(); per = []
itsts = sorted({k[0] for k in segs if k[1] == 'St'})
for i in itsts:
    pds = {d: v for (ii, m, d), v in segs.items() if ii == i and m == 'Pd' and d in AXIS}
    sts = {d: v for (ii, m, d), v in segs.items() if ii == i and m == 'St' and d in AXIS}
    if not pds or not sts: continue
    st_obs = sorted(set(x for v in sts.values() for x in observed(v)))
    for p, pv in pds.items():
        pg = [(a, b) for a, b, g in pv if g]
        pg_obs = overlap(pg, st_obs)   # 직진 자료가 있는 시간대의 보행 초록
        if pg_obs < 60: continue
        same = [s for s in sts if AXIS[s] == AXIS[p]]; perp = [s for s in sts if AXIS[s] != AXIS[p]]
        f = lambda ss: max([overlap(pg, [(a, b) for a, b, g in sts[s] if g]) / pg_obs for s in ss], default=None)
        fs, fp = f(same), f(perp)
        per.append((i, p, round(pg_obs), fs, fp))
        if fs is not None and fp is not None:
            res['같은 축 겹침이 더 큼' if fs > fp + 0.1 else '직각 축 겹침이 더 큼' if fp > fs + 0.1 else '구분 안 됨'] += 1
print('교차로·보행코드별 (보행 초록 관측 초, 같은 축 직진과 겹친 비율, 직각 축 직진과 겹친 비율)')
for x in per: print('  ', x[0], x[1], x[2], None if x[3] is None else round(x[3], 2), None if x[4] is None else round(x[4], 2))
print(dict(res))
