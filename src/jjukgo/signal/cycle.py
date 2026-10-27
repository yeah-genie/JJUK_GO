"""수집한 보행신호 기록에서 신호 주기를 찾고, 미래 시각의 대기시간을 예측한다.

방법(phase folding): 고정 주기 신호는 시각 t의 상태가 t mod C에만 달려 있다.
후보 주기 C마다 1초 단위 관측(초록=1, 빨강=0)을 C로 접어 같은 위상끼리 모았을 때
초록·빨강이 섞이지 않는(불순도가 가장 낮은) C가 진짜 주기다. 2C, 3C도 똑같이 깨끗하므로
거의 같은 점수면 가장 짧은 C를 고른다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

WALK_STATES = ("protected", "permissive")  # 보행 가능(초록·점멸)
STOP_STATES = ("stop",)


def state_is_green(state: str) -> bool | None:
    s = str(state).lower()
    if s.startswith(WALK_STATES):
        return True
    if s.startswith(STOP_STATES):
        return False
    return None


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def samples_from_segments(segments: list[dict], step: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """상태 구간 → (시각, 초록여부) 1초 표본. 구간 끝은 다음 메시지 직전(+step)까지 같은 상태로 본다."""
    ts, gs = [], []
    for s in segments:
        g = state_is_green(s["state"])
        if g is None:
            continue
        a, b = _ts(s["start_utc"]), _ts(s["end_utc"]) + step
        n = max(1, int(round((b - a) / step)))
        ts.append(a + np.arange(n) * step)
        gs.append(np.full(n, 1.0 if g else 0.0))
    if not ts:
        return np.array([]), np.array([])
    t = np.concatenate(ts)
    g = np.concatenate(gs)
    order = np.argsort(t)
    t, g = t[order], g[order]
    keep = np.concatenate([[True], np.diff(t) > 0.5])  # 겹치는 구간 중복 제거
    return t[keep], g[keep]


def _impurity(t: np.ndarray, g: np.ndarray, c: float, t_ref: float) -> tuple[float, float, np.ndarray]:
    # 위상은 관측 시작(t_ref) 기준으로 잰다. 1970년 기준으로 재면 주기의 아주 작은 차이도 수백만 바퀴 누적된다.
    nb = int(np.ceil(c))
    b = np.floor(np.mod(t - t_ref, c)).astype(int) % nb
    n = np.bincount(b, minlength=nb)
    s = np.bincount(b, weights=g, minlength=nb)
    with np.errstate(invalid="ignore", divide="ignore"):
        p = np.where(n > 0, s / n, np.nan)
    imp = float(np.nansum(n * p * (1 - p)) / max(1, len(t)))
    coverage = float((n > 0).mean())
    return imp, coverage, p


@dataclass
class CycleFit:
    cycle_s: float          # 반올림하지 않은 주기(예측에 그대로 쓴다)
    t_ref: float            # 위상 기준 시각
    green_s: float
    impurity: float          # 0이면 완벽히 주기적
    coverage: float          # 접었을 때 관측된 위상 비율
    span_s: float            # 관측 기간
    n: int                   # 표본 수
    profile: np.ndarray = field(repr=False)   # 위상(1초 칸)별 초록 비율

    @property
    def confident(self) -> bool:
        return self.impurity < 0.03 and self.coverage > 0.9 and self.span_s >= 2 * self.cycle_s

    def is_green(self, t: float) -> bool:
        p = self.profile[int(np.floor(np.mod(t - self.t_ref, self.cycle_s))) % len(self.profile)]
        return bool(np.nan_to_num(p, nan=0.0) >= 0.5)

    def wait_s(self, t: float) -> float:
        """시각 t에 횡단보도에 도착하면 몇 초 기다리는지(초록이면 0)."""
        if self.is_green(t):
            return 0.0
        nb = len(self.profile)
        ph = np.mod(t - self.t_ref, self.cycle_s)
        b0 = int(np.floor(ph)) % nb
        for k in range(1, nb + 1):
            if np.nan_to_num(self.profile[(b0 + k) % nb], nan=0.0) >= 0.5:
                return float(np.floor(ph) + k - ph)
        return float("nan")


def fit_cycle(t: np.ndarray, g: np.ndarray, c_min: float = 50, c_max: float = 240) -> CycleFit | None:
    if len(t) < 2 or t[-1] - t[0] < 2 * c_min or g.min() == g.max():
        return None
    span = float(t[-1] - t[0])
    t_ref = float(t[0])
    c_max = min(c_max, span / 2)
    grid = np.arange(c_min, c_max + 1e-9, 0.5)
    scores = []
    for c in grid:
        imp, cov, _ = _impurity(t, g, c, t_ref)
        scores.append(imp + (0.5 if cov < 0.8 else 0.0))
    scores = np.array(scores)
    best = scores.min()
    # 2C, 3C도 깨끗하게 접히므로 최솟값에 거의 같은 후보 중 가장 짧은 주기
    c0 = float(grid[np.argmax(scores <= best + 0.01)])
    fine = np.arange(c0 - 0.6, c0 + 0.6, 0.01)
    fs = np.array([_impurity(t, g, c, t_ref)[0] for c in fine])
    # 1초 표본으로는 주기가 조금 달라도 똑같이 깨끗하게 접힌다. 그 범위의 가운데를 고르면 외삽 오차가 가장 작다.
    tied = fine[fs <= fs.min() + 1e-4]
    c = float(np.median(tied))
    imp, cov, p = _impurity(t, g, c, t_ref)
    return CycleFit(cycle_s=c, t_ref=t_ref, green_s=float(np.nansum(np.nan_to_num(p) >= 0.5)), impurity=round(imp, 4),
                    coverage=round(cov, 3), span_s=round(span, 1), n=len(t), profile=p)


def true_wait(t_obs: np.ndarray, g_obs: np.ndarray, t: float, max_gap: float = 2.5) -> float | None:
    """실제 기록에서 t에 도착했을 때 기다린 시간. 다음 초록까지 기록이 끊기지 않았을 때만."""
    i = int(np.searchsorted(t_obs, t))
    if i >= len(t_obs) or (i > 0 and t - t_obs[i - 1] > max_gap and t_obs[i] - t > max_gap):
        return None
    j = i
    while j < len(t_obs):
        if j > i and t_obs[j] - t_obs[j - 1] > max_gap:
            return None
        if g_obs[j] >= 0.5:
            return max(0.0, float(t_obs[j] - t))
        j += 1
    return None


def evaluate(t: np.ndarray, g: np.ndarray, train_frac: float = 0.6, step: float = 3.0) -> dict | None:
    """앞부분으로 주기를 찾고, 뒷부분 시각마다 '도착하면 몇 초 기다리나'를 예측해 실제와 비교한다."""
    if len(t) < 10:
        return None
    cut = t[0] + (t[-1] - t[0]) * train_frac
    tr = t < cut
    fit = fit_cycle(t[tr], g[tr])
    if fit is None:
        return None
    errs, hits = [], []
    t_test, g_test = t[~tr], g[~tr]
    for q in np.arange(t_test[0], t_test[-1], step):
        tw = true_wait(t_test, g_test, q)
        if tw is None:
            continue
        pw = fit.wait_s(q)
        errs.append(abs(pw - tw))
        hits.append((pw > 2) == (tw > 2))
    if not errs:
        return None
    errs = np.array(errs)
    return {
        "cycle_s": round(fit.cycle_s, 2), "green_s": fit.green_s, "train_span_s": fit.span_s,
        "test_span_s": round(float(t_test[-1] - t_test[0]), 1), "test_points": len(errs),
        "stop_or_not_accuracy": round(float(np.mean(hits)), 3),
        "wait_mae_s": round(float(errs.mean()), 2), "wait_p90_s": round(float(np.percentile(errs, 90)), 2),
    }
