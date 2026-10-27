"""수집 결과 저장.

실행마다 signals/YYYY/MM/DD/HHMMSS.csv.gz (KST) 파일을 새로 만든다.
기존 파일을 고쳐 쓰지 않으므로 git 히스토리가 데이터 크기만큼만 늘어난다.
"""

from __future__ import annotations

import csv
import gzip
import io
from datetime import date, datetime
from pathlib import Path
from typing import Iterator

from . import KST
from .normalize import COLUMNS
from .segments import SEG_COLUMNS


def dedupe(rows: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for row in rows:
        key = (row["itst_id"], row["trsm_utc"] or row["collected_at_utc"], row["direction"], row["movement"])
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def write_part(data_dir: Path, rows: list[dict], collected_at: datetime) -> Path | None:
    rows = dedupe(rows)
    if not rows:
        return None
    local = collected_at.astimezone(KST)
    path = Path(data_dir) / "signals" / local.strftime("%Y/%m/%d") / f"{local.strftime('%H%M%S')}.csv.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    with gzip.open(path, "wt", encoding="utf-8", newline="") as f:
        f.write(buf.getvalue())
    return path


def read_day(data_dir: Path, day: date) -> Iterator[dict]:
    folder = Path(data_dir) / "signals" / day.strftime("%Y/%m/%d")
    for path in sorted(folder.glob("*.csv.gz")):
        with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
            yield from csv.DictReader(f)


def write_segments(data_dir: Path, segments: list[dict], collected_at: datetime) -> Path | None:
    """실행마다 segments/YYYY/MM/DD/HHMMSS.csv.gz (KST) 파일 하나."""
    if not segments:
        return None
    local = collected_at.astimezone(KST)
    path = Path(data_dir) / "segments" / local.strftime("%Y/%m/%d") / f"{local.strftime('%H%M%S')}.csv.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=SEG_COLUMNS)
    writer.writeheader()
    writer.writerows(segments)
    with gzip.open(path, "wt", encoding="utf-8", newline="") as f:
        f.write(buf.getvalue())
    return path


def read_segments_day(data_dir: Path, day: date) -> Iterator[dict]:
    folder = Path(data_dir) / "segments" / day.strftime("%Y/%m/%d")
    for path in sorted(folder.glob("*.csv.gz")):
        with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
            yield from csv.DictReader(f)
