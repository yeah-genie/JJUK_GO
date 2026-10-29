#!/usr/bin/env python3
"""experiment_friction_od.py 결과를 허용 시간(+0.5/+1/+2/+3분)별로 원시 지표로 집계한다. 점수화하지 않는다.

'의미 있는 대안'의 정의(결과를 보기 전에 정함):
  최단 걷는 시간 + 허용 시간 안의 다른 길 중에서
  - 횡단 1개 이상 감소, 또는 신호 횡단 1개 이상 감소, 또는 오르막 5m 이상 감소, 또는 계단 1구간 이상 감소이고
  - 나머지 지표는 나빠지지 않는 길(횡단·신호 횡단·계단은 같거나 적음, 오르막은 2m 넘게 늘지 않음).
사용: python3 scripts/summarize_friction_od.py reports/experiments/friction_od_500.json
"""
import json, statistics as st, sys

D = json.load(open(sys.argv[1]))
P = D["pairs"]
DELTAS = [30, 60, 120, 180]
MET = [("cross", "횡단 수", 1), ("sig", "신호 횡단 수", 1), ("rise", "오르막 m", 5), ("stairs", "계단 구간", 1)]


def ok_other(a, s, key):
    for k, _, _ in MET:
        if k == key:
            continue
        if k == "rise":
            if a["rise"] > s["rise"] + 2:
                return False
        elif a[k] > s[k]:
            return False
    return True


print(f"쌍 {len(P)} · 직선거리 중앙값 {st.median(p['straight_m'] for p in P):.0f}m · 최단 걷는 시간 중앙값 {st.median(p['short']['time'] for p in P) / 60:.1f}분")
for k, name, _ in MET:
    v = [p["short"][k] for p in P]
    print(f"  최단 길 {name}: 평균 {st.mean(v):.1f}, 중앙값 {st.median(v):.1f}, 0인 쌍 {sum(1 for x in v if x == 0)}")
print()
print("허용 | 지표 | 줄일 수 있는 쌍(줄임 기준 이상) | 줄인 양 평균(전체 쌍) | 줄인 양 평균(줄인 쌍만)")
rows = []
for dlt in DELTAS:
    for k, name, thr in MET:
        red = []
        for p in P:
            s = p["short"]
            within = [a for a in p["alts"] if a["time"] <= s["time"] + dlt]
            best = min([s[k]] + [a[k] for a in within])
            red.append(s[k] - best)
        n_ok = sum(1 for r in red if r >= thr)
        pos = [r for r in red if r >= thr]
        print(f"+{dlt // 60 if dlt >= 60 else 0.5}분 | {name} | {n_ok} ({100 * n_ok / len(P):.0f}%) | {st.mean(red):.1f} | {st.mean(pos) if pos else 0:.1f}")
    print()
print("의미 있는 대안(다른 지표를 나쁘게 하지 않으면서 하나 이상 줄임)이 있는 쌍")
for dlt in DELTAS:
    n = 0; by = {k: 0 for k, _, _ in MET}
    for p in P:
        s = p["short"]; found = False
        for a in p["alts"]:
            if a["time"] > s["time"] + dlt:
                continue
            for k, _, thr in MET:
                if s[k] - a[k] >= thr and ok_other(a, s, k):
                    by[k] += 0  # 쌍 단위로만 센다
                    found = True
        hit = {k: any(a["time"] <= s["time"] + dlt and s[k] - a[k] >= thr and ok_other(a, s, k) for a in p["alts"]) for k, _, thr in MET}
        for k in by:
            by[k] += hit[k]
        n += found
    print(f"  +{dlt // 60 if dlt >= 60 else 0.5}분: {n}/{len(P)} ({100 * n / len(P):.0f}%) · 지표별 " + ", ".join(f"{name} {by[k]}" for k, name, _ in MET))
