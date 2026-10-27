from jjukgo.segments import to_segments
from jjukgo.targets import rows_to_fetch


def row(t_s, state, rem, direction="et"):
    return {"itst_id": "1", "direction": direction, "movement": "Pd", "state": state,
            "trsm_utc": str(1_793_000_000_000 + int(t_s * 1000)), "remaining_ds": rem}


def test_collapses_runs_by_state():
    rows = [row(0, "green", 100), row(1, "green", 90), row(2, "green", 80),
            row(3, "red", 300), row(4, "red", 290)]
    segs = to_segments(rows)
    assert [(s["state"], s["samples"], s["rem_start_ds"], s["rem_end_ds"]) for s in segs] == [
        ("green", 3, 100, 80), ("red", 2, 300, 290)]
    assert segs[0]["start_utc"].endswith("Z") and segs[0]["start_utc"] < segs[0]["end_utc"]


def test_splits_on_gap_and_new_cycle_and_dedupes():
    rows = [row(0, "red", 50), row(1, "red", 40), row(1, "red", 40),  # 같은 시각 중복
            row(20, "red", 30),                                       # 5초 넘는 공백
            row(21, "red", 300)]                                      # 같은 상태인데 잔여시간이 다시 늘어남
    segs = to_segments(rows)
    assert [s["samples"] for s in segs] == [2, 1, 1]


def test_groups_by_direction_and_skips_missing_time():
    rows = [row(0, "red", 50), row(0, "red", 50, direction="wt"),
            {**row(1, "red", 40), "trsm_utc": ""}]
    segs = to_segments(rows)
    assert sorted(s["direction"] for s in segs) == ["et", "wt"]


def test_rows_to_fetch():
    assert rows_to_fetch(None, 1000, 2200, 300) == 2200
    assert rows_to_fetch(700, 1000, 2200, 300) == 360
    assert rows_to_fetch(990, 1000, 2200, 300) == 300
    assert rows_to_fetch(0, 10_000, 2200, 300) == 2200
