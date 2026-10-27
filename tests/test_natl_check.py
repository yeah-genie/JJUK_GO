from datetime import datetime

from jjukgo import KST
from jjukgo.natl_check import find_items, summarize_signals


def test_find_items_shapes():
    a = {"response": {"header": {"resultCode": "K0"}, "body": {"items": {"item": [{"crsrdId": "1"}, {"crsrdId": "2"}]}}}}
    b = {"header": {}, "body": {"items": [{"crsrdId": "1"}]}}
    c = {"body": {"items": {"item": {"crsrdId": "9"}}}}
    assert [i["crsrdId"] for i in find_items(a)] == ["1", "2"]
    assert [i["crsrdId"] for i in find_items(b)] == ["1"]
    assert [i["crsrdId"] for i in find_items(c)] == ["9"]


def test_summarize_signals():
    items = [
        {"crsrdId": "2691", "totDt": "2026-10-28 09:00:00", "etPdsgRmndCs": "352", "etPdsgSttsNm": "stop-And-Remain"},
        {"crsrdId": "100", "totDt": "2026-10-28 08:59:30", "ntPdsgRmndCs": "", "ntPdsgSttsNm": None},
    ]
    s = summarize_signals(items, datetime(2026, 10, 28, 9, 0, 10, tzinfo=KST))
    assert s["distinct_intersections"] == 2 and s["ped_values_filled"] == 1
    assert s["ped_states"] == {"stop-And-Remain": 1}
    assert s["age_s_min"] == 10 and s["age_s_max"] == 40
    assert s["watched_present"] == ["2691"]
