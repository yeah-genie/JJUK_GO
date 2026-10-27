import heapq
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import sidewalks  # noqa: E402

C = (127.0, 37.5)


def ll(dx, dy):
    return (C[0] + dx / sidewalks.KX, C[1] + dy / sidewalks.KY)


# 가운데(0) + 동(1)·서(2)는 왕복 6차로 큰길, 북(3)·남(4)은 골목
NODES = [ll(0, 0), ll(150, 0), ll(-150, 0), ll(0, 120), ll(0, -120)]
BIG = {"hw": "primary", "oneway": False, "lanes": "6", "name": "큰길", "wid": 1, "cls": 0}
SMALL = {"hw": "residential", "oneway": False, "lanes": None, "name": "골목", "wid": 2, "cls": 1}
EDGES = [
    {"a": 0, "b": 1, "pts": [NODES[0], NODES[1]], "cls": 0, "info": BIG},
    {"a": 0, "b": 2, "pts": [NODES[0], NODES[2]], "cls": 0, "info": BIG},
    {"a": 0, "b": 3, "pts": [NODES[0], NODES[3]], "cls": 1, "info": SMALL},
    {"a": 0, "b": 4, "pts": [NODES[0], NODES[4]], "cls": 1, "info": SMALL},
]


def nearest(nodes, p):
    return min(range(len(nodes)), key=lambda i: (nodes[i][0] - p[0]) ** 2 + (nodes[i][1] - p[1]) ** 2)


def route(nodes, edges, a, b):
    adj = {}
    for e in edges:
        adj.setdefault(e[0], []).append((e[1], e))
        adj.setdefault(e[1], []).append((e[0], e))
    dist, prev, h = {a: 0}, {}, [(0, a)]
    while h:
        d, u = heapq.heappop(h)
        if u == b:
            break
        if d > dist[u]:
            continue
        for v, e in adj.get(u, []):
            if d + e[2] < dist.get(v, 1e18):
                dist[v], prev[v] = d + e[2], (u, e)
                heapq.heappush(h, (d + e[2], v))
    if b not in dist:
        return None
    path, v = [], b
    while v != a:
        u, e = prev[v]
        path.append(e)
        v = u
    return path


def test_cannot_cross_big_road_without_crosswalk():
    nodes, edges = sidewalks.build(NODES, EDGES, lambda v: None, {})
    n, s = nearest(nodes, NODES[3]), nearest(nodes, NODES[4])
    # 건널 곳이 없으니 큰길이 끝나는 곳(150m 밖)까지 돌아가야만 한다
    path = route(nodes, edges, n, s)
    assert all(e[3] != 5 for e in path) and sum(e[2] for e in path) > 2 * 150
    # 같은 쪽 보도는 교차로를 지나도 이어진다(건너지 않음)
    ne, nw = nearest(nodes, ll(150, 12)), nearest(nodes, ll(-150, 12))
    path = route(nodes, edges, ne, nw)
    assert path and all(e[3] != 5 for e in path)


def test_signal_crossing_counts_once_with_leg_direction():
    nodes, edges = sidewalks.build(NODES, EDGES, lambda v: "2217" if v == 0 else None, {})
    n, s = nearest(nodes, NODES[3]), nearest(nodes, NODES[4])
    path = route(nodes, edges, n, s)
    crossings = [e for e in path if e[3] == 5]
    assert len(crossings) == 1 and crossings[0][5] == "2217" and crossings[0][6] in "ew"
    # 보도는 큰길 중심에서 약 11m(6차로 절반 9.6m + 1.5m) 떨어져 있다
    sw = [e for e in edges if e[3] == 0]
    assert sw and all(abs(nodes[e[0]][1] - C[1]) * sidewalks.KY > 9 for e in sw)


def test_marked_crosswalk_without_signal():
    nodes, edges = sidewalks.build(NODES, EDGES, lambda v: None, {0: "mark"})
    path = route(nodes, edges, nearest(nodes, NODES[3]), nearest(nodes, NODES[4]))
    assert path and [e[5] for e in path if e[3] == 5] == [None]


def test_dual_carriageway_crossing_uses_median():
    # 왕복 도로를 일방통행 두 줄(북쪽 서행, 남쪽 동행)로 그린 경우. 길 중간 신호 횡단보도로 건넌다
    n = [ll(-100, 12), ll(0, 12), ll(100, 12), ll(-100, -12), ll(0, -12), ll(100, -12), ll(0, 80), ll(0, -80)]
    wb = {"hw": "primary", "oneway": True, "lanes": "3", "name": "테헤란로", "wid": 10, "cls": 0}
    eb = {**wb, "wid": 11}
    es = [
        {"a": 2, "b": 1, "pts": [n[2], n[1]], "cls": 0, "info": wb}, {"a": 1, "b": 0, "pts": [n[1], n[0]], "cls": 0, "info": wb},
        {"a": 3, "b": 4, "pts": [n[3], n[4]], "cls": 0, "info": eb}, {"a": 4, "b": 5, "pts": [n[4], n[5]], "cls": 0, "info": eb},
        {"a": 1, "b": 6, "pts": [n[1], n[6]], "cls": 1, "info": SMALL}, {"a": 4, "b": 7, "pts": [n[4], n[7]], "cls": 1, "info": SMALL},
    ]
    nodes, edges = sidewalks.build(n, es, lambda v: "2219" if v in (1, 4) else None, {})
    path = route(nodes, edges, nearest(nodes, n[6]), nearest(nodes, n[7]))
    sigs = [e[5] for e in path if e[5]]
    assert sigs == ["2219", "2219"]  # 두 차로를 같은 신호로 건넌다 (앱에서는 60m 안 같은 신호를 한 번으로 센다)
    assert all(e[7] == 1 for e in path if e[5])  # 일방통행 차로 하나 = 절반 건너기
