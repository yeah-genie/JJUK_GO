#!/usr/bin/env python3
"""OpenStreetMap 데이터로 프로토타입 지도 레이어와 실제 보행 경로를 만든다.

  python scripts/build_map_data.py map.osm seoul_crossings.csv --write docs/prototype/index.html

- 지도: 건물, 도로(등급별), 보행로, 지하철 출구, 신호 횡단보도 → GeoJSON
- 경로: 걸을 수 있는 길로 그래프를 만들고 다익스트라로
    최단  = 거리 최소
    쭉고  = 거리 + 신호 횡단보도 1곳당 SIGNAL_PENALTY_M (약 1분 기다림을 거리로 환산)
- 신호: OSM 신호 표시(crossing=traffic_signals, highway=traffic_signals)를 25m 안에서 한 곳으로 묶고,
  70m 안의 서울 C-ITS 교차로(전국 교차로 목록)와 맞춰 그 ID를 붙인다(실제 신호 패턴을 연결하기 위해).
지도 데이터 © OpenStreetMap contributors (ODbL).
"""

import argparse
import csv
import heapq
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

WALKABLE = {"primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "residential",
            "unclassified", "living_street", "service", "footway", "pedestrian", "path", "steps", "cycleway", "crossing"}
ROAD_CLASS = {"trunk": "major", "primary": "major", "primary_link": "major", "secondary": "major", "secondary_link": "major",
              "tertiary": "minor", "tertiary_link": "minor", "residential": "minor", "unclassified": "minor", "living_street": "minor",
              "service": "service", "footway": "path", "pedestrian": "path", "path": "path", "steps": "path", "cycleway": "path"}
SIGNAL_PENALTY_M = 70.0
START = (127.0369311, 37.500825)   # 역삼역 (교차로 2217)
DEST = (127.048718, 37.505321)     # 선릉역 북쪽 (테헤란로에서 북쪽 약 95m)
OUT = (127.0352, 37.5052)          # 신호 패턴 수집 구간 밖 예시 목적지 (역삼역 북서쪽)
MARK = re.compile(r"/\*MAP_DATA\*/.*?/\*END_MAP\*/", re.S)


def dist_m(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111320 * math.cos(lat), (a[1] - b[1]) * 110540)


def r6(p):
    return [round(p[0], 6), round(p[1], 6)]


def parse(osm_path):
    root = ET.parse(osm_path).getroot()
    nodes, ntags = {}, {}
    for n in root.iter("node"):
        nodes[n.get("id")] = (float(n.get("lon")), float(n.get("lat")))
        t = {x.get("k"): x.get("v") for x in n.iter("tag")}
        if t:
            ntags[n.get("id")] = t
    ways = []
    for w in root.iter("way"):
        t = {x.get("k"): x.get("v") for x in w.iter("tag")}
        refs = [nd.get("ref") for nd in w.iter("nd") if nd.get("ref") in nodes]
        if len(refs) >= 2:
            ways.append((t, refs))
    return nodes, ntags, ways


def signal_groups(nodes, adj, ntags, crossings, bounds, radius=35.0):
    """신호 교차로 묶음. 기준은 전국 교차로 목록의 C-ITS 교차로(모두 신호 교차로)이고,
    그 중심에서 radius 안의 보행 그래프 노드를 지나면 그 신호를 지나는 것으로 본다.
    C-ITS 목록에 없는 OSM 신호 표시는 따로 한 곳으로 둔다."""
    lo0, la0, lo1, la1 = bounds
    groups = []
    for c in crossings:
        if not (lo0 - 0.002 <= c["lon"] <= lo1 + 0.002 and la0 - 0.002 <= c["lat"] <= la1 + 0.002):
            continue
        groups.append({"id": c["crsrd_id"], "name": f'{c["name"]} 횡단보도', "center": (c["lon"], c["lat"]), "nodes": []})
    for nid, t in ntags.items():
        if t.get("highway") == "traffic_signals" or t.get("crossing") == "traffic_signals":
            p = nodes[nid]
            if not any(dist_m(p, g["center"]) < 70 for g in groups):
                groups.append({"id": f"osm{nid}", "name": "신호 횡단보도", "center": p, "nodes": []})
    for nid in adj:
        p = nodes[nid]
        best = None
        for i, g in enumerate(groups):
            d = dist_m(p, g["center"])
            if d < radius and (best is None or d < best[0]):
                best = (d, i)
        if best:
            groups[best[1]]["nodes"].append(nid)
    return [g for g in groups if g["nodes"]]


def build_graph(nodes, ways):
    adj = {}
    for t, refs in ways:
        if t.get("highway") not in WALKABLE or t.get("foot") == "no" or t.get("access") == "private":
            continue
        for a, b in zip(refs, refs[1:]):
            d = dist_m(nodes[a], nodes[b])
            adj.setdefault(a, []).append((b, d))
            adj.setdefault(b, []).append((a, d))
    return adj


def nearest(nodes, adj, p):
    return min(adj, key=lambda n: dist_m(nodes[n], p))


def dijkstra(adj, src, dst, node_cost):
    best, prev, pq = {src: 0.0}, {}, [(0.0, src)]
    while pq:
        c, u = heapq.heappop(pq)
        if u == dst:
            break
        if c > best.get(u, math.inf):
            continue
        for v, d in adj[u]:
            nc = c + d + node_cost(u, v)
            if nc < best.get(v, math.inf):
                best[v], prev[v] = nc, u
                heapq.heappush(pq, (nc, v))
    path, u = [dst], dst
    while u != src:
        u = prev[u]
        path.append(u)
    return path[::-1]


def describe(path, nodes, node_group, groups):
    coords = [nodes[n] for n in path]
    cum = [0.0]
    for a, b in zip(coords, coords[1:]):
        cum.append(cum[-1] + dist_m(a, b))
    xings, seen = [], set()
    for i, n in enumerate(path):
        g = node_group.get(n)
        if g is not None and groups[g]["id"] not in seen:
            seen.add(groups[g]["id"])
            xings.append({"d": round(cum[i], 1), "s": groups[g]["id"], "name": groups[g]["name"], "at": r6(nodes[n])})
    return {"coords": [r6(c) for c in coords], "cum": [round(x, 1) for x in cum], "length": round(cum[-1], 1), "x": xings}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("osm", type=Path)
    ap.add_argument("crossings_csv", type=Path)
    ap.add_argument("--write", type=Path)
    a = ap.parse_args()

    nodes, ntags, ways = parse(a.osm)
    crossings = [dict(r, lat=float(r["lat"]), lon=float(r["lon"])) for r in csv.DictReader(open(a.crossings_csv, encoding="utf-8")) if r["lat"]]
    adj = build_graph(nodes, ways)
    bounds = [127.0330, 37.4985, 127.0530, 37.5070]
    groups = signal_groups(nodes, adj, ntags, crossings, bounds)
    node_group = {nid: i for i, g in enumerate(groups) for nid in g["nodes"]}

    src, dst = nearest(nodes, adj, START), nearest(nodes, adj, DEST)
    short = dijkstra(adj, src, dst, lambda u, v: 0.0)
    jjuk = dijkstra(adj, src, dst, lambda u, v: SIGNAL_PENALTY_M if v in node_group and node_group.get(u) != node_group[v] else 0.0)
    routes = {"short": describe(short, nodes, node_group, groups), "jjuk": describe(jjuk, nodes, node_group, groups)}
    out = nearest(nodes, adj, OUT)
    few_cost = lambda u, v: SIGNAL_PENALTY_M if v in node_group and node_group.get(u) != node_group[v] else 0.0
    routes["nc_short"] = describe(dijkstra(adj, src, out, lambda u, v: 0.0), nodes, node_group, groups)
    routes["nc_few"] = describe(dijkstra(adj, src, out, few_cost), nodes, node_group, groups)

    feats = {"buildings": [], "roads": [], "subway": [], "signals": []}
    for t, refs in ways:
        coords = [r6(nodes[r]) for r in refs]
        if "building" in t and refs[0] == refs[-1] and len(refs) >= 4:
            feats["buildings"].append({"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [coords]}})
        elif t.get("highway") in ROAD_CLASS:
            feats["roads"].append({"type": "Feature", "properties": {"c": ROAD_CLASS[t["highway"]], "n": t.get("name", "")},
                                   "geometry": {"type": "LineString", "coordinates": coords}})
    for nid, t in ntags.items():
        if t.get("railway") == "subway_entrance":
            feats["subway"].append({"type": "Feature", "properties": {"ref": t.get("ref", "")}, "geometry": {"type": "Point", "coordinates": r6(nodes[nid])}})
    for g in groups:
        feats["signals"].append({"type": "Feature", "properties": {"id": g["id"], "name": g["name"]}, "geometry": {"type": "Point", "coordinates": r6(g["center"])}})
    # 큰길 이름표: 이름별로 가장 긴 구간의 가운데
    labels = {}
    for t, refs in ways:
        if ROAD_CLASS.get(t.get("highway")) == "major" and t.get("name"):
            L = sum(dist_m(nodes[x], nodes[y]) for x, y in zip(refs, refs[1:]))
            if L > labels.get(t["name"], (0,))[0]:
                labels[t["name"]] = (L, r6(nodes[refs[len(refs) // 2]]))
    data = {
        "bounds": bounds,
        "start": r6(nodes[src]), "dest": r6(nodes[dst]), "out": r6(nodes[out]),
        "layers": {k: {"type": "FeatureCollection", "features": v} for k, v in feats.items()},
        "labels": [{"name": k, "at": v[1]} for k, v in labels.items()],
        "routes": routes,
        "signalPenaltyM": SIGNAL_PENALTY_M,
        "source": "© OpenStreetMap contributors (ODbL), 2026-10-28 내려받음",
    }
    summary = {k: {"length_m": r["length"], "signals": [(x["s"], x["name"]) for x in r["x"]]} for k, r in routes.items()}
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    print("groups", len(groups), "matched to C-ITS", sum(1 for g in groups if not g["id"].startswith("osm")),
          "| buildings", len(feats["buildings"]), "roads", len(feats["roads"]), "labels", [l["name"] for l in data["labels"]])
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    print("size KB", round(len(js.encode()) / 1024))
    if a.write:
        html = a.write.read_text(encoding="utf-8")
        assert MARK.search(html), "/*MAP_DATA*/ 표시가 없어요"
        a.write.write_text(MARK.sub(lambda m: "/*MAP_DATA*/" + js + "/*END_MAP*/", html), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
