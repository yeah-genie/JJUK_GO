#!/usr/bin/env python3
"""v2 실험 결과를 허용 시간별로 원시 지표로 집계한다. 점수화하지 않는다.

'의미 있는 대안' (사용자가 정한 기준, 결과를 보기 전에 고정)
  추가 시간 ≤ 허용 시간(+0.5/+1/+2/+3분) 이고, 다음 중 하나 이상:
    신호 횡단 1개 이상 감소 / 계단 1구간 이상 감소 / 상승고도 10m 이상 감소 / 급경사(8% 이상) 거리 100m 이상 감소
  그리고 다른 핵심 지표가 심하게 나빠지지 않음(Claude가 정한 기준):
    신호 횡단·계단·큰길 횡단은 늘지 않음, 전체 횡단은 1개까지만 늘어남, 상승은 5m까지, 급경사 거리는 50m까지 늘어남 허용.
  (같은 길 제거는 실험 단계에서 이미 함: 겹침 90% 이상 또는 추가 10초 이하)
사용: python3 scripts/summarize_friction_od_v2.py reports/experiments/friction_od_500_v2.json [--steep-key steep5]
"""
import json, statistics as st, sys
from collections import Counter

args = sys.argv[1:]
SK = "steep"
if "--steep-key" in args:
    SK = args[args.index("--steep-key") + 1]
P = json.load(open(args[0]))["pairs"]
DELTAS = [30, 60, 120, 180]
IMP = [("sig", "신호 횡단", 1), ("stairs", "계단", 1), ("rise", "상승", 10), (SK, "급경사", 100)]
WORSE = {"sig": 0, "stairs": 0, "big": 0, "cross": 1, "rise": 5, SK: 50}


def fine(a, s):
    return all(a[k] - s[k] <= lim for k, lim in WORSE.items())


def gains(a, s):
    return [name for k, name, thr in IMP if s[k] - a[k] >= thr]


def lab(d):
    return f"+{d / 60:g}분"


print(f"쌍 {len(P)} · 최단 걷는 시간 중앙값 {st.median(p['short']['time'] for p in P) / 60:.1f}분 · 같은 길로 제외한 후보 합계 {sum(p['same_dropped'] for p in P)}")
for k, name in [("cross", "횡단(차도 축 가로지름, 묶음)"), ("sig", "신호 횡단"), ("big", "큰길 횡단"), ("marked", "횡단보도 자료가 있는 횡단"),
                ("rise", "상승고도 m"), ("steep5", "5% 이상 구간 m"), ("steep", "8% 이상 구간 m"), ("stairs", "계단 구간")]:
    v = [p["short"][k] for p in P]
    print(f"  최단 길 {name}: 평균 {st.mean(v):.1f} · 중앙값 {st.median(v):.1f} · 0인 쌍 {sum(1 for x in v if x == 0)}")
print()
print("허용 | 의미 있는 대안이 있는 쌍 | 지표별(다른 지표 안 나빠짐) 신호/계단/상승/급경사")
for d in DELTAS:
    n = 0; by = Counter()
    for p in P:
        s = p["short"]; ok = [a for a in p["alts"] if a["extra"] <= d and fine(a, s) and gains(a, s)]
        if ok:
            n += 1
        for name in {g for a in ok for g in gains(a, s)}:
            by[name] += 1
    print(f"{lab(d)} | {n}/{len(P)} ({100 * n / len(P):.0f}%) | " + " / ".join(f"{by[name]} ({100 * by[name] / len(P):.0f}%)" for _, name, _ in IMP))
print()
print("카드 유형: 의미 있는 대안이 있는 쌍에서 '추가 시간이 가장 짧은 대안 1개'가 무엇을 줄이나 (비율은 그 쌍들 중)")
for d in DELTAS:
    types = Counter(); amt = {name: [] for _, name, _ in IMP}; extra = []
    for p in P:
        s = p["short"]; ok = [a for a in p["alts"] if a["extra"] <= d and fine(a, s) and gains(a, s)]
        if not ok:
            continue
        c = min(ok, key=lambda a: a["extra"]); g = gains(c, s); extra.append(c["extra"])
        types[" + ".join(g)] += 1
        for k, name, _ in IMP:
            if name in g:
                amt[name].append(s[k] - c[k])
    tot = sum(types.values())
    print(f"{lab(d)} (쌍 {tot}, 추가 시간 중앙값 {st.median(extra):.0f}초)")
    for t, c in types.most_common(8):
        print(f"   {t}: {c} ({100 * c / tot:.0f}%)")
    print("   줄인 양 중앙값: " + ", ".join(f"{name} {st.median(v):.0f}" for name, v in amt.items() if v))
print()
print("예시 카드(+1분, 처음 5개)")
shown = 0
for p in P:
    s = p["short"]; ok = [a for a in p["alts"] if a["extra"] <= 60 and fine(a, s) and gains(a, s)]
    if not ok:
        continue
    c = min(ok, key=lambda a: a["extra"])
    print(f"  빠른 길 {s['time'] / 60:.1f}분: 신호 {s['sig']}, 계단 {s['stairs']}, 상승 {s['rise']:.0f}m, 급경사 {s[SK]:.0f}m"
          f"  →  대안 +{c['extra']:.0f}초: 신호 {c['sig']}, 계단 {c['stairs']}, 상승 {c['rise']:.0f}m, 급경사 {c[SK]:.0f}m (겹침 {c['overlap']:.0%})")
    shown += 1
    if shown >= 5:
        break
