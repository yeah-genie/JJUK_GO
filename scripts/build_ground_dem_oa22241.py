#!/usr/bin/env python3
"""서울시 경사도 자료(OA-22241, 1:5000 수치지형도 등고선·표고점 SHP)로 10m 격자 지면고도를 만든다.

입력: '서울시 등고선.zip'을 푼 폴더(등고선 5000/N3L_F001, 표고 5000/N3P_F002)
좌표계: Korean 1985 / Modified Central Belt(EPSG:5174, Bessel). 조회 시 WGS84 경위도를 이 좌표로 바꿔 찾는다(pyproj, Korean 1985→WGS84 변환, 정확도 약 1m).
방법: 등고선 꼭짓점(10m 간격으로 솎음, 높이=CONT) + 표고점(높이=NUME)으로 삼각망(TIN)을 만들고 선형 보간해 10m 격자에 저장.
  - 등고선 사이 평지는 같은 높이 등고선끼리 삼각형이 생겨 평평하게 나올 수 있다(경사를 작게 보는 쪽).
출력: <out>.npy(float32, 행=북→남) + <out>.json(격자 정보). 저장소에는 넣지 않는다(용량).
필요: pip install pyshp pyproj scipy numpy
사용: python3 scripts/build_ground_dem_oa22241.py <등고선 압축 푼 폴더> <출력 경로(확장자 없이)>
"""
import json, math, sys, time
import numpy as np
import shapefile
from scipy.interpolate import LinearNDInterpolator

src, out = sys.argv[1], sys.argv[2]
CELL = 10.0
THIN = 10.0
t0 = time.time()
xs, ys, zs = [], [], []
r = shapefile.Reader(f"{src}/등고선 5000/N3L_F001", encoding="cp949")
ci = [f[0] for f in r.fields[1:]].index("CONT")
n_raw = 0
for sr in r.iterShapeRecords():
    z = float(sr.record[ci]); pts = sr.shape.points; n_raw += len(pts)
    lx = ly = None
    for k, (x, y) in enumerate(pts):
        if lx is None or math.hypot(x - lx, y - ly) >= THIN or k == len(pts) - 1:
            xs.append(x); ys.append(y); zs.append(z); lx, ly = x, y
n_c = len(xs)
r = shapefile.Reader(f"{src}/표고 5000/N3P_F002", encoding="cp949")
ni = [f[0] for f in r.fields[1:]].index("NUME")
for sr in r.iterShapeRecords():
    x, y = sr.shape.points[0]; xs.append(x); ys.append(y); zs.append(float(sr.record[ni]))
print(f"등고선 꼭짓점 {n_raw} → 솎음 {n_c}, 표고점 {len(xs) - n_c}, {time.time() - t0:.0f}s", flush=True)
P = np.column_stack([xs, ys]); Z = np.array(zs, dtype=np.float64)
f = LinearNDInterpolator(P, Z)
print(f"삼각망 {time.time() - t0:.0f}s", flush=True)
x0, x1 = math.floor(P[:, 0].min() / CELL) * CELL, math.ceil(P[:, 0].max() / CELL) * CELL
y0, y1 = math.floor(P[:, 1].min() / CELL) * CELL, math.ceil(P[:, 1].max() / CELL) * CELL
gx = np.arange(x0, x1 + CELL, CELL); gy = np.arange(y1, y0 - CELL, -CELL)
G = np.empty((len(gy), len(gx)), dtype=np.float32)
for i in range(0, len(gy), 200):
    yy = gy[i:i + 200]
    X, Y = np.meshgrid(gx, yy)
    G[i:i + 200] = f(X, Y).astype(np.float32)
print(f"격자 {G.shape} {time.time() - t0:.0f}s, 빈칸 {int(np.isnan(G).sum())}", flush=True)
np.save(out + ".npy", G)
json.dump({"crs": "EPSG:5174", "x0": float(gx[0]), "y0": float(gy[0]), "cell": CELL, "shape": list(G.shape),
           "source": "서울 열린데이터광장 OA-22241 서울시 등고선.zip(1:5000 수치지형도 등고선 5m·표고점)"}, open(out + ".json", "w"), ensure_ascii=False)
print("저장", out)
