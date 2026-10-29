#!/usr/bin/env python3
"""서울시 대로변 횡단보도 위치정보(OA-21209, 서비스명 tbTraficCrsng) 전량 수집.

    SEOUL_OPENAPI_KEY=... python scripts/fetch_crosswalks.py [--out-dir crosswalk-data]
    python scripts/fetch_crosswalks.py --sample      # 키 없이 sample 인증키로 1~5행만 (수동 점검용)

인증키는 요청 URL에 들어가므로 URL·예외 메시지를 그대로 출력하지 않는다.
모든 출력은 scrub()을 거쳐 키 값을 가린다. 단위·결측·이상치는 요약에 보고만 하고 값은 고치지 않는다.
"""
import argparse
import csv
import gzip
import io
import json
import os
import re
import statistics
import sys
import time
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SERVICE = "tbTraficCrsng"
KEY_ENV = "SEOUL_OPENAPI_KEY"
BASE = "http://openapi.seoul.go.kr:8088"  # HTTPS(443)는 TLS 실패가 확인되어 HTTP 8088을 쓴다
PAGE = 1000
MAX_ATTEMPTS = 4
PAUSE = 0.5
TIMEOUT = 60
COLUMNS = ["NODE_TYPE", "NODE_WKT", "NODE_ID", "NODE_TYPE_CD", "LNKG_WKT", "LNKG_ID", "LNKG_TYPE_CD",
           "BGNG_LNKG_ID", "END_LNKG_ID", "LNKG_LEN", "SGG_CD", "SGG_NM", "EMD_CD", "EMD_NM"]

_secrets = set()


class FetchError(Exception):
    pass


def scrub(text):
    """등록된 키 값을 모두 가린다."""
    text = str(text)
    for s in _secrets:
        if s:
            text = text.replace(s, "***")
    return text


def log(msg):
    print(scrub(msg), flush=True)


def fetch_page(key, start, end, sleep=time.sleep):
    """한 페이지를 받아 JSON dict로 돌려준다. 네트워크·형식 오류만 지수 백오프로 재시도한다."""
    url = f"{BASE}/{key}/json/{SERVICE}/{start}/{end}/"
    last = "알 수 없는 오류"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT) as resp:
                status = getattr(resp, "status", 200)
                body = resp.read()
            if status != 200:
                raise OSError(f"HTTP {status}")
            return json.loads(body.decode("utf-8"))
        except Exception as e:  # 예외 문자열에 URL이 섞일 수 있어 종류만 남긴다
            last = f"{type(e).__name__}: {scrub(e)}"
        if attempt < MAX_ATTEMPTS:
            wait = 2 ** attempt
            log(f"  {start}~{end} 재시도 {attempt}/{MAX_ATTEMPTS - 1} ({last}), {wait}초 대기")
            sleep(wait)
    raise FetchError(f"{start}~{end} 요청이 {MAX_ATTEMPTS}회 모두 실패했습니다 ({last})")


def parse_payload(payload, start, end):
    """(list_total_count, rows)를 돌려준다. RESULT.CODE가 INFO-000이 아니면 코드·메시지만 담아 실패한다."""
    if not isinstance(payload, dict):
        raise FetchError(f"{start}~{end} 응답이 JSON 객체가 아닙니다")
    body = payload.get(SERVICE)
    result = body.get("RESULT") if isinstance(body, dict) else payload.get("RESULT")
    if not isinstance(result, dict):
        raise FetchError(f"{start}~{end} 응답에 RESULT가 없습니다 (최상위 키: {sorted(map(str, payload))[:5]})")
    code = str(result.get("CODE", ""))
    if code != "INFO-000":
        raise FetchError(f"{start}~{end} API 오류 코드 {code}: {result.get('MESSAGE', '')}")
    if not isinstance(body, dict):
        raise FetchError(f"{start}~{end} 응답에 {SERVICE} 본문이 없습니다")
    try:
        total = int(body.get("list_total_count"))
    except (TypeError, ValueError):
        raise FetchError(f"{start}~{end} list_total_count를 읽을 수 없습니다")
    rows = body.get("row") or []
    if not isinstance(rows, list):
        raise FetchError(f"{start}~{end} row가 목록이 아닙니다")
    return total, rows


def fetch_all(key, sample=False, sleep=time.sleep, pause=PAUSE):
    if sample:
        total, rows = parse_payload(fetch_page(key, 1, 5, sleep), 1, 5)
        if not 1 <= len(rows) <= 5:
            raise FetchError(f"sample 응답 행 수가 이상합니다 ({len(rows)}행)")
        return total, rows
    rows, total, start = [], None, 1
    while total is None or start <= total:
        end = start + PAGE - 1
        t, got = parse_payload(fetch_page(key, start, end, sleep), start, end)
        if total is None:
            total = t
            log(f"전체 {total}건, {PAGE}건씩 요청")
        elif t != total:
            raise FetchError(f"{start}~{end} list_total_count가 바뀌었습니다 ({total} -> {t})")
        want = min(end, total) - start + 1
        if len(got) != want:
            raise FetchError(f"{start}~{end} 행 수가 맞지 않습니다 (기대 {want}, 실제 {len(got)})")
        rows.extend(got)
        log(f"  {len(rows)}/{total}")
        start = end + 1
        if start <= total:
            sleep(pause)
    if len(rows) != total:
        raise FetchError(f"받은 행 수 {len(rows)}가 list_total_count {total}와 다릅니다")
    return total, rows


_NUM = r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?"
_PAIR = re.compile(rf"({_NUM})\s+({_NUM})(?:\s+{_NUM})?")
_KIND = re.compile(r"^\s*(?:SRID=\d+;)?\s*(POINT|LINESTRING|MULTILINESTRING|MULTIPOINT|POLYGON|MULTIPOLYGON)\b",
                   re.I)


def parse_wkt(wkt):
    """WKT에서 (x, y) 목록을 돌려준다. 비었으면 None(결측), 해석 못 하면 ValueError."""
    if wkt is None or not str(wkt).strip():
        return None
    s = str(wkt)
    m = _KIND.match(s)
    if not m:
        raise ValueError("지원하지 않는 WKT")
    rest = s[m.end():]
    if re.match(r"\s*(?:Z|M|ZM)?\s*EMPTY", rest, re.I):
        return None
    pts = [(float(a), float(b)) for a, b, *_ in _PAIR.findall(rest)]
    if not pts:
        raise ValueError("좌표 없음")
    return pts


def _num(v):
    try:
        f = float(str(v).strip())
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def summarize(rows, total, received_at, sample=False):
    lens, bad_len = [], 0
    for r in rows:
        v = r.get("LNKG_LEN")
        if v is None or str(v).strip() == "":
            bad_len += 1
            continue
        f = _num(v)
        if f is None:
            bad_len += 1
        else:
            lens.append(f)
    xs, ys, wkt_failed, wkt_missing = [], [], 0, 0
    for r in rows:
        for col in ("NODE_WKT", "LNKG_WKT"):
            try:
                pts = parse_wkt(r.get(col))
            except ValueError:
                wkt_failed += 1
                continue
            if pts is None:
                wkt_missing += 1
                continue
            xs += [p[0] for p in pts]
            ys += [p[1] for p in pts]
    if lens:
        stats = {"count": len(lens), "min": min(lens), "median": statistics.median(lens), "max": max(lens),
                 "zero_count": sum(1 for v in lens if v == 0), "negative_count": sum(1 for v in lens if v < 0)}
    else:
        stats = {"count": 0, "min": None, "median": None, "max": None, "zero_count": 0, "negative_count": 0}
    stats["missing_or_non_numeric"] = bad_len
    stats["unit_note"] = "미터로 추정, 단위 미확인 - 값을 변환·보정하지 않았다"
    return {
        "service": SERVICE,
        "sample": sample,
        "received_at_utc": received_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "list_total_count": total,
        "row_count": len(rows),
        "node_count": sum(1 for r in rows if str(r.get("NODE_TYPE", "")).strip().upper() == "NODE"),
        "link_count": sum(1 for r in rows if str(r.get("NODE_TYPE", "")).strip().upper() == "LINK"),
        "node_type_counts": dict(Counter(str(r.get("NODE_TYPE", "")) for r in rows)),
        "lnkg_len": stats,
        "by_sgg_nm": dict(sorted(Counter(str(r.get("SGG_NM", "")) for r in rows).items())),
        "coord_range": {"x_min": min(xs), "x_max": max(xs), "y_min": min(ys), "y_max": max(ys)} if xs else None,
        "coord_note": "WKT에서 읽은 값 그대로(좌표계 미확인)",
        "wkt_parse_failed": wkt_failed,
        "wkt_missing": wkt_missing,
    }


def write_outputs(out_dir, rows, summary, sample=False):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    prefix = "oa21209_sample" if sample else "oa21209"
    cols = list(COLUMNS) + sorted({k for r in rows for k in r} - set(COLUMNS))
    buf = io.StringIO(newline="")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(cols)
    for r in rows:
        w.writerow(["" if r.get(c) is None else r.get(c) for c in cols])
    csv_path = out / f"{prefix}_rows.csv.gz"
    with open(csv_path, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as gz:
        gz.write(buf.getvalue().encode("utf-8"))
    json_path = out / f"{prefix}_summary.json"
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                         encoding="utf-8")
    return csv_path, json_path


def main(argv=None, sleep=time.sleep):
    ap = argparse.ArgumentParser(description="서울시 횡단보도 위치정보(OA-21209) 수집")
    ap.add_argument("--out-dir", default="crosswalk-data")
    ap.add_argument("--sample", action="store_true", help="sample 인증키로 1~5행만 받는다(수동 점검용)")
    args = ap.parse_args(argv)

    if args.sample:
        key = "sample"
    else:
        key = os.environ.get(KEY_ENV, "").strip()
        if not key:
            print(f"환경변수 {KEY_ENV}가 없습니다. GitHub 저장소 Secret {KEY_ENV}에 서울 열린데이터광장 "
                  f"인증키를 저장하고 워크플로의 env로 넘겨 주세요.", file=sys.stderr)
            return 2
        _secrets.add(key)
    try:
        total, rows = fetch_all(key, sample=args.sample, sleep=sleep)
        summary = summarize(rows, total, datetime.now(timezone.utc), sample=args.sample)
        csv_path, json_path = write_outputs(args.out_dir, rows, summary, sample=args.sample)
    except FetchError as e:
        print(f"수집 실패: {scrub(e)}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"수집 중 예기치 않은 오류: {type(e).__name__}: {scrub(e)}", file=sys.stderr)
        return 1
    log(f"저장: {csv_path} / {json_path}")
    log(f"행 {summary['row_count']} (NODE {summary['node_count']}, LINK {summary['link_count']}), "
        f"LNKG_LEN {summary['lnkg_len']['min']}~{summary['lnkg_len']['max']} "
        f"(0값 {summary['lnkg_len']['zero_count']}), WKT 실패 {summary['wkt_parse_failed']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
