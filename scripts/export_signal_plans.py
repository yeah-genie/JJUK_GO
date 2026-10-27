#!/usr/bin/env python3
"""수집 데이터에서 프로토타입 경로의 횡단보도별 실제 신호 패턴을 뽑아 프로토타입에 넣는다.

  PYTHONPATH=src python scripts/export_signal_plans.py datastore --write docs/prototype/index.html

횡단보도 ↔ 신호 방향 대응은 아직 서울시 방향 규칙으로 확인하지 않은 가정이다:
테헤란로를 따라 걸으며 옆길을 건너면 남쪽(st) 보행신호, 테헤란로를 건너면 동·서(et/wt) 보행신호로 본다.
선호 방향에 데이터가 없으면 가까운 방향을 쓴다.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from analyze_cycles import load  # noqa: E402
from jjukgo.signal.cycle import fit_cycle, green_windows, samples_from_segments  # noqa: E402

KST = timezone(timedelta(hours=9))
PREFERRED = {
    "2217": ["et", "se", "ne"],   # 역삼역에서 테헤란로를 건넘
    "2975": ["st", "sw", "se"],   # 테헤란로 남쪽 보도에서 옆길을 건넘
    "2219": ["st", "sw", "se"],
    "2974": ["st", "sw", "se"],
    "2212": ["wt", "sw", "nw"],   # 선릉역 서쪽에서 테헤란로를 건넘
    "4500": ["st", "sw", "se"],   # 북쪽 이면도로에서 옆길을 건넘
}
MARK = re.compile(r"/\*REAL_SIGNALS\*/.*?/\*END_REAL\*/", re.S)


def build(data_dir: Path) -> dict:
    groups = load(data_dir)
    out, last = {}, 0.0
    for itst, dirs in PREFERRED.items():
        for d in dirs:
            segs = groups.get((itst, d))
            if not segs:
                continue
            t, g = samples_from_segments(segs)
            fit = fit_cycle(t, g)
            if fit is None or not fit.confident:
                continue
            out[itst] = {
                "dir": d, "c": round(fit.cycle_s, 3), "ref": round(fit.t_ref, 3),
                "win": [[round(a, 1), round(b, 1)] for a, b in green_windows(fit)],
                "impurity": fit.impurity, "observed_min": round((t[-1] - t[0]) / 60, 1),
                "from": datetime.fromtimestamp(t[0], KST).strftime("%m/%d %H:%M"),
                "to": datetime.fromtimestamp(t[-1], KST).strftime("%m/%d %H:%M"),
            }
            last = max(last, float(t[-1]))
            break
    # 프로토타입은 '오늘 08:40 출발'을 계산하므로, 마지막 관측일의 KST 자정을 기준으로 삼는다
    day0 = datetime.fromtimestamp(last, KST).replace(hour=0, minute=0, second=0, microsecond=0) if last else None
    return {"day0": day0.timestamp() if day0 else None, "date": day0.strftime("%Y-%m-%d") if day0 else None, "signals": out}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("data_dir", type=Path)
    ap.add_argument("--write", type=Path, help="프로토타입 HTML에 결과를 넣는다")
    a = ap.parse_args()
    res = build(a.data_dir)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if a.write:
        html = a.write.read_text(encoding="utf-8")
        assert MARK.search(html), "프로토타입에 /*REAL_SIGNALS*/ 표시가 없어요"
        html = MARK.sub("/*REAL_SIGNALS*/" + json.dumps(res, ensure_ascii=False) + "/*END_REAL*/", html)
        a.write.write_text(html, encoding="utf-8")
        print(f"{a.write}에 실제 신호 {len(res['signals'])}곳을 넣었어요")
    return 0


if __name__ == "__main__":
    sys.exit(main())
