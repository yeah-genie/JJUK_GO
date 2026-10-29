#!/usr/bin/env python3
"""서울 무작위 출발·도착 쌍에서 '최단 걷는 시간 + 허용 시간' 안에 이동 마찰이 적은 길이 있는지 원시 지표로 센다.

점수화하지 않는다. 지표는 경로마다 따로 센다.
  - 횡단 수: 서울시 횡단보도 표준 자료(점) 중, 경로가 그 횡단보도를 '가로질러' 지나는 것.
    점 근처 차도의 방향으로 횡단 방향(차도에 수직)을 정하고, 경로 구간이 그 방향과 비슷할 때만 센다.
  - 신호 횡단 수: 위 횡단 중 보행등 있음(Y).
  - 오르막(누적 상승 m): 앱의 지형 자료(약 120m 간격, 거침)로 노드 높이를 보간해 오르는 양만 더한다. 육교·지하도(cls 4)는 제외.
  - 계단: 지도(OSM)에 표시된 계단 구간 수와 길이.
시간은 걷는 시간만(길이 ÷ 1.2m/s). 신호 대기 가정(곳당 45초 등)은 넣지 않는다.

대안 경로는 가중치를 바꾼 여러 번의 탐색으로 만든다(가중치는 후보를 찾는 데만 쓰고 결과 비교에는 원시 지표만 쓴다).

사용: python3 scripts/experiment_friction_od.py <서울 횡단보도 표준 CSV(cp949)> [--pairs 500] [--seed 42] [--out reports/...json]
"""
import argparse, csv, glob, heapq, json, math, random, statistics as st, sys, time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs/prototype/seoul"
LON0, LAT0, Q = 126.58, 37.35, 1e5
SPEED = 1.2
KX = 111320 * math.cos(math.radians(37.5)); KY = 110540
R_CROSS = 10.0        # 경로 구간과 횡단보도 점 사이 최대 거리(m)
ANG_CROSS = 35.0      # 경로 방향과 횡단 방향 차이 허용(도)
R_ROAD = 12.0         # 횡단보도 점에서 차도를 찾는 거리(m)


def xy(lon, lat):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def load_graph():
    nodes, edges = {}, {}
    for f in glob.glob(str(DATA / "graph/c*.json")):
        d = json.load(open(f))
        for r in d["n"]:
            nodes[r[0]] = (LON0 + r[1] / Q, LAT0 + r[2] / Q)
        for e in d["e"]:
            edges[(e[0], e[1])] = e
    return nodes, edges


def edge_points(e, nodes):
    a, b = e[0], e[1]
    ax, ay = round((nodes[a][0] - LON0) * Q), round((nodes[a][1] - LAT0) * Q)
    pts = [nodes[a]]
    g = e[4] or []
    x, y = ax, ay
    for i in range(0, len(g), 2):
        x += g[i]; y += g[i + 1]
        pts.append((LON0 + x / Q, LAT0 + y / Q))
    pts.append(nodes[b])
    return pts


def terrain():
    T = json.load(open(DATA / "terrain.json"))
    n, size = 2 ** T["zoom"], T["size"]

    def h(lon, lat):
        px = (lon + 180) / 360 * n * size
        py = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n * size
        x, y = math.floor(px), math.floor(py); fx, fy = px - x, py - y

        def s(a, b):
            t = T["tiles"].get(f"{a // size}_{b // size}")
            return None if t is None else t[(b % size) * size + a % size]
        v = [s(x, y), s(x + 1, y), s(x, y + 1), s(x + 1, y + 1)]
        if any(c is None for c in v):
            return None
        a, b, c, d = v
        return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
    return h


def bearing(p, q):
    (x0, y0), (x1, y1) = xy(*p), xy(*q)
    return math.degrees(math.atan2(x1 - x0, y1 - y0)) % 180  # 방향 없는 선 각도(0~180)


def angdiff(a, b):
    d = abs(a - b) % 180
    return min(d, 180 - d)


def seg_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = xy(*p), xy(*a), xy(*b)
    dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("crosswalk_csv")
    ap.add_argument("--pairs", type=int, default=500)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--r-cross", type=float, default=10.0)
    ap.add_argument("--ang-cross", type=float, default=35.0)
    ap.add_argument("--out", default=str(ROOT / "reports/experiments/friction_od_500.json"))
    a = ap.parse_args()
    global R_CROSS, ANG_CROSS
    R_CROSS, ANG_CROSS = a.r_cross, a.ang_cross
    t0 = time.time()
    nodes, edges = load_graph()
    H = terrain()
    hn = {k: H(*v) for k, v in nodes.items()}
    adj = defaultdict(list)
    E = []  # 간선 정보
    for (u, v), e in edges.items():
        if u not in nodes or v not in nodes:
            continue
        pts = edge_points(e, nodes)
        idx = len(E)
        E.append({"u": u, "v": v, "len": e[2], "cls": e[3], "pts": pts, "xw": set()})
        adj[u].append((v, idx)); adj[v].append((u, idx))
    print("그래프", len(nodes), "노드", len(E), "간선", f"{time.time() - t0:.0f}s", flush=True)

    # 격자 색인: 간선 구간
    G = defaultdict(list)
    for i, e in enumerate(E):
        for j in range(len(e["pts"]) - 1):
            p, q = e["pts"][j], e["pts"][j + 1]
            for cell in {(int(p[0] * 2000), int(p[1] * 2000)), (int(q[0] * 2000), int(q[1] * 2000))}:
                G[cell].append((i, j))

    def near_segs(p):
        cx, cy = int(p[0] * 2000), int(p[1] * 2000)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                yield from G.get((cx + dx, cy + dy), [])

    # 횡단보도 점 → 횡단 방향(가까운 차도에 수직) → 그 방향으로 지나는 간선에 붙이기
    X = []
    no_road = 0
    for r in csv.DictReader(open(a.crosswalk_csv, encoding="cp949")):
        if not r["경도"] or not r["위도"]:
            continue
        p = (float(r["경도"]), float(r["위도"]))
        best = (R_ROAD, None)
        for i, j in near_segs(p):
            if E[i]["cls"] in (0, 1):
                d = seg_dist(p, E[i]["pts"][j], E[i]["pts"][j + 1])
                if d < best[0]:
                    best = (d, bearing(E[i]["pts"][j], E[i]["pts"][j + 1]))
        if best[1] is None:
            no_road += 1
            continue
        k = len(X)
        X.append({"p": p, "sig": r["보행등유무"] == "Y", "cross": (best[1] + 90) % 180})
        seen = set()
        for i, j in near_segs(p):
            if (i, j) in seen:
                continue
            seen.add((i, j))
            sp, sq = E[i]["pts"][j], E[i]["pts"][j + 1]
            if seg_dist(p, sp, sq) <= R_CROSS and angdiff(bearing(sp, sq), X[k]["cross"]) <= ANG_CROSS:
                E[i]["xw"].add(k)
    print("횡단보도 점", len(X), "· 근처 차도 없음", no_road, f"{time.time() - t0:.0f}s", flush=True)

    def rise(i, frm):
        e = E[i]
        if e["cls"] == 4:
            return 0.0
        to = e["v"] if frm == e["u"] else e["u"]
        a_, b_ = hn.get(frm), hn.get(to)
        return 0.0 if a_ is None or b_ is None else max(0.0, b_ - a_)

    def search(s, t, w):
        """w = (횡단당 초, 신호 횡단당 초, 상승 m당 초, 계단 m당 초). A*(남은 직선거리 ÷ 속도)."""
        wx, ws, wr, wt = w
        tx, ty = xy(*nodes[t])
        hfun = lambda n: math.hypot(xy(*nodes[n])[0] - tx, xy(*nodes[n])[1] - ty) / SPEED
        dist = {s: 0.0}; prev = {}; pq = [(hfun(s), 0.0, s)]; done = set()
        while pq:
            f, g, n = heapq.heappop(pq)
            if n in done:
                continue
            if n == t:
                break
            done.add(n)
            for m, i in adj[n]:
                e = E[i]
                c = e["len"] / SPEED
                if wx or ws:
                    c += wx * len(e["xw"]) + ws * sum(1 for k in e["xw"] if X[k]["sig"])
                if wr:
                    c += wr * rise(i, n)
                if wt and e["cls"] == 3:
                    c += wt * e["len"]
                ng = g + c
                if ng < dist.get(m, 1e18):
                    dist[m] = ng; prev[m] = (n, i); heapq.heappush(pq, (ng + hfun(m), ng, m))
        if t not in prev and s != t:
            return None
        path = []; n = t
        while n != s:
            pn, i = prev[n]; path.append((pn, i)); n = pn
        return path[::-1]

    def measure(path):
        L = sum(E[i]["len"] for _, i in path)
        xs = set()
        for _, i in path:
            xs |= E[i]["xw"]
        up = sum(rise(i, n) for n, i in path)
        st_n = 0; st_m = 0.0; last = False; osm_x = 0; last5 = False
        for _, i in path:
            c = E[i]["cls"]
            if c == 3:
                st_m += E[i]["len"]
                if not last:
                    st_n += 1
            last = c == 3
            if c == 5 and not last5:
                osm_x += 1
            last5 = c == 5
        return {"time": L / SPEED, "meters": L, "cross": len(xs), "sig": sum(1 for k in xs if X[k]["sig"]),
                "rise": up, "stairs": st_n, "stair_m": st_m, "osm_cross": osm_x,
                "key": ",".join(str(i) for _, i in path)}

    W = [(0, 0, 0, 0)]
    for v in (20, 60, 150):
        W += [(v, 0, 0, 0), (0, v, 0, 0)]
    for v in (2, 6, 15):
        W.append((0, 0, v, 0))
    for v in (1, 3, 8):
        W.append((0, 0, 0, v))
    W += [(20, 20, 2, 1), (60, 60, 6, 3), (150, 150, 15, 8)]

    rnd = random.Random(a.seed)
    # 가장 큰 연결 덩어리 안에서만 출발·도착을 고른다(작은 섬 같은 조각 제외)
    comp = {}; best = []
    for k0 in adj:
        if k0 in comp:
            continue
        stack = [k0]; comp[k0] = k0; members = []
        while stack:
            n = stack.pop(); members.append(n)
            for m, _ in adj[n]:
                if m not in comp:
                    comp[m] = k0; stack.append(m)
        if len(members) > len(best):
            best = members
    keys = best
    print("가장 큰 연결 덩어리", len(keys), "노드", flush=True)
    NG = defaultdict(list)
    for n in keys:
        x_, y_ = xy(*nodes[n]); NG[(int(x_ // 200), int(y_ // 200))].append(n)
    out = []; tries = 0
    while len(out) < a.pairs and tries < a.pairs * 20:
        tries += 1
        # 출발점을 고르고, 600~2500m 떨어진 임의 지점에서 가장 가까운 노드를 도착점으로 한다
        s = rnd.choice(keys)
        sx, sy = xy(*nodes[s]); dd = rnd.uniform(600, 2500); ang = rnd.uniform(0, 2 * math.pi)
        gx, gy = sx + dd * math.sin(ang), sy + dd * math.cos(ang)
        cell = (int(gx // 200), int(gy // 200)); cand = [n for dx in (-1, 0, 1) for dy in (-1, 0, 1) for n in NG.get((cell[0] + dx, cell[1] + dy), [])]
        if not cand:
            continue
        t = min(cand, key=lambda n: (xy(*nodes[n])[0] - gx) ** 2 + (xy(*nodes[n])[1] - gy) ** 2)
        (tx, ty) = xy(*nodes[t])
        d = math.hypot(sx - tx, sy - ty)
        if not 600 <= d <= 2500:
            continue
        base = search(s, t, W[0])
        if not base:
            continue
        cands = {}
        for w in W:
            p = search(s, t, w)
            if p:
                m = measure(p)
                cands.setdefault(m["key"], m)
        b = measure(base)
        out.append({"s": s, "t": t, "straight_m": round(d), "short": {k: v for k, v in b.items() if k != "key"},
                    "alts": [{k: v for k, v in m.items() if k != "key"} for kk, m in cands.items() if kk != b["key"]]})
        if len(out) % 25 == 0:
            print(len(out), "쌍", f"{time.time() - t0:.0f}s", flush=True)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    json.dump({"params": {"speed": SPEED, "r_cross": R_CROSS, "ang_cross": ANG_CROSS, "weights": W, "seed": a.seed,
                          "straight_m": [600, 2500]}, "pairs": out}, open(a.out, "w"), ensure_ascii=False)
    print("저장", a.out, len(out), "쌍", f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
