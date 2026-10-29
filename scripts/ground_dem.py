"""build_ground_dem_oa22241.py가 만든 10m 지면고도 격자를 WGS84 경위도로 조회하는 도우미.

경사 원시값(점수 아님)
  elevation_gain_m   : 오르는 높이 합
  max_slope_pct      : 가장 가파른 구간 경사(%)
  slope_5pct_plus_m  : 경사 5% 이상 구간 길이
  slope_8pct_plus_m  : 경사 8% 이상 구간 길이
  steep_distance_m   : slope_8pct_plus_m와 같음(급경사 기준 8%)
구간은 STEP(m) 간격으로 다시 찍어 계산한다. 10m 격자이므로 STEP은 20m 이상을 권한다.
"""
import json, math
import numpy as np
from pyproj import Transformer

STEP = 20.0
KX = 111320 * math.cos(math.radians(37.5)); KY = 110540


class GroundDEM:
    """base를 여러 개 주면 앞의 격자에 값이 없을 때 다음 격자를 쓴다(예: 2025 서울 등고선 → 2023 경사도 묶음)."""
    def __init__(self, base, *more):
        self.G = np.load(base + ".npy"); self.m = json.load(open(base + ".json"))
        self.T = Transformer.from_crs(4326, 5174, always_xy=True)
        self.next = GroundDEM(*more) if more else None

    def height(self, lon, lat):
        h = self._height(lon, lat)
        return h if h is not None or self.next is None else self.next.height(lon, lat)

    def _height(self, lon, lat):
        x, y = self.T.transform(lon, lat)
        c = (x - self.m["x0"]) / self.m["cell"]; r = (self.m["y0"] - y) / self.m["cell"]
        i, j = int(math.floor(r)), int(math.floor(c))
        if i < 0 or j < 0 or i + 1 >= self.G.shape[0] or j + 1 >= self.G.shape[1]:
            return None
        fr, fc = r - i, c - j
        v = self.G[i:i + 2, j:j + 2]
        if np.isnan(v).any():
            return None
        return float(v[0, 0] * (1 - fr) * (1 - fc) + v[0, 1] * (1 - fr) * fc + v[1, 0] * fr * (1 - fc) + v[1, 1] * fr * fc)


def dist(p, q):
    return math.hypot((p[0] - q[0]) * KX, (p[1] - q[1]) * KY)


def resample(pts, step=STEP):
    out = [pts[0]]; acc = 0.0
    for a, b in zip(pts, pts[1:]):
        L = dist(a, b)
        if L == 0:
            continue
        pos = step - acc
        while pos < L:
            t = pos / L; out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)); pos += step
        acc = L - (pos - step)
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return out


def slope_stats(dem, pts, step=STEP):
    rs = resample(pts, step); hs = [dem.height(*p) for p in rs]
    gain = s5 = s8 = 0.0; mx = 0.0; known = 0.0; total = 0.0
    for (a, ha), (b, hb) in zip(zip(rs, hs), zip(rs[1:], hs[1:])):
        L = dist(a, b); total += L
        if ha is None or hb is None or L < 1:
            continue
        known += L; d = hb - ha; g = abs(d) / L * 100
        if d > 0:
            gain += d
        if g >= 5:
            s5 += L
        if g >= 8:
            s8 += L
        mx = max(mx, g)
    return {"elevation_gain_m": gain, "max_slope_pct": mx, "slope_5pct_plus_m": s5, "slope_8pct_plus_m": s8,
            "steep_distance_m": s8, "known_m": known, "total_m": total, "heights": hs}
