import json
from datetime import date, datetime

from jjukgo import KST
from jjukgo.budget import Budget
from jjukgo.collect import FIXTURE, collect_once, daily_report, load_config, ROOT
from jjukgo.store import read_day
from jjukgo.tdata_client import FixtureClient, QuotaExceeded

CFG = load_config(ROOT / "config" / "collector.toml")
BULK_CFG = {**CFG, "api": {**CFG["api"], "bulk_min_intersections": 2}}
NOW = datetime(2026, 10, 27, 23, 50, tzinfo=KST)  # 마지막 슬롯 → 남은 예산 전부 사용 가능


def make(tmp_path, now=NOW):
    budget = Budget(tmp_path, now, 1000, 0.7)
    return budget, FixtureClient(FIXTURE, on_call=budget.record_call)


def test_bulk_mode_first_run_uses_probe_page(tmp_path):
    budget, client = make(tmp_path)
    summary = collect_once(BULK_CFG, tmp_path, client, budget, NOW)
    assert summary["mode"] == "bulk"
    assert summary["rows"] == 6
    assert budget.usage.calls == 1
    probe = json.loads((tmp_path / "meta" / "api_probe.json").read_text(encoding="utf-8"))
    assert probe["pages"] == 1 and "itstId" in probe["sample_keys"]


def test_bulk_mode_second_run_and_report(tmp_path):
    budget, client = make(tmp_path)
    collect_once(BULK_CFG, tmp_path, client, budget, NOW)
    later = NOW.replace(minute=55)
    budget, client = make(tmp_path, later)
    summary = collect_once(BULK_CFG, tmp_path, client, budget, later)
    assert summary["rows"] == 6 and budget.usage.calls == 2
    assert len(list(read_day(tmp_path, date(2026, 10, 27)))) == 12

    report = daily_report(tmp_path, date(2026, 10, 27)).read_text(encoding="utf-8")
    assert "행 수: 12" in report and "교차로 수: 3" in report and "API 호출: 2" in report


def test_bulk_mode_filters_to_targets(tmp_path):
    cfg = {**BULK_CFG, "targets": {"itst_ids": ["1537"]}}
    budget, client = make(tmp_path)
    summary = collect_once(cfg, tmp_path, client, budget, NOW)
    assert summary["rows"] == 2


def test_per_intersection_round_robin(tmp_path):
    (tmp_path / "meta").mkdir()
    (tmp_path / "meta" / "api_probe.json").write_text(json.dumps({"version": 2, "mode": "per_intersection"}), encoding="utf-8")
    cfg = {**CFG, "targets": {"itst_ids": ["1537", "23665", "1600"]}}
    budget, client = make(tmp_path)
    budget.usage.calls = 698  # 남은 예산 2회
    summary = collect_once(cfg, tmp_path, client, budget, NOW)
    assert summary["allowance"] == 2 and budget.usage.calls == 700
    assert {r["itst_id"] for r in read_day(tmp_path, date(2026, 10, 27))} == {"1537", "23665"}
    assert json.loads((tmp_path / "meta" / "cursor.json").read_text())["next_index"] == 2


def test_quota_stops_for_the_day(tmp_path):
    class QuotaClient:
        def fetch(self, *a, **k):
            raise QuotaExceeded("429")

    budget, _ = make(tmp_path)
    summary = collect_once(CFG, tmp_path, QuotaClient(), budget, NOW)
    assert "quota_hit" in summary
    assert Budget(tmp_path, NOW, 1000, 0.7).remaining == 0


def test_small_unfiltered_response_is_not_bulk(tmp_path):
    """교차로 ID 없이 불러도 교차로가 몇 곳뿐이면 일괄 조회로 보지 않는다 (실제 API 동작)."""
    budget, client = make(tmp_path)
    summary = collect_once(CFG, tmp_path, client, budget, NOW)
    assert summary["mode"] == "per_intersection"
    assert "skipped" in summary  # 대상 교차로가 아직 없음


def test_stale_probe_is_redone(tmp_path):
    (tmp_path / "meta").mkdir()
    (tmp_path / "meta" / "api_probe.json").write_text(json.dumps({"mode": "bulk", "page_size": 1000}), encoding="utf-8")
    budget, client = make(tmp_path)
    summary = collect_once(CFG, tmp_path, client, budget, NOW)
    assert summary["mode"] == "per_intersection"


def test_discover_records_ids_and_filter(tmp_path):
    from jjukgo.collect import discover

    budget, client = make(tmp_path)
    out = discover(client, CFG["api"], tmp_path, NOW)
    assert out["pages"][0]["distinct_itst"] == 3
    assert {p["itst_id"] for p in out["per_intersection"]} == {"1537", "23665", "1600"}
    assert all(p["distinct_itst"] == 1 for p in out["per_intersection"])
    assert set(json.loads((tmp_path / "meta" / "discovered_ids.json").read_text())) == {"1537", "23665", "1600"}


def test_discovered_ids_used_when_no_targets(tmp_path):
    (tmp_path / "meta").mkdir()
    (tmp_path / "meta" / "api_probe.json").write_text(json.dumps({"version": 2, "mode": "per_intersection"}), encoding="utf-8")
    (tmp_path / "meta" / "discovered_ids.json").write_text(json.dumps(["1537"]), encoding="utf-8")
    budget, client = make(tmp_path)
    summary = collect_once(CFG, tmp_path, client, budget, NOW)
    assert summary["targets"] == 1 and summary["rows"] == 2
