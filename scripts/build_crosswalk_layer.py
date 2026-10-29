#!/usr/bin/env python3
"""서울시 횡단보도 위치정보(OA-21209)에서 앱 지도용 횡단보도 선 파일을 만든다.

입력: data 브랜치의 crosswalk/oa21209_rows.csv.gz (git show origin/data:crosswalk/oa21209_rows.csv.gz)
출력: docs/prototype/seoul/crosswalks.json  {"lon0","lat0","q","rows":[[x,y,dx,dy,길이(데시미터)],...]}
좌표는 다른 서울 데이터와 같은 방식(기준점 126.58/37.35에서 1e5 배)으로 정수화한다.
길이는 자료의 LNKG_LEN(미터로 확인: 선 좌표 길이와 비율 중앙값 1.002).
"""
import csv, gzip, json, re, sys
from pathlib import Path

LON0, LAT0, Q = 126.58, 37.35, 100000
src = Path(sys.argv[1]); out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("docs/prototype/seoul/crosswalks.json")
rows = []
for r in csv.DictReader(gzip.open(src, "rt", encoding="utf-8-sig")):
    w = r.get("LNKG_WKT") or ""
    if not w.startswith("LINESTRING"):
        continue
    pts = [tuple(map(float, p.split())) for p in re.findall(r"\(([^)]*)\)", w)[0].split(",")]
    try:
        length = float(r["LNKG_LEN"])
    except (TypeError, ValueError):
        continue
    if not 2 <= length <= 120:
        continue
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    qx0, qy0 = round((x0 - LON0) * Q), round((y0 - LAT0) * Q)
    rows.append([qx0, qy0, round((x1 - LON0) * Q) - qx0, round((y1 - LAT0) * Q) - qy0, round(length * 10)])
out.write_text(json.dumps({"lon0": LON0, "lat0": LAT0, "q": Q, "rows": rows}, separators=(",", ":")), encoding="utf-8")
print(len(rows), "개,", out.stat().st_size // 1024, "KB")
