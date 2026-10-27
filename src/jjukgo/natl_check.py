"""전국 통합 교통안전 신호등 실시간 정보 API(행정안전부 한국지역정보개발원) 점검.

공공데이터포털 명세(2026-03 등록):
  GET https://apis.data.go.kr/B551982/rti/crsrd_map_info  교차로 목록(ID·이름·위경도)
  GET https://apis.data.go.kr/B551982/rti/tl_drct_info    방향별 신호 상태·잔여시간
  공통 파라미터: serviceKey(필수), pageNo, numOfRows, type(json), stdgCd(지자체 코드, 서울 1100000000)

알아낼 것 (호출 10회 안팎):
  1. 서울 교차로 수와 위경도, 강남 테헤란로 일대에 몇 곳이 있는지, 지금 수집 중인 교차로 ID가 같은 체계인지
  2. 신호 정보가 한 번 호출에 여러 교차로를 주는지, 얼마나 최신인지(totDt), 보행신호 값이 채워져 있는지
  3. 연달아 부르면 막히는지(호출 간격 제한), 같은 호출을 다시 하면 값이 바뀌는지

  python -m jjukgo.natl_check --data-dir datastore   (DATA_GO_KR_KEY 필요)
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from . import KST

BASE = "https://apis.data.go.kr/B551982/rti"
SEOUL = "1100000000"
BBOX = [127.020, 37.493, 127.055, 37.512]  # 강남역–역삼–선릉
WATCHED = ["2691", "1619", "1537"]  # T Data에서 수집 중인 교차로 ID
DIRS = ["nt", "ne", "et", "se", "st", "sw", "wt", "nw"]


def find_items(payload) -> list[dict]:
    """응답 어디에 있든 item 목록을 꺼낸다 (response.body.items.item, body.items 등)."""
    if isinstance(payload, list):
        if payload and all(isinstance(x, dict) for x in payload):
            return payload
        return []
    if not isinstance(payload, dict):
        return []
    for key in ("item", "items"):
        if key in payload:
            v = payload[key]
            if isinstance(v, dict) and "item" in v:
                v = v["item"]
            if isinstance(v, dict):
                return [v]
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
    for v in payload.values():
        found = find_items(v)
        if found:
            return found
    return []


def find_value(payload, key):
    if isinstance(payload, dict):
        if key in payload:
            return payload[key]
        for v in payload.values():
            found = find_value(v, key)
            if found is not None:
                return found
    return None


def call(op: str, key: str, **params) -> dict:
    """한 번 호출하고 결과를 기록용 dict로 돌려준다(예외를 던지지 않음)."""
    q = {"serviceKey": key, "type": "json", **params}
    url = f"{BASE}/{op}?{urllib.parse.urlencode(q)}"
    t0 = time.monotonic()
    out: dict = {"op": op, "params": {k: v for k, v in params.items()}}
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            out["http"] = resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        out["http"] = e.code
    except Exception as e:  # 네트워크 오류
        out.update(error=str(e)[:200], elapsed_s=round(time.monotonic() - t0, 2))
        return out
    out["elapsed_s"] = round(time.monotonic() - t0, 2)
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        out["non_json"] = body[:400]  # 게이트웨이 오류는 XML로 오는 경우가 많다
        return out
    out["result_code"] = find_value(payload, "resultCode")
    out["result_msg"] = find_value(payload, "resultMsg")
    out["total_count"] = find_value(payload, "totalCount")
    out["items"] = find_items(payload)
    return out


def summarize_signals(items: list[dict], now: datetime) -> dict:
    ids = {str(i.get("crsrdId")) for i in items}
    ped_filled = sum(1 for i in items for d in DIRS if i.get(f"{d}PdsgRmndCs") not in (None, ""))
    ped_states = {}
    for i in items:
        for d in DIRS:
            s = i.get(f"{d}PdsgSttsNm")
            if s:
                ped_states[s] = ped_states.get(s, 0) + 1
    ages = []
    for i in items:
        try:
            t = datetime.strptime(str(i.get("totDt"))[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=KST)
            ages.append((now - t).total_seconds())
        except ValueError:
            pass
    ages.sort()
    return {
        "rows": len(items), "distinct_intersections": len(ids),
        "ped_values_filled": ped_filled, "ped_states": ped_states,
        "age_s_min": round(ages[0], 1) if ages else None,
        "age_s_median": round(ages[len(ages) // 2], 1) if ages else None,
        "age_s_max": round(ages[-1], 1) if ages else None,
        "watched_present": [w for w in WATCHED if w in ids],
        "sample": items[0] if items else None,
    }


def run(key: str, data_dir: Path) -> dict:
    now = lambda: datetime.now(timezone.utc)
    report: dict = {"checked_at_utc": now().isoformat(), "steps": []}

    # 키 형식 확인: 포털 키는 이미 인코딩된 것(Encoding)과 아닌 것(Decoding) 두 가지라 둘 다 시도한다
    keys = list(dict.fromkeys([key, urllib.parse.unquote(key)]))
    first = None
    for k in keys:
        first = call("crsrd_map_info", k, stdgCd=SEOUL, pageNo=1, numOfRows=1000)
        report["steps"].append({**{x: y for x, y in first.items() if x != "items"}, "rows": len(first.get("items", []))})
        if first.get("items"):
            key = k
            report["key_variant"] = "as_given" if k == keys[0] else "url_decoded"
            break
    if not first or not first.get("items"):
        report["conclusion"] = "교차로 목록 호출 실패 — steps의 오류를 확인"
        return report

    # 1) 서울 교차로 목록 전체
    crossings = list(first["items"])
    total = int(first.get("total_count") or len(crossings))
    page = 2
    while len(crossings) < total and page <= 6:
        r = call("crsrd_map_info", key, stdgCd=SEOUL, pageNo=page, numOfRows=1000)
        report["steps"].append({**{x: y for x, y in r.items() if x != "items"}, "rows": len(r.get("items", []))})
        if not r.get("items"):
            break
        crossings += r["items"]
        page += 1
    rows = []
    for c in crossings:
        try:
            lat, lon = float(c.get("mapCtptIntLat")), float(c.get("mapCtptIntLot"))
        except (TypeError, ValueError):
            lat = lon = None
        rows.append({"crsrd_id": str(c.get("crsrdId")), "name": c.get("crsrdNm", ""), "lat": lat, "lon": lon,
                     "lane_width": c.get("laneWdth", ""), "speed_limit": c.get("lmtSpd", "")})
    in_bbox = [r for r in rows if r["lat"] and BBOX[1] <= r["lat"] <= BBOX[3] and BBOX[0] <= r["lon"] <= BBOX[2]]
    out_csv = Path(data_dir) / "static" / "seoul_crossings.csv"
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with open(out_csv, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    ids = {r["crsrd_id"] for r in rows}
    report["crossings"] = {
        "seoul_total": len(rows), "reported_total": total, "in_teheran_bbox": len(in_bbox),
        "teheran_examples": [f'{r["crsrd_id"]} {r["name"]}' for r in in_bbox[:15]],
        "watched_ids_found": {w: (w in ids) for w in WATCHED},
        "saved": str(out_csv),
    }

    # 2) 신호 정보: 한 번에 몇 곳? 얼마나 최신? 보행 값은 있나?
    sig1 = call("tl_drct_info", key, stdgCd=SEOUL, pageNo=1, numOfRows=1000)
    report["steps"].append({**{x: y for x, y in sig1.items() if x != "items"}, "rows": len(sig1.get("items", []))})
    report["signals_first_call"] = summarize_signals(sig1.get("items", []), now())

    # 2-1) 서울이 비어 있으면(K3 NODATA) 어느 지역 신호가 나오는지 확인
    if not sig1.get("items"):
        regions = {}
        r = call("tl_drct_info", key, pageNo=1, numOfRows=1000)
        report["steps"].append({**{x: y for x, y in r.items() if x != "items"}, "rows": len(r.get("items", []))})
        for i in r.get("items", []):
            name = f'{i.get("lclgvNm")} ({i.get("stdgCd")})'
            regions[name] = regions.get(name, 0) + 1
        report["signals_without_region"] = {
            "total_count": r.get("total_count"), "rows": len(r.get("items", [])), "regions_on_page1": regions,
            "summary": summarize_signals(r.get("items", []), now()) if r.get("items") else None,
        }
        for code, name in [("1168000000", "서울 강남구"), ("11", "서울(앞 2자리)"), ("2800000000", "인천"), ("3000000000", "대전")]:
            r = call("tl_drct_info", key, stdgCd=code, pageNo=1, numOfRows=100)
            report["steps"].append({**{x: y for x, y in r.items() if x != "items"}, "rows": len(r.get("items", [])), "label": name})
        if r.get("items") and not sig1.get("items"):
            sig1 = r

    # 3) 바로 다시 호출: 막히는지, 값이 바뀌는지
    params = sig1.get("params", {"stdgCd": SEOUL, "pageNo": 1, "numOfRows": 1000})
    sig2 = call("tl_drct_info", key, **params)
    report["steps"].append({**{x: y for x, y in sig2.items() if x != "items"}, "rows": len(sig2.get("items", []))})
    time.sleep(10)
    sig3 = call("tl_drct_info", key, **params)
    report["steps"].append({**{x: y for x, y in sig3.items() if x != "items"}, "rows": len(sig3.get("items", []))})

    def snap(r):
        return {str(i.get("crsrdId")): (i.get("totDt"), tuple(i.get(f"{d}PdsgRmndCs") for d in DIRS)) for i in r.get("items", [])}

    s1, s3 = snap(sig1), snap(sig3)
    common = set(s1) & set(s3)
    report["repeat_calls"] = {
        "immediate_rows": len(sig2.get("items", [])),
        "immediate_blocked": not sig2.get("items"),
        "after_10s_rows": len(sig3.get("items", [])),
        "changed_after_10s": sum(1 for k in common if s1[k] != s3[k]),
        "compared": len(common),
    }
    with open(Path(data_dir) / "meta" / "natl_signal_sample.json", "w", encoding="utf-8") as f:
        json.dump(sig1.get("items", [])[:20], f, ensure_ascii=False, indent=1)
    return report


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data-dir", type=Path, default=Path("datastore"))
    a = p.parse_args(argv)
    key = os.environ.get("DATA_GO_KR_KEY", "")
    if not key:
        print("::warning::DATA_GO_KR_KEY가 없어 점검을 건너뜁니다.")
        return 0
    (a.data_dir / "meta").mkdir(parents=True, exist_ok=True)
    report = run(key, a.data_dir)
    path = a.data_dir / "meta" / "natl_check.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    shown = {k: v for k, v in report.items() if k != "signals_first_call"}
    shown["signals_first_call"] = {k: v for k, v in report.get("signals_first_call", {}).items() if k != "sample"}
    print(json.dumps(shown, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
