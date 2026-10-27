"""수집 대상 교차로 선택."""

from __future__ import annotations

import csv
import json
from pathlib import Path

ID_COLUMNS = ("itstid", "itst_id", "교차로id", "교차로아이디", "교차로_id", "교차로번호")
LAT_COLUMNS = ("lat", "latitude", "위도", "y", "mapctptlat")
LON_COLUMNS = ("lon", "lng", "lot", "longitude", "경도", "x", "mapctptlot")


def _find_column(header: list[str], candidates: tuple[str, ...]) -> str | None:
    normalized = {h.strip().lower().replace(" ", ""): h for h in header}
    for c in candidates:
        if c in normalized:
            return normalized[c]
    return None


def load_targets_csv(path: Path, bbox: list[float] | None) -> list[str]:
    """교차로 목록 CSV에서 bbox 안의 교차로 ID를 고른다. 열 이름은 자동 인식."""
    raw = Path(path).read_bytes()
    for encoding in ("utf-8-sig", "cp949"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError(f"{path}: 인코딩을 알 수 없습니다")
    reader = csv.DictReader(text.splitlines())
    header = reader.fieldnames or []
    id_col = _find_column(header, ID_COLUMNS)
    if id_col is None:
        raise ValueError(f"{path}: 교차로 ID 열을 찾지 못했습니다 (열: {header})")
    lat_col = _find_column(header, LAT_COLUMNS)
    lon_col = _find_column(header, LON_COLUMNS)

    ids = []
    for row in reader:
        if bbox and lat_col and lon_col:
            try:
                lat, lon = float(row[lat_col]), float(row[lon_col])
            except (TypeError, ValueError):
                continue
            lon_min, lat_min, lon_max, lat_max = bbox
            if not (lon_min <= lon <= lon_max and lat_min <= lat <= lat_max):
                continue
        itst = str(row[id_col]).strip()
        if itst and itst not in ids:
            ids.append(itst)
    return ids


def load_targets(cfg: dict, root: Path) -> list[str]:
    explicit = [str(x) for x in cfg.get("itst_ids", [])]
    if explicit:
        return explicit
    csv_path = cfg.get("targets_csv")
    if csv_path and (Path(root) / csv_path).exists():
        return load_targets_csv(Path(root) / csv_path, cfg.get("bbox"))
    return []


def round_robin(targets: list[str], cursor: int, n: int) -> tuple[list[str], int]:
    """cursor부터 n개를 순환하며 고르고, 다음 cursor를 돌려준다."""
    if not targets or n <= 0:
        return [], cursor
    n = min(n, len(targets))
    start = cursor % len(targets)
    picked = [targets[(start + i) % len(targets)] for i in range(n)]
    return picked, (start + n) % len(targets)


def load_cursor(data_dir: Path) -> int:
    path = Path(data_dir) / "meta" / "cursor.json"
    if path.exists():
        return int(json.loads(path.read_text(encoding="utf-8")).get("next_index", 0))
    return 0


def save_cursor(data_dir: Path, cursor: int) -> None:
    path = Path(data_dir) / "meta" / "cursor.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"next_index": cursor}), encoding="utf-8")
