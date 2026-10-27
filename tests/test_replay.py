from jjukgo.viz.replay import H, W, Painter, Series, frame_times, pick_start, sample_at, state_kind


def make_series():
    # 초록(3초) → 점멸(2초) → 빨강(4초): 남은 시간이 상태 안에서 줄어든다
    t0 = 1_000_000.0
    rows = [(0, 3.0, "protected-Movement-Allowed"), (1, 2.0, "protected-Movement-Allowed"), (2, 1.0, "protected-Movement-Allowed"),
            (3, 2.0, "permissive-Movement-Allowed"), (4, 1.0, "permissive-Movement-Allowed"),
            (5, 4.0, "stop-And-Remain"), (6, 3.0, "stop-And-Remain"), (7, 2.0, "stop-And-Remain"), (8, 1.0, "stop-And-Remain")]
    return Series([t0 + r[0] for r in rows], [r[1] for r in rows], [r[2] for r in rows], "1", "et")


def test_state_kind():
    assert state_kind("stop-And-Remain") == "red"
    assert state_kind("protected-Movement-Allowed") == "green"
    assert state_kind("permissive-Movement-Allowed") == "blink"
    assert state_kind("unavailable") == "other"


def test_pick_start_is_first_red_start():
    s = make_series()
    assert pick_start(s) == s.t[5]


def test_sample_at_uses_last_sample():
    s = make_series()
    assert sample_at(s, s.t[3] + 0.5) == (2.0, "permissive-Movement-Allowed")
    assert sample_at(s, s.t[0] - 5) == (3.0, "protected-Movement-Allowed")


def test_frame_times_count():
    assert len(frame_times(0, 164, 8, 30)) == 615


def test_frame_colors_follow_state():
    s = make_series()
    p = Painter(s, s.t[0], 8, 1)
    cx, cy = W // 2, 430 - 180  # 원 위쪽(숫자와 겹치지 않는 곳)
    green = p.frame(s.t[1], 0)
    red = p.frame(s.t[6], 0)
    assert green.size == (W, H)
    assert green.getpixel((cx, cy))[1] > green.getpixel((cx, cy))[0]  # 초록이 우세
    assert red.getpixel((cx, cy))[0] > red.getpixel((cx, cy))[1]      # 빨강이 우세
