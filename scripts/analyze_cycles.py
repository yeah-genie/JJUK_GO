#!/usr/bin/env python3
"""수집한 신호 기록으로 횡단보도별 주기를 찾고 대기시간 예측 정확도를 잰다.

  PYTHONPATH=src python scripts/analyze_cycles.py datastore            # segments/ + signals/ 전부
  PYTHONPATH=src python scripts/analyze_cycles.py datastore --json out.json
"""

import argparse
import csv
import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from jjukgo.segments import to_segments  # noqa: E402
from jjukgo.signal.cycle import evaluate, fit_cycle, samples_from_segments  # noqa: E402


def load(data_dir: Path) -> dict:
    groups = defaultdict(list)
    for path in sorted(data_dir.glob("segments/**/*.csv.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for s in csv.DictReader(f):
                groups[(s["itst_id"], s["direction"])].append(s)
    raw = []
    for path in sorted(data_dir.glob("signals/**/*.csv.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            raw += list(csv.DictReader(f))
    for s in to_segments(raw):
        groups[(s["itst_id"], s["direction"])].append(s)
    return groups


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("data_dir", type=Path)
    ap.add_argument("--json", type=Path)
    a = ap.parse_args()
    rows = []
    for (itst, d), segs in sorted(load(a.data_dir).items()):
        t, g = samples_from_segments(segs)
        if len(t) == 0:
            continue
        fit = fit_cycle(t, g)
        ev = evaluate(t, g)
        rows.append({
            "itst_id": itst, "direction": d, "observed_min": round((t[-1] - t[0]) / 60, 1), "samples": len(t),
            "cycle_s": round(fit.cycle_s, 2) if fit else None, "green_s": fit.green_s if fit else None,
            "impurity": fit.impurity if fit else None, "confident": fit.confident if fit else False,
            "eval": ev,
        })
    print(f"{'교차로':>6} {'방향':>3} {'관측(분)':>7} {'주기(초)':>8} {'초록(초)':>7} {'불순도':>6} {'확신':>3} | 검증: 멈춤예측정확도 / 대기오차 평균·90%")
    for r in rows:
        ev = r["eval"] or {}
        print(f"{r['itst_id']:>6} {r['direction']:>3} {r['observed_min']:>7} {str(r['cycle_s']):>8} {str(r['green_s']):>7} "
              f"{str(r['impurity']):>6} {'예' if r['confident'] else '-':>3} | "
              + (f"{ev['stop_or_not_accuracy']:.0%} / {ev['wait_mae_s']}초 · {ev['wait_p90_s']}초 (검증 {ev['test_points']}점)" if ev else "검증할 만큼 길지 않음"))
    if a.json:
        a.json.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
