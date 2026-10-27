"""하루 API 호출 예산 관리.

사용량은 데이터 브랜치의 meta/usage/YYYY-MM-DD.json(KST 날짜)에 남겨서
매번 새로 뜨는 GitHub Actions 실행끼리도 공유한다.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path

from . import KST


@dataclass
class Usage:
    date: str
    calls: int = 0
    quota_hit: bool = False


class Budget:
    def __init__(self, data_dir: Path, now: datetime, daily_limit: int, collect_share: float):
        self.date = now.astimezone(KST).strftime("%Y-%m-%d")
        self.path = Path(data_dir) / "meta" / "usage" / f"{self.date}.json"
        self.collect_limit = math.floor(daily_limit * collect_share)
        if self.path.exists():
            self.usage = Usage(**json.loads(self.path.read_text(encoding="utf-8")))
        else:
            self.usage = Usage(date=self.date)

    @property
    def remaining(self) -> int:
        if self.usage.quota_hit:
            return 0
        return max(0, self.collect_limit - self.usage.calls)

    def record_call(self) -> None:
        self.usage.calls += 1

    def mark_quota_hit(self) -> None:
        self.usage.quota_hit = True

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(asdict(self.usage), ensure_ascii=False, indent=2), encoding="utf-8")


def run_allowance(remaining: int, now: datetime, interval_min: int, peak_hours: list[int], peak_weight: float) -> int:
    """이번 실행에서 쓸 호출 수.

    남은 예산을 오늘 남은 실행 슬롯들에 가중치대로 나눈 몫이다.
    실행이 밀리거나 빠지면 남은 슬롯이 줄어 다음 실행 몫이 자동으로 커지고,
    마지막 슬롯은 남은 예산을 모두 가져간다.
    """
    if remaining <= 0:
        return 0
    now = now.astimezone(KST)
    end = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    weights = []
    t = now
    while t < end:
        weights.append(peak_weight if t.hour in peak_hours else 1.0)
        t += timedelta(minutes=interval_min)
    return min(remaining, math.floor(remaining * weights[0] / sum(weights)))
