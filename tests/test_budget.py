from datetime import datetime

from jjukgo import KST
from jjukgo.budget import Budget, run_allowance


def test_last_slot_takes_everything():
    now = datetime(2026, 10, 27, 23, 50, tzinfo=KST)
    assert run_allowance(37, now, 15, [], 2.0) == 37


def test_spread_over_day():
    now = datetime(2026, 10, 27, 0, 0, tzinfo=KST)
    # 96 슬롯 균등 → 700 / 96 = 7.29
    assert run_allowance(700, now, 15, [], 2.0) == 7


def test_peak_gets_more():
    off_peak = run_allowance(500, datetime(2026, 10, 27, 10, 0, tzinfo=KST), 15, [8, 18], 2.0)
    peak = run_allowance(500, datetime(2026, 10, 27, 8, 0, tzinfo=KST), 15, [8, 18], 2.0)
    assert peak > off_peak


def test_zero_remaining():
    assert run_allowance(0, datetime(2026, 10, 27, 8, 0, tzinfo=KST), 15, [], 1.0) == 0


def test_budget_persists_and_quota(tmp_path):
    now = datetime(2026, 10, 27, 8, 0, tzinfo=KST)
    b = Budget(tmp_path, now, 1000, 0.7)
    assert b.remaining == 700
    for _ in range(5):
        b.record_call()
    b.save()
    b2 = Budget(tmp_path, now, 1000, 0.7)
    assert b2.remaining == 695
    b2.mark_quota_hit()
    assert b2.remaining == 0


def test_budget_resets_on_kst_midnight(tmp_path):
    b = Budget(tmp_path, datetime(2026, 10, 27, 23, 59, tzinfo=KST), 1000, 0.7)
    b.record_call()
    b.save()
    assert Budget(tmp_path, datetime(2026, 10, 28, 0, 1, tzinfo=KST), 1000, 0.7).remaining == 700
