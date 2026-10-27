import numpy as np

from jjukgo.signal.cycle import evaluate, fit_cycle, samples_from_segments, true_wait


def synth(cycle=140.0, green=27.0, offset=13.0, span=1500, start=1_793_000_000.0, jitter=0.0, seed=0):
    rng = np.random.default_rng(seed)
    t = start + np.arange(span, dtype=float)
    t = t + rng.normal(0, jitter, len(t)) if jitter else t
    g = (np.mod(t - offset, cycle) < green).astype(float)
    return t, g


def test_finds_cycle_and_green_length():
    t, g = synth()
    fit = fit_cycle(t, g)
    assert abs(fit.cycle_s - 140.0) < 0.2
    assert abs(fit.green_s - 27) <= 1
    assert fit.confident


def test_picks_fundamental_not_multiple():
    t, g = synth(cycle=90.0, green=30.0, span=1200)
    assert abs(fit_cycle(t, g).cycle_s - 90.0) < 0.2


def test_two_green_windows_per_cycle():
    # 실제 2691처럼 한 주기에 보행 초록이 두 번 오는 신호
    t = 1_793_000_000.0 + np.arange(1400, dtype=float)
    ph = np.mod(t, 139.0)
    g = (((ph >= 0) & (ph < 27)) | ((ph >= 57) & (ph < 84))).astype(float)
    fit = fit_cycle(t, g)
    assert abs(fit.cycle_s - 139.0) < 0.3


def test_wait_prediction_matches_truth():
    t, g = synth()
    fit = fit_cycle(t, g)
    for q in t[200:260:7]:
        tw = true_wait(t, g, q)
        assert tw is not None and abs(fit.wait_s(q) - tw) <= 1.0


def test_evaluate_on_clean_signal():
    t, g = synth(span=2000)
    ev = evaluate(t, g)
    assert ev["stop_or_not_accuracy"] > 0.97 and ev["wait_mae_s"] < 1.0


def test_too_short_returns_none():
    t, g = synth(span=80)
    assert fit_cycle(t, g) is None


def test_samples_from_segments():
    segs = [
        {"state": "protected-Movement-Allowed", "start_utc": "2026-10-27T16:00:00.000Z", "end_utc": "2026-10-27T16:00:09.000Z"},
        {"state": "stop-And-Remain", "start_utc": "2026-10-27T16:00:10.000Z", "end_utc": "2026-10-27T16:00:19.000Z"},
        {"state": "unknown", "start_utc": "2026-10-27T16:00:20.000Z", "end_utc": "2026-10-27T16:00:29.000Z"},
    ]
    t, g = samples_from_segments(segs)
    assert len(t) == 20 and g[:10].sum() == 10 and g[10:].sum() == 0


def test_green_windows_two_per_cycle():
    from jjukgo.signal.cycle import green_windows

    t = 1_793_000_000.0 + np.arange(1400, dtype=float)
    ph = np.mod(t - t[0], 139.0)
    g = (((ph >= 10) & (ph < 37)) | ((ph >= 67) & (ph < 94))).astype(float)
    wins = green_windows(fit_cycle(t, g))
    assert len(wins) == 2
    assert [round(b - a) for a, b in sorted(wins)] == [27, 27]
    assert abs(sorted(wins)[0][0] - 10) <= 1
