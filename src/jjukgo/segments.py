"""1초 간격 신호 메시지 → 상태 구간(run-length) 압축.

같은 신호(교차로·방향·종류)에서 상태가 이어지는 동안의 메시지를 한 줄로 묶는다.
잔여시간은 구간 안에서 일정하게 줄어들기 때문에 시작·끝 값만 남겨도 다시 그릴 수 있다.
1초 기록을 그대로 쌓으면 하루 수십 MB가 되지만, 구간으로 묶으면 수백 KB 수준이다.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

SEG_COLUMNS = ["itst_id", "direction", "movement", "state", "start_utc", "end_utc", "rem_start_ds", "rem_end_ds", "samples"]


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(ts * 1000) % 1000:03d}Z"


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_segments(rows: list[dict], max_gap_s: float = 5.0, jump_ds: int = 20) -> list[dict]:
    """정규화된 행(normalize 결과)을 상태 구간으로 묶는다.

    새 구간을 여는 경우: 상태가 바뀜, 메시지 사이가 max_gap_s 넘게 빔,
    같은 상태인데 잔여시간이 jump_ds(1/10초) 넘게 다시 늘어남(새 주기).
    """
    groups: dict[tuple, dict[float, tuple]] = defaultdict(dict)
    for r in rows:
        ms = _num(r.get("trsm_utc"))
        if ms is None:
            continue
        rem = _num(r.get("remaining_ds"))
        groups[(r["itst_id"], r["direction"], r["movement"])][ms / 1000] = (r["state"], None if rem is None else int(rem))

    out = []
    for (itst, direction, movement), by_time in groups.items():
        cur = None
        for t in sorted(by_time):
            state, rem = by_time[t]
            new = (
                cur is None
                or state != cur["state"]
                or t - cur["end"] > max_gap_s
                or (rem is not None and cur["rem_end"] is not None and rem > cur["rem_end"] + jump_ds)
            )
            if new:
                if cur:
                    out.append(cur)
                cur = {"itst_id": itst, "direction": direction, "movement": movement, "state": state,
                       "start": t, "end": t, "rem_start": rem, "rem_end": rem, "samples": 1}
            else:
                cur["end"], cur["rem_end"] = t, rem
                cur["samples"] += 1
        if cur:
            out.append(cur)

    return [{
        "itst_id": s["itst_id"], "direction": s["direction"], "movement": s["movement"], "state": s["state"],
        "start_utc": _iso(s["start"]), "end_utc": _iso(s["end"]),
        "rem_start_ds": "" if s["rem_start"] is None else s["rem_start"],
        "rem_end_ds": "" if s["rem_end"] is None else s["rem_end"],
        "samples": s["samples"],
    } for s in sorted(out, key=lambda s: (s["itst_id"], s["direction"], s["movement"], s["start"]))]
