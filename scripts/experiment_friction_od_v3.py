#!/usr/bin/env python3
"""서울 500쌍 이동 마찰 재실험(v3 = v2 + 서울시 지면고도). v2와 같은 횡단 판정·같은 길 제거.

(아래는 v2 설명. 지형은 v3에서 OA-22241 지면고도로 바뀌었다.)
서울 500쌍 이동 마찰 재실험(v2). v1(experiment_friction_od.py)과 같은 출발·도착 쌍을 쓴다. 점수화하지 않는다.

v1에서 고친 세 가지
1) 같은 길 제거: 최단 길과 겹치는 길이가 대안 길이의 90% 이상이거나, 추가 시간이 10초 이하이면 대안으로 세지 않는다.
2) 횡단 판정: 횡단보도 점 '근처를 지났다'가 아니라, 경로가 차도 축을 실제로 가로질렀을 때만 센다.
   - 경로가 지나는 노드에서, 경로가 쓰지 않은 차도 간선(cls 0/1) 중 서로 반대쪽으로 이어지는 두 가지(직선 차도)를 찾고,
     경로의 들어오는 방향과 나가는 방향이 그 차도 선의 서로 다른 쪽에 있으면 '횡단 1회'.
   - 끝나는 차도(T자 골목 입구)는 어느 쪽 보도인지 알 수 없어 세지 않는다(과소 집계 쪽).
   - 경로를 따라 25m 안에 이어진 횡단(왕복 차도 두 줄, 같은 교차로)은 하나로 묶는다.
   - 신호 횡단: 묶인 횡단 지점 25m 안에 서울 횡단보도 표준 자료의 보행등 있음(Y) 점이 있으면.
   - 큰길 횡단: 가로지른 차도에 간선도로(cls 0: primary/secondary/trunk)가 있으면.
3) 지형: 앱의 약 120m 간격 지형 대신 Mapzen Terrain Tiles(terrarium) 줌 14 타일을 받아 쓴다.
   타일 화소는 약 7.6m지만 한국 지역 원자료는 SRTM 계열(약 30m)로 알려져 있어 실제 해상도는 약 30m급이다(국토지리정보원 5m DEM 아님).
   - 상승고도: 경로를 30m 간격으로 다시 찍어 오르는 높이만 더한다.
   - 급경사 거리: 30m 구간의 경사가 5% 이상(오르막·내리막 모두)인 구간 길이의 합.
   - 육교·지하도(cls 4)는 지형 높이로 대신하지 않아 0으로 둔다.

대안 후보는 가중치를 바꾼 여러 탐색으로 모은다(가중치는 후보 찾기에만 쓰고 비교는 원시 지표로만).
사용: python3 scripts/experiment_friction_od_v2.py <서울 횡단보도 표준 CSV(cp949)> --pairs-from reports/experiments/friction_od_500.json
"""
import argparse, csv, glob, heapq, io, json, math, os, sys, time, urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs/prototype/seoul"
LON0, LAT0, Q = 126.58, 37.35, 1e5
SPEED = 1.2
KX = 111320 * math.cos(math.radians(37.5)); KY = 110540
DEM_Z = 14
DEM_DIR = Path(os.environ.get("DEM_CACHE", "/tmp/jjukgo_dem14"))
STEP = float(os.environ.get("DEM_STEP", "60"))  # 고도 재표본 간격(m). 30m급 원자료의 잡음(건물·나무 높이 포함 가능)을 줄이려고 60m 기본
STEEP = 0.05         # 급경사 기준(5%)
MERGE_M = 25.0       # 횡단 묶기 거리
SIG_R = 25.0         # 신호 판정 반경
SAME_OVERLAP = 0.9
SAME_EXTRA_S = 10.0


def xy(p):
    return ((p[0] - LON0) * KX, (p[1] - LAT0) * KY)


def dist(p, q):
    a, b = xy(p), xy(q)
    return math.hypot(a[0] - b[0], a[1] - b[1])


# ---------- 지형: 서울시 OA-22241 등고선·표고점으로 만든 10m 지면고도(scripts/build_ground_dem_oa22241.py) ----------
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ground_dem import GroundDEM, resample as _resample, dist as _dist
DEM = None
STEP = 40.0          # 경사 계산 간격(m). 10m 격자·5m 등고선의 계단 잡음을 줄이려고 40m(평지 시험으로 정함)
BRIDGE_DIP = 3.0     # 간선 가운데가 양 끝보다 3m 넘게 낮으면 다리·고가로 보고 양 끝을 직선으로 잇는다


def profile(pts):
    """(상승 m, 5% 이상 m, 8% 이상 m, 최대 경사 %, 고도를 아는 길이 m) — pts 방향 기준."""
    rs = _resample(pts, STEP)
    hs = [DEM.height(*p) for p in rs]
    if len(hs) > 2 and hs[0] is not None and hs[-1] is not None:
        inner = [h for h in hs[1:-1] if h is not None]
        if inner and min(inner) < min(hs[0], hs[-1]) - BRIDGE_DIP:
            tot = sum(_dist(a, b) for a, b in zip(rs, rs[1:])) or 1; acc = 0.0; lin = [hs[0]]
            for a, b in zip(rs, rs[1:]):
                acc += _dist(a, b); lin.append(hs[0] + (hs[-1] - hs[0]) * acc / tot)
            hs = lin
    up = s5 = s8 = mx = known = 0.0
    for (a, ha), (b, hb) in zip(zip(rs, hs), zip(rs[1:], hs[1:])):
        if ha is None or hb is None:
            continue
        L = _dist(a, b)
        if L < 1:
            continue
        known += L
        d = hb - ha; g = abs(d) / L * 100
        if d > 0: up += d
        if g >= 5: s5 += L
        if g >= 8: s8 += L
        mx = max(mx, g)
    return up, s5, s8, mx, known


# ---------- 그래프 ----------
def load_graph():
    nodes, edges = {}, {}
    for f in glob.glob(str(DATA / "graph/c*.json")):
        d = json.load(open(f))
        for r in d["n"]:
            nodes[r[0]] = (LON0 + r[1] / Q, LAT0 + r[2] / Q)
        for e in d["e"]:
            edges[(e[0], e[1])] = e
    E = []; adj = defaultdict(list)
    for (u, v), e in edges.items():
        if u not in nodes or v not in nodes:
            continue
        ax, ay = round((nodes[u][0] - LON0) * Q), round((nodes[u][1] - LAT0) * Q)
        pts = [nodes[u]]; g = e[4] or []; x, y = ax, ay
        for i in range(0, len(g), 2):
            x += g[i]; y += g[i + 1]; pts.append((LON0 + x / Q, LAT0 + y / Q))
        pts.append(nodes[v])
        i = len(E)
        E.append({"u": u, "v": v, "len": e[2], "cls": e[3], "pts": pts})
        adj[u].append((v, i)); adj[v].append((u, i))
    return nodes, E, adj


def ray_bearing(e, at):
    """노드 at에서 간선 e를 따라 나가는 방향(도, 북=0 시계)."""
    pts = e["pts"] if e["u"] == at else e["pts"][::-1]
    a = xy(pts[0])
    for q in pts[1:]:
        b = xy(q)
        if math.hypot(b[0] - a[0], b[1] - a[1]) > 3:
            break
    return math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) % 360


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("crosswalk_csv")
    ap.add_argument("--pairs-from", required=True)
    ap.add_argument("--dem", required=True, nargs="+", help="build_ground_dem_oa22241.py 출력 경로(확장자 없이). 여러 개면 앞에서부터 채움")
    ap.add_argument("--out", default=str(ROOT / "reports/experiments/friction_od_500_v3.json"))
    a = ap.parse_args()
    global DEM
    DEM = GroundDEM(*a.dem)
    t0 = time.time()
    nodes, E, adj = load_graph()
    print("그래프", len(nodes), "노드", len(E), "간선", f"{time.time() - t0:.0f}s", flush=True)

    # 횡단보도 점(신호 판정용) 격자
    XP = []
    for r in csv.DictReader(open(a.crosswalk_csv, encoding="cp949")):
        if r["경도"] and r["위도"]:
            XP.append(((float(r["경도"]), float(r["위도"])), r["보행등유무"] == "Y"))
    XG = defaultdict(list)
    for i, (p, _) in enumerate(XP):
        XG[(int(p[0] * 2000), int(p[1] * 2000))].append(i)

    def xw_near(p, R):
        cx, cy = int(p[0] * 2000), int(p[1] * 2000)
        return [i for dx in (-1, 0, 1) for dy in (-1, 0, 1) for i in XG.get((cx + dx, cy + dy), []) if dist(p, XP[i][0]) <= R]

    # 후보 탐색용 간선 비용(v1과 같은 방식의 근사: 점 10m 안 개수). 측정에는 쓰지 않는다.
    for e in E:
        mid = e["pts"][len(e["pts"]) // 2]
        near = xw_near(mid, 10 + e["len"] / 2) if e["cls"] in (2, 5) or e["len"] < 40 else []
        e["xw"] = len(near); e["xws"] = sum(1 for i in near if XP[i][1])

    prof_cache = {}

    def eprof(i, frm):
        k = (i, frm)
        if k not in prof_cache:
            e = E[i]
            if e["cls"] == 4:
                prof_cache[k] = (0.0, 0.0, 0.0, 0.0, e["len"])
            else:
                pts = e["pts"] if frm == e["u"] else e["pts"][::-1]
                prof_cache[k] = profile(pts)
        return prof_cache[k]

    def search(s, t, w):
        wx, ws, wr, wst, wt = w
        txy = xy(nodes[t])
        hf = lambda n: math.hypot(xy(nodes[n])[0] - txy[0], xy(nodes[n])[1] - txy[1]) / SPEED
        D = {s: 0.0}; prev = {}; pq = [(hf(s), 0.0, s)]; done = set()
        while pq:
            f, g, n = heapq.heappop(pq)
            if n in done:
                continue
            if n == t:
                break
            done.add(n)
            for m, i in adj[n]:
                e = E[i]; c = e["len"] / SPEED
                if wx: c += wx * e["xw"]
                if ws: c += ws * e["xws"]
                if wr or wst:
                    up, _, stp, _, _ = eprof(i, n); c += wr * up + wst * stp
                if wt and e["cls"] == 3: c += wt * e["len"]
                ng = g + c
                if ng < D.get(m, 1e18):
                    D[m] = ng; prev[m] = (n, i); heapq.heappush(pq, (ng + hf(m), ng, m))
        if t not in prev:
            return None
        path = []; n = t
        while n != s:
            pn, i = prev[n]; path.append((pn, i)); n = pn
        return path[::-1]

    def crossings(path):
        """경로 노드마다 차도 축을 가로지르는지 판정 → 25m 안 묶기 → 신호·큰길 판정."""
        ev = []; cum = 0.0
        for k in range(len(path) - 1):
            n_in, i_in = path[k]; i_out = path[k + 1][1]
            v = E[i_in]["v"] if E[i_in]["u"] == n_in else E[i_in]["u"]
            cum += E[i_in]["len"]
            used = {i_in, i_out}
            roads = [(ray_bearing(E[i], v), i) for _, i in adj[v] if i not in used and E[i]["cls"] in (0, 1)]
            if len(roads) < 2:
                continue
            b_in, b_out = ray_bearing(E[i_in], v), ray_bearing(E[i_out], v)
            # 서로 반대 방향(140도 이상)인 차도 두 가지를 한 줄로 묶는다
            pairs = []; usedr = set()
            cand = sorted(((abs(((ba - bb + 180) % 360) - 180), x, y) for x, (ba, ia) in enumerate(roads) for y, (bb, ib) in enumerate(roads) if x < y), reverse=True)
            for diff, x, y in cand:
                if diff < 140 or x in usedr or y in usedr:
                    continue
                usedr |= {x, y}; pairs.append((roads[x], roads[y]))
            for (ba, ia), (bb, ib) in pairs:
                side = lambda b: math.sin(math.radians(b - ba))
                si, so = side(b_in), side(b_out)
                if si * so < 0 and abs(si) > 0.17 and abs(so) > 0.17:
                    ev.append({"d": cum, "at": nodes[v], "big": E[ia]["cls"] == 0 or E[ib]["cls"] == 0})
        groups = []
        for x in ev:
            if groups and x["d"] - groups[-1][-1]["d"] <= MERGE_M:
                groups[-1].append(x)
            else:
                groups.append([x])
        n = len(groups); sig = big = marked = 0
        for g in groups:
            near = set()
            for x in g:
                near |= set(xw_near(x["at"], SIG_R))
            if any(XP[i][1] for i in near): sig += 1
            if near: marked += 1
            if any(x["big"] for x in g): big += 1
        return n, sig, big, marked

    def measure(path):
        L = sum(E[i]["len"] for _, i in path)
        up = steep = steep8 = mxs = kn = 0.0
        for n, i in path:
            u_, s_, s8, mx_, k_ = eprof(i, n); up += u_; steep += s_; steep8 += s8; mxs = max(mxs, mx_); kn += k_
        st_n = 0; st_m = 0.0; last = False
        for _, i in path:
            c = E[i]["cls"]
            if c == 3:
                st_m += E[i]["len"]
                if not last: st_n += 1
            last = c == 3
        n, sig, big, marked = crossings(path)
        return {"time": L / SPEED, "meters": L, "cross": n, "sig": sig, "big": big, "marked": marked,
                "rise": up, "steep5": steep, "steep": steep8, "max_slope": mxs, "elevation_gain_m": up, "slope_5pct_plus_m": steep, "slope_8pct_plus_m": steep8, "steep_distance_m": steep8, "max_slope_pct": mxs, "elev_known_frac": kn / L if L else 0, "stairs": st_n, "stair_m": st_m, "edges": [i for _, i in path]}

    W = [(0, 0, 0, 0, 0)]
    for v in (20, 60, 150):
        W += [(v, 0, 0, 0, 0), (0, v, 0, 0, 0)]
    for v in (2, 6, 15):
        W.append((0, 0, v, 0, 0))
    for v in (0.3, 1, 3):
        W.append((0, 0, 0, v, 0))
    for v in (1, 3, 8):
        W.append((0, 0, 0, 0, v))
    W += [(20, 20, 2, 0.3, 1), (60, 60, 6, 1, 3), (150, 150, 15, 3, 8)]

    pairs = json.load(open(a.pairs_from))["pairs"]
    out = []
    for k, p in enumerate(pairs):
        s, t = p["s"], p["t"]
        if isinstance(s, str): s, t = int(s), int(t)
        base = search(s, t, W[0])
        if not base:
            continue
        b = measure(base); bset = set(b["edges"])
        seen = {tuple(b["edges"])}; alts = []; dropped = 0
        for w in W[1:]:
            path = search(s, t, w)
            if not path:
                continue
            key = tuple(i for _, i in path)
            if key in seen:
                continue
            seen.add(key)
            m = measure(path)
            shared = sum(E[i]["len"] for i in m["edges"] if i in bset)
            m["overlap"] = shared / m["meters"] if m["meters"] else 1
            m["extra"] = m["time"] - b["time"]
            if m["overlap"] >= SAME_OVERLAP or m["extra"] <= SAME_EXTRA_S:
                dropped += 1; continue
            alts.append(m)
        strip = lambda m: {kk: (round(vv, 1) if isinstance(vv, float) else vv) for kk, vv in m.items() if kk != "edges"}
        out.append({"s": s, "t": t, "straight_m": p["straight_m"], "short": strip(b), "alts": [strip(m) for m in alts], "same_dropped": dropped})
        if (k + 1) % 25 == 0:
            print(k + 1, "쌍", f"{time.time() - t0:.0f}s", flush=True)
    json.dump({"params": {"speed": SPEED, "dem": "OA-22241 등고선 5m·표고점 → 10m 지면고도", "step_m": STEP, "bridge_dip_m": BRIDGE_DIP, "steep": "steep=8% 이상 구간 길이, steep5=5% 이상",
                          "merge_m": MERGE_M, "sig_r": SIG_R, "same_overlap": SAME_OVERLAP, "same_extra_s": SAME_EXTRA_S, "weights": W},
               "pairs": out}, open(a.out, "w"), ensure_ascii=False)
    print("저장", a.out, len(out), "쌍", f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
