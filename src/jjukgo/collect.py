"""신호 수집기 CLI.

  python -m jjukgo.collect probe   # API가 일괄 조회를 지원하는지 확인
  python -m jjukgo.collect discover  # 응답 구조·호출 제한 탐색 — 호출 3회, 약 5분
  python -m jjukgo.collect once    # 예산 안에서 한 번 수집 (GitHub Actions가 15분마다 실행)
  python -m jjukgo.collect report  # 전날 수집 결과 점검 리포트
  python -m jjukgo.collect static  # 정적 MAP 파일 내려받기

공통 옵션: --data-dir (데이터 브랜치 체크아웃 위치), --dry-run (가짜 응답 사용)
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import tomllib
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import KST
from .budget import Budget, run_allowance
from .normalize import normalize
from .segments import to_segments
from .store import read_day, read_segments_day, write_part, write_segments
from .targets import (load_cursor, load_discovered, load_last_fetch, load_targets, round_robin, rows_to_fetch,
                      save_cursor, save_last_fetch)
from .tdata_client import ApiError, FixtureClient, QuotaExceeded, RateLimited, TDataClient

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "fusion_sample.json"
API_KEY_ENV = "SEOUL_TDATA_API_KEY"
PROBE_VERSION = 2


def load_config(path: Path) -> dict:
    with open(path, "rb") as f:
        return tomllib.load(f)


def _probe_path(data_dir: Path) -> Path:
    return Path(data_dir) / "meta" / "api_probe.json"


def probe(client, api_cfg: dict, now: datetime) -> tuple[dict, list[dict]]:
    """itstId 없이 한 번 호출해서 일괄 조회가 되는지, 한 페이지에 몇 건 오는지 본다."""
    result: dict = {"version": PROBE_VERSION, "probed_at_utc": now.astimezone(timezone.utc).isoformat()}
    try:
        records, total = client.fetch(1, api_cfg["num_of_rows"], None)
    except (QuotaExceeded, RateLimited):
        raise  # 판정이 아니라 일시적 거절이므로 probe 결과로 남기지 않는다
    except ApiError as e:
        result.update(mode="per_intersection", reason=f"itstId 없는 호출 실패: {e}")
        return result, []

    ids = {str(r.get("itstId")) for r in records}
    if len(ids) >= api_cfg.get("bulk_min_intersections", 20):
        page_size = len(records)
        result.update(
            mode="bulk",
            total_count=total,
            page_size=page_size,
            pages=math.ceil(total / page_size) if total else None,
        )
    else:
        result.update(mode="per_intersection", reason=f"itstId 없이 호출 시 교차로 {len(ids)}개만 반환 (일괄 조회 아님)")
    result["sample_keys"] = sorted(records[0].keys()) if records else []
    result["sample_record"] = records[0] if records else None
    return result, records


def _span_s(records: list[dict]) -> float | None:
    times = []
    for r in records:
        try:
            times.append(float(r["trsmUtcTime"]))
        except (KeyError, TypeError, ValueError):
            pass
    return round((max(times) - min(times)) / 1000, 1) if times else None


def _describe(records: list[dict]) -> dict:
    ids = [str(r.get("itstId")) for r in records]
    return {"records": len(records), "distinct_itst": len(set(ids)), "span_s": _span_s(records)}


def discover(client, api_cfg: dict, data_dir: Path, now: datetime) -> dict:
    """호출 간격 제한(300초/회)을 고려해 API 동작을 알아본다. 호출 3회, 약 5분.

    1. 교차로 ID 없이 numOfRows=5000: 한 번에 얼마나 오는지(최대 행 수), 교차로가 몇 곳인지
    2. 본 교차로 하나로 itstId 필터를 *기다리지 않고* 바로 호출: 429면 제한이 키 전체에 걸린 것
    3. 같은 필터 호출을 (필요하면 기다렸다가) 재시도: 필터 동작과 한 번에 오는 시간 범위
    """
    out: dict = {"discovered_at_utc": now.astimezone(timezone.utc).isoformat(), "steps": []}
    seen: list[str] = []

    def step(name: str, rows: int, itst_id: str | None, max_wait_s: float | None) -> list[dict]:
        entry: dict = {"name": name, "itst_id": itst_id, "num_of_rows": rows}
        records: list[dict] = []
        t0 = time.monotonic()
        try:
            records, total = client.fetch(1, rows, itst_id, max_wait_s=max_wait_s)
            entry.update(_describe(records), total_count=total)
        except RateLimited as e:
            entry["rate_limited"] = {"retry_after_s": e.retry_after_s, "limit_s": e.limit_s}
        except ApiError as e:
            entry["error"] = str(e)[:300]
        entry["elapsed_s"] = round(time.monotonic() - t0, 1)
        out["steps"].append(entry)
        return records

    records = step("unfiltered_5000", 5000, None, None)
    if not records and "error" in out["steps"][-1]:
        records = step("unfiltered_1000", 1000, None, None)  # 5000이 거절되면 1000으로
    counts: dict[str, int] = {}
    for r in records:
        counts[str(r.get("itstId"))] = counts.get(str(r.get("itstId")), 0) + 1
    seen = list(counts)
    out["max_rows_ok"] = len(records) > 1000

    if seen:
        target = seen[0]
        immediate = step("filtered_immediately", 1000, target, 0)
        out["limit_is_global"] = "rate_limited" in out["steps"][-1]
        step("filtered_after_wait", 1000, target, None)
        out["filter_works"] = (
            out["steps"][-1].get("distinct_itst") == 1 if "distinct_itst" in out["steps"][-1] else None
        )
    else:
        out["limit_is_global"] = None
        out["filter_works"] = None

    ids_path = Path(data_dir) / "meta" / "discovered_ids.json"
    known = json.loads(ids_path.read_text(encoding="utf-8")) if ids_path.exists() else []
    merged = list(dict.fromkeys([*map(str, known), *seen]))
    ids_path.parent.mkdir(parents=True, exist_ok=True)
    ids_path.write_text(json.dumps(merged), encoding="utf-8")
    out["discovered_ids_total"] = len(merged)
    (Path(data_dir) / "meta" / "discovery.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def collect_once(cfg: dict, data_dir: Path, client, budget: Budget, now: datetime) -> dict:
    data_dir = Path(data_dir)
    api_cfg, budget_cfg, store_cfg = cfg["api"], cfg["budget"], cfg["store"]
    targets = load_targets(cfg["targets"], ROOT) or load_discovered(data_dir)
    summary: dict = {"date": budget.date, "targets": len(targets)}
    records: list[dict] = []

    try:
        probe_path = _probe_path(data_dir)
        probe_info = json.loads(probe_path.read_text(encoding="utf-8")) if probe_path.exists() else None
        if probe_info is not None and probe_info.get("version") != PROBE_VERSION:
            probe_info = None  # 판정 기준이 바뀌었으니 다시 판정
        if probe_info is None:
            probe_info, records = probe(client, api_cfg, now)
            probe_path.parent.mkdir(parents=True, exist_ok=True)
            probe_path.write_text(json.dumps(probe_info, ensure_ascii=False, indent=2), encoding="utf-8")
        summary["mode"] = probe_info["mode"]

        allowance = run_allowance(
            budget.remaining, now, budget_cfg["run_interval_min"], budget_cfg["peak_hours"], budget_cfg["peak_weight"]
        )
        summary["allowance"] = allowance

        if probe_info["mode"] == "bulk":
            pages = probe_info.get("pages")
            page_size = probe_info["page_size"]
            if records:
                pass  # 프로브 첫 실행: 이미 받은 1페이지로 이번 실행을 대신한다
            elif pages and allowance < pages:
                summary["skipped"] = f"이번 몫 {allowance}회 < 전체 조회 {pages}페이지"
            else:
                limit = min(pages or api_cfg["max_pages"], allowance)
                for page_no in range(1, limit + 1):
                    page, _ = client.fetch(page_no, page_size, None)
                    records.extend(page)
                    if len(page) < page_size:
                        break
            if targets:
                wanted = set(targets)
                records = [r for r in records if str(r.get("itstId")) in wanted]
        else:
            if not targets:
                summary["skipped"] = "교차로별 호출 모드인데 대상 교차로가 없음 (config/collector.toml [targets] 확인)"
            else:
                picked, next_cursor = round_robin(targets, load_cursor(data_dir), min(allowance, budget_cfg.get("calls_per_run", allowance)))
                last_fetch = load_last_fetch(data_dir)
                for itst_id in picked:
                    n = rows_to_fetch(last_fetch.get(itst_id), now.timestamp(),
                                      api_cfg.get("rows_per_intersection", 2200), api_cfg.get("min_rows", 300))
                    page, _ = client.fetch(1, n, itst_id)
                    records.extend(page)
                    last_fetch[itst_id] = now.timestamp()
                    save_last_fetch(data_dir, last_fetch)
                save_cursor(data_dir, next_cursor)
    except RateLimited as e:
        summary["rate_limited"] = str(e)  # 기다리면 풀리는 제한: 오늘 수집을 멈추지 않는다
    except QuotaExceeded as e:
        budget.mark_quota_hit()
        summary["quota_hit"] = str(e)
    except ApiError as e:
        summary["error"] = str(e)
    finally:
        rows = normalize(records, now, store_cfg.get("movements"))
        segments = to_segments(rows)
        seg_path = write_segments(data_dir, segments, now)
        path = write_part(data_dir, rows, now) if store_cfg.get("raw", False) else None
        budget.save()
        summary.update(records=len(records), rows=len(rows), segments=len(segments),
                       file=str(seg_path) if seg_path else None, raw_file=str(path) if path else None,
                       calls_today=budget.usage.calls)
    return summary


def daily_report(data_dir: Path, day: date) -> Path:
    rows = list(read_day(data_dir, day))
    by_hour = Counter()
    states = Counter()
    intersections = set()
    missing_remaining = 0
    for r in rows:
        by_hour[datetime.fromisoformat(r["collected_at_utc"].replace("Z", "+00:00")).astimezone(KST).hour] += 1
        states[r["state"] or "(없음)"] += 1
        intersections.add(r["itst_id"])
        if r["remaining_ds"] == "":
            missing_remaining += 1

    segs = list(read_segments_day(data_dir, day))
    covered_s = 0.0
    seg_itst = set()
    for sg in segs:
        seg_itst.add(sg["itst_id"])
        t0 = datetime.fromisoformat(sg["start_utc"].replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(sg["end_utc"].replace("Z", "+00:00"))
        covered_s += (t1 - t0).total_seconds()

    usage_path = Path(data_dir) / "meta" / "usage" / f"{day.isoformat()}.json"
    usage = json.loads(usage_path.read_text(encoding="utf-8")) if usage_path.exists() else {}

    lines = [
        f"# 수집 리포트 {day.isoformat()} (KST)",
        "",
        f"- 행 수: {len(rows):,}",
        f"- 교차로 수: {len(intersections):,}",
        f"- 잔여시간 결측: {missing_remaining:,}",
        f"- API 호출: {usage.get('calls', 0):,}" + (" (한도 도달)" if usage.get("quota_hit") else ""),
        f"- 상태 구간: {len(segs):,}개 · 교차로 {len(seg_itst):,}곳 · 구간 길이 합 {covered_s / 3600:.1f}시간",
        "",
        "## 시간대별 행 수",
        "",
        "| 시 | 행 |",
        "|---|---|",
        *[f"| {h:02d} | {by_hour.get(h, 0):,} |" for h in range(24)],
        "",
        "## 신호 상태 분포",
        "",
        "| 상태 | 행 |",
        "|---|---|",
        *[f"| {s} | {n:,} |" for s, n in states.most_common()],
        "",
    ]
    path = Path(data_dir) / "meta" / "daily_report" / f"{day.isoformat()}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def download_static(cfg: dict, data_dir: Path, api_key: str) -> list[Path]:
    saved = []
    for source in cfg.get("static", {}).get("sources", []):
        url = source["url"].replace("{apiKey}", api_key)
        path = Path(data_dir) / "static" / f"{source['name']}.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=60) as resp:
            path.write_bytes(resp.read())
        saved.append(path)
    return saved


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jjukgo.collect", description="쭉고 신호 수집기")
    parser.add_argument("command", choices=["probe", "discover", "once", "report", "static"])
    parser.add_argument("--config", type=Path, default=ROOT / "config" / "collector.toml")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "datastore")
    parser.add_argument("--dry-run", action="store_true", help="API 대신 tests/fixtures 가짜 응답 사용")
    parser.add_argument("--now", help="현재 시각 대체 (ISO 8601, 테스트용)")
    parser.add_argument("--date", help="report 대상 날짜 YYYY-MM-DD (기본: 어제 KST)")
    args = parser.parse_args(argv)

    cfg = load_config(args.config)
    now = datetime.fromisoformat(args.now) if args.now else datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=KST)

    if args.command == "report":
        day = date.fromisoformat(args.date) if args.date else (now.astimezone(KST) - timedelta(days=1)).date()
        print(f"리포트 작성: {daily_report(args.data_dir, day)}")
        return 0

    api_key = os.environ.get(API_KEY_ENV, "")
    if not api_key and not args.dry_run:
        print(f"::warning::{API_KEY_ENV}가 설정되지 않아 수집을 건너뜁니다. docs/DATA_COLLECTION.md 참고.")
        return 0

    if args.command == "static":
        for path in download_static(cfg, args.data_dir, api_key):
            print(f"저장: {path}")
        return 0

    budget = Budget(args.data_dir, now, cfg["budget"]["daily_limit"], cfg["budget"]["collect_share"])
    if args.dry_run:
        client = FixtureClient(FIXTURE, on_call=budget.record_call)
    else:
        api = cfg["api"]
        client = TDataClient(
            api["base_url"], api_key, api["timeout_s"], api["max_retries"], on_call=budget.record_call,
            rate_limit_wait_max_s=api.get("rate_limit_wait_max_s", 330),
        )

    if args.command == "discover":
        try:
            info = discover(client, cfg["api"], args.data_dir, now)
        finally:
            budget.save()
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0

    if args.command == "probe":
        try:
            info, _ = probe(client, cfg["api"], now)
        finally:
            budget.save()
        path = _probe_path(args.data_dir)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({k: v for k, v in info.items() if k != "sample_record"}, ensure_ascii=False, indent=2))
        return 0

    summary = collect_once(cfg, args.data_dir, client, budget, now)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if "error" in summary else 0


if __name__ == "__main__":
    sys.exit(main())
