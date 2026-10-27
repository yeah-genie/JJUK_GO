import json
from datetime import datetime, timezone
from pathlib import Path

from jjukgo.normalize import normalize
from jjukgo.tdata_client import extract_records, extract_total_count

FIXTURE = Path(__file__).parent / "fixtures" / "fusion_sample.json"
NOW = datetime(2026, 10, 27, 11, 30, tzinfo=timezone.utc)


def load():
    return extract_records(json.loads(FIXTURE.read_text(encoding="utf-8")))


def test_pedestrian_only_rows():
    rows = normalize(load(), NOW, ["Pd"])
    keys = {(r["itst_id"], r["direction"]) for r in rows}
    assert keys == {("1537", "nt"), ("1537", "et"), ("23665", "ne"), ("23665", "sw"), ("1600", "wt"), ("1600", "nw")}
    assert all(r["movement"] == "Pd" for r in rows)


def test_values_and_missing():
    rows = {(r["itst_id"], r["direction"]): r for r in normalize(load(), NOW, ["Pd"])}
    assert rows[("1537", "nt")]["remaining_ds"] == 312
    assert rows[("1537", "nt")]["state"] == "stop-And-Remain"
    assert rows[("1537", "nt")]["collected_at_utc"] == "2026-10-27T11:30:00Z"
    # 잔여시간이 비어 있어도 상태가 있으면 행을 남긴다
    assert rows[("1600", "wt")]["remaining_ds"] == ""
    assert rows[("1600", "wt")]["trsm_utc"] == ""


def test_all_movements():
    rows = normalize(load(), NOW, None)
    assert ("1537", "nt", "St") in {(r["itst_id"], r["direction"], r["movement"]) for r in rows}
    assert ("23665", "wt", "Lt") in {(r["itst_id"], r["direction"], r["movement"]) for r in rows}


def test_extract_nested_payload():
    payload = {"response": {"body": {"totalCount": "2779", "items": {"item": [{"itstId": "1"}, {"itstId": "2"}]}}}}
    assert [r["itstId"] for r in extract_records(payload)] == ["1", "2"]
    assert extract_total_count(payload) == 2779
