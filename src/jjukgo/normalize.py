"""API 원시 레코드 → 신호 단위 long 포맷 행.

필드 이름 규칙: {방향}{신호종류}sg{RmdrCs|StatNm}
  방향: nt ne et se st sw wt nw / 신호종류: Pd St Lt Ut Bs Bc
  RmdrCs = 잔여시간(1/10초), StatNm = 신호 상태
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

FIELD_RE = re.compile(r"^(nt|ne|et|se|st|sw|wt|nw)(Pd|St|Lt|Ut|Bs|Bc)sg(RmdrCs|StatNm)$")

COLUMNS = ["collected_at_utc", "trsm_utc", "itst_id", "direction", "movement", "state", "remaining_ds"]


def _empty(value) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _to_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def normalize(records: list[dict], collected_at: datetime, movements: list[str] | None = None) -> list[dict]:
    collected = collected_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = []
    for rec in records:
        signals: dict[tuple[str, str], dict] = {}
        for key, value in rec.items():
            m = FIELD_RE.match(key)
            if not m or _empty(value):
                continue
            direction, movement, kind = m.groups()
            if movements and movement not in movements:
                continue
            entry = signals.setdefault((direction, movement), {})
            if kind == "RmdrCs":
                entry["remaining_ds"] = _to_int(value)
            else:
                entry["state"] = str(value).strip()
        for (direction, movement), entry in sorted(signals.items()):
            rows.append({
                "collected_at_utc": collected,
                "trsm_utc": "" if _empty(rec.get("trsmUtcTime")) else str(rec["trsmUtcTime"]),
                "itst_id": str(rec.get("itstId", "")),
                "direction": direction,
                "movement": movement,
                "state": entry.get("state", ""),
                "remaining_ds": "" if entry.get("remaining_ds") is None else entry["remaining_ds"],
            })
    return rows
