#!/usr/bin/env python3
"""수집 데이터로 신호 리플레이 영상(mp4/gif/png) 만들기.

  PYTHONPATH=src python scripts/make_replay.py datastore/signals/2026/10/28/*.csv.gz --itst 2691 --direction et
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from jjukgo.viz.replay import load_series, render  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("csv", nargs="+", type=Path, help="signals/*.csv.gz 파일들")
    p.add_argument("--itst", required=True)
    p.add_argument("--direction", required=True, help="nt ne et se st sw wt nw")
    p.add_argument("--start", type=float, help="시작 시각(UTC epoch 초). 기본: 첫 빨강 시작")
    p.add_argument("--duration", type=float, default=164, help="재생할 실제 시간(초)")
    p.add_argument("--speed", type=float, default=8)
    p.add_argument("--out-dir", type=Path, default=Path("docs/assets"))
    p.add_argument("--name")
    a = p.parse_args()

    series = load_series(a.csv, a.itst, a.direction)
    out = render(series, a.out_dir, a.name or f"replay_{a.itst}_{a.direction}", a.start, a.duration, a.speed)
    for kind, path in out.items():
        print(f"{kind}: {path} ({path.stat().st_size / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
