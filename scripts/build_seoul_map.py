"""서울 전체 지도·길찾기 데이터를 만든다 (프로토타입 웹앱용).

입력 (BBBike 서울 추출본, © OpenStreetMap contributors, ODbL):
  Seoul.osm.pbf, Seoul.mbtiles (shortbread 스키마 벡터 타일)
  seoul_crossings.csv (전국 교차로 목록 중 서울 C-ITS 신호 교차로)

출력 (OUT 아래, 웹앱 옆에 함께 올린다):
  tiles/index.json, tiles/b*.bin  타일 묶음. 파일 수 제한 때문에 타일을 묶고, 위치는 index에 둔다.
  graph/index.json, graph/c*.json 보행 그래프 조각(약 1.8km 칸). 길찾기는 브라우저에서 필요한 칸만 받아 한다.
  search.json                     장소 검색 목록(역·동네·주요 시설)
  signals.json                    신호 교차로 위치(C-ITS + OSM 신호 표시)
  glyphs/*.pbf                    지도 글자(라틴·숫자·문장부호). 한글은 기기 글꼴로 그린다.
                                  GLYPHS 폴더는 npm 패키지 smp-noto-glyphs의 fixtures/glyphs (Noto Sans, OFL)

사용: python scripts/build_seoul_map.py Seoul.osm.pbf Seoul.mbtiles seoul_crossings.csv OUT [GLYPHS]
"""
from __future__ import annotations

import csv
import gzip
import json
import math
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

import osmium

LON0, LAT0 = 126.58, 37.35          # 추출 범위 남서쪽 (좌표 정수화 기준)
# 길찾기·검색 범위: 서울시를 감싸는 사각형. 추출본은 경기 일부까지 담고 있다.
BBOX = (126.76, 37.42, 127.19, 37.70)
CELL_LON, CELL_LAT = 0.025, 0.02     # 그래프 조각 크기 (약 2.2km)
Q = 1e5                              # 좌표 정수화 (약 1m)

WALKABLE = {"primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "residential",
            "unclassified", "living_street", "service", "footway", "pedestrian", "path", "steps", "cycleway",
            "crossing", "track", "corridor", "road"}
# 경로 표시에 쓰는 도로 등급: 0 큰길, 1 골목, 2 보행로, 3 계단, 4 입체 보행(지하도·육교·실내)
def edge_class(t):
    hw = t.get("highway")
    if t.get("layer", "0").startswith("-") or t.get("tunnel") in ("yes", "building_passage") or hw == "corridor":
        return 4
    if t.get("bridge") == "yes" and hw in ("footway", "path", "steps", "pedestrian"):
        return 4
    if hw == "steps":
        return 3
    if hw in ("footway", "pedestrian", "path", "cycleway", "crossing", "track"):
        return 2
    if hw in ("primary", "primary_link", "secondary", "secondary_link", "trunk", "trunk_link"):
        return 0
    return 1


def walkable(t):
    hw = t.get("highway")
    if t.get("foot") in ("yes", "designated"):
        return hw is not None and hw not in ("motorway", "motorway_link")
    if hw in ("trunk", "trunk_link"):
        return t.get("sidewalk") not in (None, "no", "none")
    if hw not in WALKABLE:
        return False
    if t.get("foot") == "no" or t.get("access") in ("private", "no"):
        return False
    if t.get("area") == "yes" and hw != "pedestrian":
        return False
    return True


def dist_m(a, b):
    kx = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110540)


def qx(lon):
    return round((lon - LON0) * Q)


def qy(lat):
    return round((lat - LAT0) * Q)


def in_bbox(lon, lat):
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def cell_of(lon, lat):
    return int((lon - LON0) // CELL_LON), int((lat - LAT0) // CELL_LAT)


class Ways(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []          # (refs, cls)
        self.loc = {}
        self.signals = []       # OSM 신호 노드 위치
        self.places = []        # 검색 후보 (name, lon, lat, kind, rank)

    def node(self, n):
        t = n.tags
        if t.get("highway") == "traffic_signals" or t.get("crossing") == "traffic_signals" or t.get("crossing:signals") == "yes":
            self.signals.append((n.location.lon, n.location.lat))
        name = t.get("name")
        if not name:
            return
        k = place_kind(t)
        if k:
            self.places.append((name, n.location.lon, n.location.lat, *k))

    def way(self, w):
        t = w.tags
        name = t.get("name")
        # 닫힌 길(건물·공원 등 면)은 area()에서 다룬다
        if name and not t.get("highway") and not w.is_closed():
            k = place_kind(t)
            if k:
                try:
                    pts = [(nd.lon, nd.lat) for nd in w.nodes]
                except osmium.InvalidLocationError:
                    pts = []
                if pts:
                    lon = sum(p[0] for p in pts) / len(pts)
                    lat = sum(p[1] for p in pts) / len(pts)
                    self.places.append((name, lon, lat, *k))
        if "highway" not in t or not walkable(t):
            return
        refs = []
        for nd in w.nodes:
            if not nd.location.valid():
                continue
            refs.append(nd.ref)
            self.loc[nd.ref] = (nd.location.lon, nd.location.lat)
        if len(refs) >= 2:
            self.ways.append((refs, edge_class(t)))

    def area(self, a):
        # 공원·궁·대학처럼 면으로 그린 장소(닫힌 길, 멀티폴리곤). 바깥 테두리 점들의 평균을 위치로 쓴다
        name = a.tags.get("name")
        k = place_kind(a.tags) if name else None
        if not k:
            return
        for ring in a.outer_rings():
            pts = [(n.lon, n.lat) for n in ring if n.location.valid()]
            if pts:
                self.places.append((name, sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), *k))
            return


# 검색에 넣을 장소 종류: (표시 이름, 순위). 순위가 낮을수록 위에 보인다.
def place_kind(t):
    if t.get("railway") == "station" or t.get("public_transport") == "station" and t.get("subway") == "yes":
        return ("역", 0)
    p = t.get("place")
    if p in ("suburb", "quarter", "neighbourhood", "borough"):
        return ("동네", 1)
    a = t.get("amenity")
    if a in ("university", "college"):
        return ("대학교", 1)
    if a in ("hospital",):
        return ("병원", 2)
    if a in ("townhall", "library", "community_centre", "police", "post_office", "school", "marketplace"):
        return ({"townhall": "관공서", "library": "도서관", "community_centre": "주민센터", "police": "경찰",
                 "post_office": "우체국", "school": "학교", "marketplace": "시장"}[a], 2)
    if (t.get("leisure") in ("park", "stadium", "garden") or t.get("tourism") in ("attraction", "museum", "gallery", "zoo", "theme_park", "viewpoint")
            or t.get("historic") in ("castle", "palace", "monument", "city_gate", "archaeological_site", "fort")
            or t.get("place") == "square" or t.get("natural") == "water" and t.get("water") in (None, "lake", "pond", "reservoir")):
        return ("명소", 1)
    if t.get("shop") in ("mall", "department_store"):
        return ("쇼핑", 2)
    if a in ("cafe",):
        return ("카페", 3)
    if t.get("building") and t.get("name") and t.get("building") in ("commercial", "office", "retail", "public", "government"):
        return ("건물", 3)
    return None


def build_graph(h):
    use = defaultdict(int)
    for refs, _ in h.ways:
        use[refs[0]] += 2
        use[refs[-1]] += 2
        for r in refs:
            use[r] += 1
    # 그래프 노드: 길 끝점, 여러 길이 만나는 점
    nid = {}
    def node_id(ref):
        if ref not in nid:
            nid[ref] = len(nid)
        return nid[ref]
    edges = []  # (a, b, length_m, [중간 좌표], cls)
    for refs, cls in h.ways:
        if not any(in_bbox(*h.loc[r]) for r in refs):
            continue
        start = 0
        for i in range(1, len(refs)):
            if use[refs[i]] >= 2 or i == len(refs) - 1:
                seg = refs[start:i + 1]
                pts = [h.loc[r] for r in seg]
                length = sum(dist_m(p, q) for p, q in zip(pts, pts[1:]))
                if seg[0] != seg[-1] or length > 1:
                    edges.append((node_id(seg[0]), node_id(seg[-1]), length, pts[1:-1], cls))
                start = i
    coords = [None] * len(nid)
    for ref, i in nid.items():
        coords[i] = h.loc[ref]
    return coords, edges


def load_crossings(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                out.append({"id": r["crsrd_id"], "name": r["name"], "lon": float(r["lon"]), "lat": float(r["lat"])})
            except ValueError:
                continue
    return out


def signal_groups(crossings, osm_signals):
    """신호 교차로 묶음. 기준은 C-ITS 교차로이고, 15m 안에 겹친 C-ITS(연동 신호 등)는 한 곳으로 본다.
    C-ITS에서 70m 넘게 떨어진 OSM 신호 표시는 30m 안끼리 묶어 따로 한 곳으로 둔다."""
    grid = defaultdict(list)
    def key(lon, lat):
        return int(lon / 0.001), int(lat / 0.001)
    def near(lon, lat, r):
        kx, ky = key(lon, lat)
        span = int(r / 80) + 1
        for dx in range(-span, span + 1):
            for dy in range(-span, span + 1):
                for g in grid[(kx + dx, ky + dy)]:
                    if dist_m((lon, lat), (g["lon"], g["lat"])) < r:
                        yield g
    groups = []
    for c in sorted(crossings, key=lambda c: ("(" in c["name"], len(c["name"]), c["id"])):
        if any(True for _ in near(c["lon"], c["lat"], 15)):
            next(near(c["lon"], c["lat"], 15))["ids"].append(c["id"])
            continue
        g = {"id": c["id"], "ids": [c["id"]], "name": c["name"], "lon": c["lon"], "lat": c["lat"], "src": "cits"}
        groups.append(g)
        grid[key(c["lon"], c["lat"])].append(g)
    n_osm = 0
    for lon, lat in osm_signals:
        if not in_bbox(lon, lat):
            continue
        if any(g["src"] == "cits" for g in near(lon, lat, 70)):
            continue
        if any(True for _ in near(lon, lat, 30)):
            continue
        n_osm += 1
        g = {"id": f"o{n_osm}", "ids": [], "name": "", "lon": lon, "lat": lat, "src": "osm"}
        groups.append(g)
        grid[key(lon, lat)].append(g)
    return groups, grid, near


def write_graph(coords, edges, groups, near, out: Path):
    # 노드마다 35m 안의 가장 가까운 신호 묶음. 지하도·육교로만 이어진 노드는 신호를 지나지 않는다.
    surface = set()
    for a, b, _, _, cls in edges:
        if cls != 4:
            surface.add(a)
            surface.add(b)
    sig_of = {}
    for i, (lon, lat) in enumerate(coords):
        if i not in surface:
            continue
        best = None
        for g in near(lon, lat, 35):
            d = dist_m((lon, lat), (g["lon"], g["lat"]))
            if best is None or d < best[0]:
                best = (d, g["id"])
        if best:
            sig_of[i] = best[1]
    chunks = defaultdict(lambda: {"n": [], "e": []})
    for i, (lon, lat) in enumerate(coords):
        c = chunks[cell_of(lon, lat)]
        row = [i, qx(lon), qy(lat)]
        if i in sig_of:
            row.append(sig_of[i])
        c["n"].append(row)
    for a, b, length, mid, cls in edges:
        # 간선은 양 끝 노드가 속한 칸 모두에 넣는다 (칸 경계를 넘는 길)
        ca, cb = cell_of(*coords[a]), cell_of(*coords[b])
        x0, y0 = qx(coords[a][0]), qy(coords[a][1])
        geom = []
        for lon, lat in mid:
            x, y = qx(lon), qy(lat)
            geom += [x - x0, y - y0]
            x0, y0 = x, y
        row = [a, b, round(length, 1), cls] + ([geom] if geom else [])
        chunks[ca]["e"].append(row)
        if cb != ca:
            chunks[cb]["e"].append(row)
    (out / "graph").mkdir(parents=True, exist_ok=True)
    index = {}
    for (cx, cy), c in chunks.items():
        name = f"c{cx}_{cy}.json"
        (out / "graph" / name).write_text(json.dumps(c, separators=(",", ":")), encoding="utf-8")
        index[f"{cx}_{cy}"] = len(c["n"])
    meta = {"lon0": LON0, "lat0": LAT0, "cell_lon": CELL_LON, "cell_lat": CELL_LAT, "q": Q, "cells": index}
    (out / "graph" / "index.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    return len(chunks), sum(len(c["n"]) for c in chunks.values()), len(edges)


def write_signals(groups, collected, out: Path):
    rows = []
    for g in groups:
        rows.append([g["id"], qx(g["lon"]), qy(g["lat"]), g["name"], 1 if g["src"] == "cits" else 0,
                     1 if any(i in collected for i in g["ids"]) else 0])
    (out / "signals.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(rows)


def write_search(places, out: Path):
    best = {}
    for name, lon, lat, kind, rank in places:
        if not in_bbox(lon, lat):
            continue
        if kind == "역" and not name.endswith("역"):
            name += "역"
        k = (name, kind)
        # 같은 이름·종류가 여러 개면(역 출입구 등) 처음 것 하나만
        if k in best and kind != "카페":
            continue
        if k in best:
            # 체인점은 위치가 다르면 따로 둔다
            if any(dist_m((lon, lat), (p[1], p[2])) < 200 for p in best[k]):
                continue
            best[k].append((name, lon, lat, kind, rank))
        else:
            best[k] = [(name, lon, lat, kind, rank)]
    rows = sorted((p for v in best.values() for p in v), key=lambda p: (p[4], len(p[0])))
    data = [[p[0], qx(p[1]), qy(p[2]), p[3]] for p in rows]
    (out / "search.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(data)


def write_tiles(mbtiles: Path, out: Path):
    """타일을 묶음 파일로 모은다. z0–10은 하나, z11은 z9 부모별, z12는 z10 부모별, z13–14는 z12 부모별."""
    db = sqlite3.connect(mbtiles)
    groups = defaultdict(list)
    for z, x, tms_y, data in db.execute("select zoom_level, tile_column, tile_row, tile_data from tiles"):
        y = (1 << z) - 1 - tms_y
        if z <= 10:
            g = "lo"
        elif z == 11:
            g = f"z9_{x >> 2}_{y >> 2}"
        elif z == 12:
            g = f"z10_{x >> 2}_{y >> 2}"
        else:
            s = z - 12
            g = f"z12_{x >> s}_{y >> s}"
        groups[g].append((z, x, y, data))
    (out / "tiles").mkdir(parents=True, exist_ok=True)
    index = {"bundles": [], "tiles": {}}
    for bi, (g, tiles) in enumerate(sorted(groups.items())):
        buf = bytearray()
        for z, x, y, data in tiles:
            index["tiles"][f"{z}/{x}/{y}"] = [bi, len(buf), len(data)]
            buf += data
        name = f"b{bi}.bin"
        (out / "tiles" / name).write_bytes(bytes(buf))
        index["bundles"].append(name)
    (out / "tiles" / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    return len(groups), len(index["tiles"])


def main():
    pbf, mbtiles, crossings_csv, out = sys.argv[1:5]
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    print("tiles", write_tiles(Path(mbtiles), out))
    h = Ways()
    h.apply_file(pbf, locations=True)
    coords, edges = build_graph(h)
    crossings = load_crossings(crossings_csv)
    groups, _, near = signal_groups(crossings, h.signals)
    import tomllib
    cfg = tomllib.loads((Path(__file__).resolve().parents[1] / "config" / "collector.toml").read_text(encoding="utf-8"))
    collected = set(cfg["targets"]["itst_ids"])
    print("signals", write_signals(groups, collected, out), "osm signal nodes", len(h.signals))
    print("graph chunks/nodes/edges", write_graph(coords, edges, groups, near, out))
    print("search", write_search(h.places, out))
    if len(sys.argv) > 5:
        (out / "glyphs").mkdir(exist_ok=True)
        for r in ("0-255", "256-511", "8192-8447"):
            (out / "glyphs" / f"{r}.pbf").write_bytes(gzip.decompress((Path(sys.argv[5]) / f"{r}.pbf.gz").read_bytes()))


if __name__ == "__main__":
    main()
