#!/usr/bin/env python3
"""앱 보행 그래프 조각(docs/prototype/seoul/graph/c*.json)에 이동 마찰 원시값을 붙이고, 신호 판정용 횡단보도 점 파일을 만든다.

각 조각에 "f": {간선 순번: [a→b 상승(0.1m), b→a 상승(0.1m), 8% 이상 경사 거리(m), 근처 횡단보도 수, 그중 보행등 있음 수]} 를 넣는다(값이 모두 0이면 생략).
  - 상승·경사: 서울시 OA-22241 등고선·표고점으로 만든 10m 지면고도(scripts/build_ground_dem_oa22241.py), 40m 간격, 다리·고가 보정(가운데가 양 끝보다 3m 넘게 낮으면 직선 연결).
    실험 v3(scripts/experiment_friction_od_v3.py)와 같은 계산. 육교·지하도(cls 4)는 0.
  - 근처 횡단보도 수: 대안 길 후보를 찾을 때만 쓰는 근사(실험 v3와 같은 방식). 결과 표시용 신호 횡단 수는 앱이 경로에서 따로 센다.
docs/prototype/seoul/crosswalks_std.json: 서울 횡단보도 표준 자료(2026-03-20 기준) 점 [x, y, 보행등(1/0)] (좌표는 다른 서울 자료와 같은 정수화).

사용: python3 scripts/build_friction_layer.py <서울 횡단보도 표준 CSV(cp949)> <지면고도 격자 경로...>
필요: pip install pyshp pyproj scipy numpy (지면고도 격자 생성 시)
"""
import csv, glob, json, math, sys, time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ground_dem import GroundDEM, resample, dist

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs/prototype/seoul"
LON0, LAT0, Q = 126.58, 37.35, 1e5
STEP, BRIDGE_DIP = 40.0, 3.0


def profile(dem, pts):
    rs = resample(pts, STEP)
    hs = [dem.height(*p) for p in rs]
    if len(hs) > 2 and hs[0] is not None and hs[-1] is not None:
        inner = [h for h in hs[1:-1] if h is not None]
        if inner and min(inner) < min(hs[0], hs[-1]) - BRIDGE_DIP:
            tot = sum(dist(a, b) for a, b in zip(rs, rs[1:])) or 1; acc = 0.0; lin = [hs[0]]
            for a, b in zip(rs, rs[1:]):
                acc += dist(a, b); lin.append(hs[0] + (hs[-1] - hs[0]) * acc / tot)
            hs = lin
    up = down = s8 = 0.0
    for (a, ha), (b, hb) in zip(zip(rs, hs), zip(rs[1:], hs[1:])):
        if ha is None or hb is None:
            continue
        L = dist(a, b)
        if L < 1:
            continue
        d = hb - ha
        if d > 0: up += d
        else: down -= d
        if abs(d) / L >= 0.08: s8 += L
    return up, down, s8


def main():
    csv_path, dems = sys.argv[1], sys.argv[2:]
    t0 = time.time()
    dem = GroundDEM(*dems)
    pts = []
    for r in csv.DictReader(open(csv_path, encoding="cp949")):
        if r["경도"] and r["위도"]:
            pts.append((float(r["경도"]), float(r["위도"]), 1 if r["보행등유무"] == "Y" else 0))
    json.dump([[round((x - LON0) * Q), round((y - LAT0) * Q), s] for x, y, s in pts], open(DATA / "crosswalks_std.json", "w"), separators=(",", ":"))
    grid = defaultdict(list)
    for x, y, s in pts:
        grid[(int(x * 2000), int(y * 2000))].append((x, y, s))

    def near(p, R):
        cx, cy = int(p[0] * 2000), int(p[1] * 2000); out = []
        k = int(R / 45) + 1
        for dx in range(-k, k + 1):
            for dy in range(-k, k + 1):
                for q in grid.get((cx + dx, cy + dy), []):
                    if dist(p, q[:2]) <= R: out.append(q)
        return out

    files = sorted(glob.glob(str(DATA / "graph/c*.json")))
    nodes = {}
    for f in files:
        for r in json.load(open(f))["n"]:
            nodes[r[0]] = (LON0 + r[1] / Q, LAT0 + r[2] / Q)
    cache = {}; n_edges = n_f = 0
    for fi, f in enumerate(files):
        c = json.load(open(f)); F = {}
        for k, e in enumerate(c["e"]):
            a, b, length, cls, geom = e[0], e[1], e[2], e[3], e[4]
            if a not in nodes or b not in nodes:
                continue
            n_edges += 1
            key = (a, b, length)
            if key not in cache:
                ax, ay = round((nodes[a][0] - LON0) * Q), round((nodes[a][1] - LAT0) * Q)
                pl = [nodes[a]]; g = geom or []; x, y = ax, ay
                for i in range(0, len(g), 2):
                    x += g[i]; y += g[i + 1]; pl.append((LON0 + x / Q, LAT0 + y / Q))
                pl.append(nodes[b])
                up, down, s8 = (0.0, 0.0, 0.0) if cls == 4 else profile(dem, pl)
                mid = pl[len(pl) // 2]
                nr = near(mid, 10 + length / 2) if cls in (2, 5) or length < 40 else []
                cache[key] = [round(up * 10), round(down * 10), round(s8), len(nr), sum(q[2] for q in nr)]
            v = cache[key]
            if any(v):
                F[str(k)] = v; n_f += 1
        c["f"] = F
        Path(f).write_text(json.dumps(c, separators=(",", ":")), encoding="utf-8")
        if (fi + 1) % 50 == 0:
            print(fi + 1, "/", len(files), "조각", f"{time.time() - t0:.0f}s", flush=True)
    print("간선", n_edges, "값 붙인 간선", n_f, "횡단보도 점", len(pts), f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
