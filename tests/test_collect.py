import json
from datetime import date, datetime

from jjukgo import KST
from jjukgo.budget import Budget
from jjukgo.collect import FIXTURE, collect_once, daily_report, load_config, ROOT
from jjukgo.store import read_day
from jjukgo.tdata_client import FixtureClient, QuotaExceeded, RateLimited

CFG = load_config(ROOT / "config" / "collector.toml")
# 기존 테스트는 1초 원본(signals/)을 읽어 검증하므로 원본 저장을 켠다.
CFG = {**CFG, "store": {**CFG["store"], "raw": True}}
# 실제 설정의 대상 교차로(테헤란로)와 무관하게, 대상이 필요한 테스트는 직접 지정한다.
CFG = {**CFG, "targets": {**CFG["targets"], "itst_ids": []}}
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
    cfg = {**CFG, "budget": {**CFG["budget"], "calls_per_run": 3, "run_interval_min": 15}, "targets": {"itst_ids": ["1537", "23665", "1600"]}}
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
    names = [st["name"] for st in out["steps"]]
    assert names == ["unfiltered_5000", "filtered_immediately", "filtered_after_wait"]
    assert out["steps"][0]["distinct_itst"] == 3
    assert out["limit_is_global"] is False and out["filter_works"] is True
    assert budget.usage.calls == 3
    assert set(json.loads((tmp_path / "meta" / "discovered_ids.json").read_text())) == {"1537", "23665", "1600"}


def test_discover_detects_global_rate_limit(tmp_path):
    from jjukgo.collect import discover

    class LimitedClient(FixtureClient):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.calls = 0

        def fetch(self, page_no=1, num_of_rows=1000, itst_id=None, max_wait_s=None):
            self.calls += 1
            if self.calls == 2 and max_wait_s == 0:
                raise RateLimited("429", retry_after_s=101, limit_s=300)
            return super().fetch(page_no, num_of_rows, itst_id, max_wait_s)

    out = discover(LimitedClient(FIXTURE), CFG["api"], tmp_path, NOW)
    assert out["limit_is_global"] is True
    assert out["steps"][1]["rate_limited"] == {"retry_after_s": 101, "limit_s": 300}
    assert out["filter_works"] is True


def test_rate_limit_does_not_stop_the_day(tmp_path):
    class LimitedClient:
        def fetch(self, *a, **k):
            raise RateLimited("429", retry_after_s=101, limit_s=300)

    budget, _ = make(tmp_path)
    summary = collect_once(CFG, tmp_path, LimitedClient(), budget, NOW)
    assert "rate_limited" in summary and "quota_hit" not in summary
    assert Budget(tmp_path, NOW, 1000, 0.7).remaining == 700
    assert not (tmp_path / "meta" / "api_probe.json").exists()


def test_parse_rate_limit_from_real_body():
    from jjukgo.tdata_client import parse_rate_limit

    body = {"timestamp": "2026-10-28 01:19:33", "status": 429, "error": "Too Many Requests",
            "code": "V2X_REPEAT_CALL_LIMIT", "api": "v2xSignalPhaseTimingFusionInformation",
            "limitSeconds": 300, "retryAfterSeconds": 101}
    err = parse_rate_limit(body)
    assert err.retry_after_s == 101 and err.limit_s == 300
    assert parse_rate_limit({"responseCode": 404}) is None


def test_calls_per_run_caps_per_intersection_calls(tmp_path):
    (tmp_path / "meta").mkdir()
    (tmp_path / "meta" / "api_probe.json").write_text(json.dumps({"version": 2, "mode": "per_intersection"}), encoding="utf-8")
    cfg = {**CFG, "budget": {**CFG["budget"], "calls_per_run": 2}, "targets": {"itst_ids": ["1537", "23665", "1600"]}}
    budget, client = make(tmp_path)
    summary = collect_once(cfg, tmp_path, client, budget, NOW)
    assert budget.usage.calls == 2 and summary["rows"] > 0


def test_discovered_ids_used_when_no_targets(tmp_path):
    (tmp_path / "meta").mkdir()
    (tmp_path / "meta" / "api_probe.json").write_text(json.dumps({"version": 2, "mode": "per_intersection"}), encoding="utf-8")
    (tmp_path / "meta" / "discovered_ids.json").write_text(json.dumps(["1537"]), encoding="utf-8")
    budget, client = make(tmp_path)
    summary = collect_once(CFG, tmp_path, client, budget, NOW)
    assert summary["targets"] == 1 and summary["rows"] == 2


def test_segments_written_and_raw_off_by_default(tmp_path):
    from jjukgo.store import read_segments_day

    cfg = {**BULK_CFG, "store": {**BULK_CFG["store"], "raw": False}}
    budget, client = make(tmp_path)
    summary = collect_once(cfg, tmp_path, client, budget, NOW)
    assert summary["raw_file"] is None and summary["segments"] > 0
    assert not (tmp_path / "signals").exists()
    segs = list(read_segments_day(tmp_path, date(2026, 10, 27)))
    assert {s["itst_id"] for s in segs} == {"1537", "23665"}  # 1600은 trsm 시각이 없어 구간을 만들 수 없다


def test_adaptive_rows_and_last_fetch(tmp_path):
    (tmp_path / "meta").mkdir()
    (tmp_path / "meta" / "api_probe.json").write_text(json.dumps({"version": 2, "mode": "per_intersection"}), encoding="utf-8")
    asked = []

    class RecordingClient(FixtureClient):
        def fetch(self, page_no=1, num_of_rows=1000, itst_id=None, max_wait_s=None):
            asked.append(num_of_rows)
            return super().fetch(page_no, num_of_rows, itst_id, max_wait_s)

    cfg = {**CFG, "targets": {"itst_ids": ["1537"]}}
    budget = Budget(tmp_path, NOW, 1000, 0.7)
    collect_once(cfg, tmp_path, RecordingClient(FIXTURE, on_call=budget.record_call), budget, NOW)
    later = NOW.replace(minute=55)  # 5분 뒤
    budget = Budget(tmp_path, later, 1000, 0.7)
    collect_once(cfg, tmp_path, RecordingClient(FIXTURE, on_call=budget.record_call), budget, later)
    assert asked == [2200, 360]  # 처음엔 최대치, 5분 뒤엔 300초 + 여유 60건


def test_client_waits_full_window_after_rejected_call(tmp_path, monkeypatch):
    """거절된 호출도 300초 창을 다시 시작하므로, retryAfter가 아니라 창 전체를 기다렸다 다시 부른다."""
    import io, urllib.error
    from jjukgo import tdata_client as tc

    now = [1000.0]
    slept = []
    calls = []
    body = json.dumps({"status": 429, "code": "V2X_REPEAT_CALL_LIMIT", "limitSeconds": 300, "retryAfterSeconds": 20}).encode()
    ok = json.dumps({"body": {"items": [{"itstId": "2217", "trsmUtcTime": 1}]}}).encode()

    def fake_urlopen(url, timeout):
        calls.append(now[0])
        if len(calls) == 1:
            raise urllib.error.HTTPError(url, 429, "Too Many Requests", {}, io.BytesIO(body))
        return io.BytesIO(ok)

    def sleep(s):
        slept.append(s)
        now[0] += s

    monkeypatch.setattr(tc.urllib.request, "urlopen", fake_urlopen)
    path = tmp_path / "last_call.json"
    client = tc.TDataClient("http://x", "k", sleep=sleep, last_call_path=path, clock=lambda: now[0])
    records, _ = client.fetch(1, 300, "2217")
    assert records and slept == [tc.SPACING_S]
    assert calls[1] - calls[0] >= 300


def test_client_spaces_calls_across_runs(tmp_path, monkeypatch):
    """다른 실행이 방금 불렀으면(파일에 남은 시각) 그만큼 기다렸다 부른다."""
    import io
    from jjukgo import tdata_client as tc

    now = [5000.0]
    slept = []
    path = tmp_path / "last_call.json"
    path.write_text(json.dumps({"at": 4900.0}), encoding="utf-8")
    monkeypatch.setattr(tc.urllib.request, "urlopen", lambda url, timeout: io.BytesIO(b'{"items": []}'))
    client = tc.TDataClient("http://x", "k", sleep=lambda s: (slept.append(s), now.__setitem__(0, now[0] + s)),
                            last_call_path=path, clock=lambda: now[0])
    client.fetch(1, 300, "2217")
    assert slept == [205.0]
    assert json.loads(path.read_text())["at"] == 5205.0
    # 기다릴 수 있는 시간보다 오래 남았으면 부르지 않는다
    path.write_text(json.dumps({"at": now[0]}), encoding="utf-8")
    import pytest
    with pytest.raises(tc.RateLimited):
        client.fetch(1, 300, "2217", max_wait_s=0)


def test_crawl_alternates_with_focus_targets(tmp_path):
    (tmp_path / "meta").mkdir()
    (tmp_path / "meta" / "api_probe.json").write_text(json.dumps({"version": 2, "mode": "per_intersection"}), encoding="utf-8")
    crawl = tmp_path / "crawl.txt"
    crawl.write_text("# 주석\n1600\n23665\n", encoding="utf-8")
    cfg = {**CFG, "targets": {"itst_ids": ["1537"], "crawl_ids_file": str(crawl), "crawl_every": 3}}
    got = []
    for i in range(6):
        now = NOW.replace(minute=5 * i)
        budget = Budget(tmp_path, now, 1000, 0.7)
        s = collect_once(cfg, tmp_path, FixtureClient(FIXTURE, on_call=budget.record_call), budget, now)
        got.append(s["crawl"])
    assert got == [False, False, True, False, False, True]
    assert json.loads((tmp_path / "meta" / "crawl_cursor.json").read_text())["next_index"] == 0  # 2곳 중 2번 돌아 처음으로


def test_network_retry_respects_global_spacing_and_success_log(tmp_path, monkeypatch):
    import io
    from jjukgo import tdata_client as tc

    now, attempts = [1000.0], []
    def sleep(seconds):
        now[0] += seconds
    def urlopen(url, timeout):
        attempts.append(now[0])
        if len(attempts) == 1:
            now[0] += 20  # timeout 20초도 호출 간격에 포함된다.
            raise TimeoutError()
        return io.BytesIO(b'{"items": [{"itstId": "1537"}]}')
    monkeypatch.setattr(tc.urllib.request, "urlopen", urlopen)
    log = tmp_path / 'calls.csv'
    client = tc.TDataClient('http://example.test', 'test', clock=lambda: now[0], sleep=sleep, call_log_path=log)
    rows, _ = client.fetch(itst_id='1537')
    assert rows and attempts == [1000.0, 1305.0]
    assert log.read_text().count(',ok,') == 1
    assert log.read_text().count(',net_error,') == 1


def test_invalid_json_is_not_logged_as_success(tmp_path, monkeypatch):
    import io
    import pytest
    from jjukgo import tdata_client as tc

    monkeypatch.setattr(tc.urllib.request, 'urlopen', lambda *a, **k: io.BytesIO(b'bad json'))
    log = tmp_path / 'calls.csv'
    client = tc.TDataClient('http://example.test', 'test', max_retries=1, call_log_path=log)
    with pytest.raises(tc.ApiError):
        client.fetch()
    assert ',ok,' not in log.read_text()
    assert ',net_error,' in log.read_text()


def test_failed_target_does_not_block_next_target(tmp_path):
    from jjukgo.tdata_client import ApiError

    (tmp_path / 'meta').mkdir()
    (tmp_path / 'meta/api_probe.json').write_text(json.dumps({'version': 2, 'mode': 'per_intersection'}))
    class FailingClient(FixtureClient):
        def fetch(self, page_no=1, num_of_rows=1000, itst_id=None, **kwargs):
            if itst_id == '1537':
                raise ApiError('timeout')
            return super().fetch(page_no, num_of_rows, itst_id, **kwargs)
    cfg = {**CFG, 'budget': {**CFG['budget'], 'calls_per_run': 1}, 'targets': {'itst_ids': ['1537', '23665']}}
    budget, _ = make(tmp_path)
    first = collect_once(cfg, tmp_path, FailingClient(FIXTURE), budget, NOW)
    assert first['error'] == 'timeout'
    assert not (tmp_path / 'meta/last_fetch.json').exists()
    assert json.loads((tmp_path / 'meta/cursor.json').read_text())['next_index'] == 1
    budget, _ = make(tmp_path)
    second = collect_once(cfg, tmp_path, FailingClient(FIXTURE), budget, NOW.replace(minute=55))
    assert second['rows'] > 0 and 'error' not in second
