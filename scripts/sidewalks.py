"""큰길 보도와 횡단보도를 만든다.

OSM 서울 데이터는 큰길을 도로 중심선으로만 그린 곳이 많다(보도를 따로 그린 곳은 일부).
중심선을 그대로 걸으면 "이쪽 보도로 갈지, 건너서 저쪽 보도로 갈지"를 구분할 수 없고,
아무 데서나 큰길을 건너는 길이 나온다. 그래서 큰길은 이렇게 바꾼다.

- 큰길(trunk·primary·secondary, 차로 4개 이상 tertiary) 중심선은 걷지 않는다.
- 대신 양쪽에 보도 선을 만든다. 일방통행 차로(왕복 도로를 두 줄로 그린 경우)는 바깥쪽 보도만 만들고
  안쪽(중앙분리대)은 건너는 중간 지점으로만 둔다.
- 교차로에서는 이웃한 길의 보도끼리 모퉁이로 잇는다(건너지 않음).
- 큰길을 건너는 선(횡단보도)은 신호 교차로(C-ITS·OSM 신호 35m 안)나 OSM 횡단보도 표시가 있는 곳에만 만든다.
  신호는 노드가 아니라 이 횡단보도 선에 붙고, 건너는 다리(방향 n/e/s/w)도 함께 남긴다.
- 골목·보행로는 지금처럼 선 그대로 걷고, 큰길 교차로에 닿는 끝만 큰길 폭만큼 물린다.

좌표는 (경도, 위도). 계산은 서울 위도의 평면 미터 근사로 한다.
"""
from __future__ import annotations

import math
from collections import defaultdict

KX = 111320 * math.cos(math.radians(37.55))
KY = 110540.0

WIDE = {"trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"}
LANE_M = 3.2


def to_m(ll):
    return (ll[0] * KX, ll[1] * KY)


def to_ll(p):
    return (p[0] / KX, p[1] / KY)


def is_wide(info) -> bool:
    if info is None or info.get("cls") == 4:
        return False
    hw = info.get("hw")
    if hw in WIDE:
        return True
    return hw in ("tertiary", "tertiary_link") and _lanes(info) is not None and _lanes(info) >= 4


def _lanes(info):
    v = str(info.get("lanes") or "").split(";")[0]
    return int(v) if v.isdigit() else None


def offsets(info):
    """(오른쪽 보도까지 거리, 왼쪽 보도까지 거리, 왼쪽 보도 선이 있는가). 왼쪽·오른쪽은 길 방향 기준."""
    n = _lanes(info)
    base = (info.get("hw") or "").replace("_link", "")
    link = (info.get("hw") or "").endswith("_link")
    if info.get("oneway"):
        n = n or (1 if link else 3 if base in ("trunk", "primary") else 2)
        half = n * LANE_M / 2
        return half + 1.5, half + 0.5, False
    n = n or (2 if link else {"trunk": 6, "primary": 6, "secondary": 4}.get(base, 2))
    half = n * LANE_M / 2
    return half + 1.5, half + 1.5, True


def polylen(pts):
    return sum(math.dist(p, q) for p, q in zip(pts, pts[1:]))


def offset_line(pts, d):
    """d>0이면 진행 방향 왼쪽으로 d미터 평행이동한 선."""
    out = []
    n = len(pts)
    for i in range(n):
        normals = []
        for j in (i - 1, i):
            if 0 <= j < n - 1:
                (x0, y0), (x1, y1) = pts[j], pts[j + 1]
                L = math.hypot(x1 - x0, y1 - y0) or 1e-9
                normals.append((-(y1 - y0) / L, (x1 - x0) / L))
        nx = sum(v[0] for v in normals)
        ny = sum(v[1] for v in normals)
        L = math.hypot(nx, ny) or 1e-9
        nx, ny = nx / L, ny / L
        # 꺾이는 곳에서 폭이 줄지 않게 늘리되 두 배까지만
        scale = 1.0
        if len(normals) == 2:
            c = normals[0][0] * nx + normals[0][1] * ny
            scale = min(2.0, 1 / max(c, 0.5))
        out.append((pts[i][0] + nx * d * scale, pts[i][1] + ny * d * scale))
    return out


def point_along(pts, s):
    for p, q in zip(pts, pts[1:]):
        L = math.dist(p, q)
        if s <= L:
            t = s / L if L else 0
            return (p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))
        s -= L
    return pts[-1]


def cut(pts, s0, s1):
    """앞에서 s0, 뒤에서 s1미터를 잘라낸 선. 남는 게 없으면 가운데 한 점."""
    L = polylen(pts)
    if L <= s0 + s1 + 0.5:
        m = point_along(pts, (L * s0 / (s0 + s1)) if s0 + s1 > 0 else L / 2)
        return [m]
    out = [point_along(pts, s0)]
    acc = 0.0
    for p, q in zip(pts, pts[1:]):
        acc += math.dist(p, q)
        if s0 < acc < L - s1:
            out.append(q)
    out.append(point_along(pts, L - s1))
    return out


def bearing_leaving(pts):
    """첫 점에서 나가는 방향 각도(라디안, 동쪽 0, 반시계)."""
    for q in pts[1:]:
        if math.dist(pts[0], q) > 0.5:
            return math.atan2(q[1] - pts[0][1], q[0] - pts[0][0])
    return math.atan2(pts[-1][1] - pts[0][1], pts[-1][0] - pts[0][0])


def compass(angle):
    deg = (90 - math.degrees(angle)) % 360  # 북 0, 시계 방향
    return "nesw"[int(((deg + 45) % 360) // 90)]


def build(nodes, edges, node_sig, node_cross, median_radius=45.0):
    """
    nodes: [(lon, lat)] 기본 그래프 노드
    edges: [{"a", "b", "pts": [(lon,lat)...] 양 끝 포함, "cls", "info": {"hw","oneway","lanes","name","wid","cls"} 또는 None}]
    node_sig(v) -> 신호 묶음 id 또는 None (35m 안)
    node_cross: {v: "sig" | "mark"} OSM 횡단보도 표시
    돌려주는 값: (새 노드 [(lon, lat, s)], 새 간선 [(a, b, 길이, cls, [중간 좌표 lon,lat], sig, dir, half)])
      s: 큰길이 없는 교차로에서 지나기만 해도 세는 신호(예전 방식), sig: 이 횡단보도 선의 신호
    """
    P = [to_m(ll) for ll in nodes]
    E = []
    for e in edges:
        pts = [to_m(ll) for ll in e["pts"]]
        if len(pts) < 2 or polylen(pts) < 0.3:
            continue
        E.append({**e, "m": pts, "wide": is_wide(e.get("info"))})
    inc = defaultdict(list)  # v -> [(edge index, 'a'|'b')]
    for i, e in enumerate(E):
        inc[e["a"]].append((i, "a"))
        inc[e["b"]].append((i, "b"))
    wide_at = {v for v, items in inc.items() if any(E[i]["wide"] for i, _ in items)}
    for e in E:
        if e["wide"]:
            e["ro"], e["lo"], e["two"] = offsets(e["info"])

    new_nodes = []
    plain = {}

    def node(p, s=None):
        new_nodes.append((*to_ll(p), s))
        return len(new_nodes) - 1

    def plain_node(v):
        if v not in plain:
            plain[v] = node(P[v], node_sig(v))
        return plain[v]

    def setback(i, v):
        if v not in wide_at:
            return 0.0
        others = [E[j]["ro"] for j, _ in inc[v] if j != i and E[j]["wide"]]
        if E[i]["wide"]:
            return max(others) if others else 0.5
        return max(E[j]["ro"] for j, _ in inc[v] if E[j]["wide"]) + 1.0

    out_edges = []

    def link(a, b, cls, pts=None, sig=None, d=None, half=0):
        if a == b:
            return
        A = to_m(new_nodes[a][:2])
        B = to_m(new_nodes[b][:2])
        mid = pts[1:-1] if pts else []
        L = polylen([A, *mid, B])
        out_edges.append((a, b, round(L, 1), cls, [to_ll(p) for p in mid], sig, d, half))

    ep = {}  # (edge, v, side) -> new node, side는 v에서 나가는 방향 기준 L/R
    for i, e in enumerate(E):
        a, b, pts = e["a"], e["b"], e["m"]
        sa, sb = setback(i, a), setback(i, b)
        if not e["wide"]:
            line = cut(pts, sa, sb) if (sa or sb) else pts
            A = plain_node(a) if a not in wide_at else node(line[0])
            if len(line) == 1:
                B = A
            else:
                B = plain_node(b) if b not in wide_at else node(line[-1])
                link(A, B, e["cls"], line)
            for side in "LR":
                ep[(i, a, side)] = A
                ep[(i, b, side)] = B
            continue
        r = cut(offset_line(pts, -e["ro"]), sa, sb)
        lft = cut(offset_line(pts, e["lo"]), sa, sb)
        R0 = node(r[0])
        R1 = R0 if len(r) == 1 else node(r[-1])
        L0 = node(lft[0])
        L1 = L0 if len(lft) == 1 else node(lft[-1])
        link(R0, R1, 0, r)
        if e["two"]:
            link(L0, L1, 0, lft)
        ep[(i, a, "R")], ep[(i, a, "L")] = R0, L0
        ep[(i, b, "L")], ep[(i, b, "R")] = R1, L1  # b에서 나가면 좌우가 바뀐다

    medians = []
    for v in wide_at:
        items = []
        for i, end in inc[v]:
            pts = E[i]["m"] if end == "a" else E[i]["m"][::-1]
            items.append((bearing_leaving(pts), i))
        items.sort()
        k = len(items)
        # 모퉁이: 반시계로 이웃한 두 길의 보도를 잇는다(건너지 않음)
        if k == 1:
            link(ep[(items[0][1], v, "L")], ep[(items[0][1], v, "R")], 0)
        else:
            for n in range(k):
                i, j = items[n][1], items[(n + 1) % k][1]
                if k == 2 and n == 1 and i == j:
                    break
                link(ep[(i, v, "L")], ep[(j, v, "R")], 0)
        # 횡단보도: 신호 교차로이거나 OSM 횡단보도 표시가 있는 곳의 큰길 다리만
        sig = node_sig(v)
        kind = node_cross.get(v)
        if not (sig or kind):
            continue
        wide_items = [(ang, i) for ang, i in items if E[i]["wide"]]
        if k == 2 and len(wide_items) == 2:
            wide_items = wide_items[:1]  # 길 중간 횡단보도: 한 번만
        for ang, i in wide_items:
            a_, b_ = ep[(i, v, "L")], ep[(i, v, "R")]
            half = 0 if E[i]["two"] else 1
            link(a_, b_, 5, None, sig if (sig or kind == "sig") else None, compass(ang), half)
            if not E[i]["two"]:
                # 일방통행 차로의 안쪽 끝(중앙분리대). 왼쪽은 나가는 방향 기준이라 a/b에 따라 다르다
                end_is_a = E[i]["a"] == v
                med = a_ if end_is_a else b_
                medians.append((med, E[i]["info"].get("name"), E[i]["info"].get("wid")))
    # 중앙분리대 잇기: 같은 이름의 반대편 차로 안쪽 끝이 가까우면 잇는다(두 번에 나눠 건너는 넓은 길)
    grid = defaultdict(list)
    for m in medians:
        x, y = to_m(new_nodes[m[0]][:2])
        grid[(int(x // 50), int(y // 50))].append(m)
    seen = set()
    for m, name, wid in medians:
        x, y = to_m(new_nodes[m][:2])
        best = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for m2, name2, wid2 in grid[(int(x // 50) + dx, int(y // 50) + dy)]:
                    if wid2 == wid or name2 != name:
                        continue
                    d = math.dist((x, y), to_m(new_nodes[m2][:2]))
                    if d < median_radius and (best is None or d < best[0]):
                        best = (d, m2)
        if best and (min(m, best[1]), max(m, best[1])) not in seen:
            seen.add((min(m, best[1]), max(m, best[1])))
            link(m, best[1], 5)
    return new_nodes, out_edges
