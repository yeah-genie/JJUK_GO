#!/usr/bin/env python3
"""수집 데이터에서 프로토타입 경로의 횡단보도별 실제 신호 패턴을 뽑아 프로토타입에 넣는다.

  PYTHONPATH=src python scripts/export_signal_plans.py datastore --write docs/prototype/src/app.js && python scripts/build_prototype.py

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
    # 광화문–시청 (주기 140.0초, 관측 37–156분). 방향 대응은 가정: 큰길을 건너는 보행신호로 본다.
    "1537": ["nw", "ne", "sw", "se"],
    "2691": ["wt", "et"],
    "1619": ["nw"],
    "2217": ["et", "se", "ne"],   # 역삼역에서 테헤란로를 건넘
    "2975": ["st", "sw", "se"],   # 테헤란로 남쪽 보도에서 옆길을 건넘
    "2219": ["st", "sw", "se"],
    "2974": ["st", "sw", "se"],
    "2212": ["wt", "sw", "nw"],   # 선릉역 서쪽에서 테헤란로를 건넘
    "4500": ["st", "sw", "se"],   # 북쪽 이면도로에서 옆길을 건넘
}
MARK = re.compile(r"/\*REAL_SIGNALS\*/.*?/\*END_REAL\*/", re.S)


# C-ITS 보행신호 방향 코드 → 지도에서 건너는 다리(n/e/s/w). 'nt'는 북쪽 다리 횡단보도로 본다(가정, 현장 확인 안 함).
# 대각 코드(ne 등)는 그 두 다리 중 'xt' 코드가 없는 쪽에만 쓴다.
LEG_OF = {"nt": "n", "et": "e", "st": "s", "wt": "w"}
DIAG = {"ne": "ne", "nw": "nw", "se": "se", "sw": "sw"}


def _plan(fit, t) -> dict:
    return {"c": round(fit.cycle_s, 3), "ref": round(fit.t_ref, 3),
            "win": [[round(a, 1), round(b, 1)] for a, b in green_windows(fit)]}


def build(data_dir: Path) -> dict:
    """확신 기준을 넘은 모든 교차로·방향의 패턴. 교차로마다 기본 패턴(dir)과 다리별 패턴(legs)을 둔다."""
    groups = load(data_dir)
    fits = {}
    for (itst, d), segs in groups.items():
        t, g = samples_from_segments(segs)
        if len(t) < 60:
            continue
        fit = fit_cycle(t, g)
        if fit is not None and fit.confident:
            fits.setdefault(itst, {})[d] = (fit, t)
    out = {}
    for itst, by_dir in fits.items():
        order = [d for d in PREFERRED.get(itst, []) if d in by_dir] or sorted(by_dir, key=lambda d: -(by_dir[d][1][-1] - by_dir[d][1][0]))
        d0 = order[0]
        fit, t = by_dir[d0]
        day0 = datetime.fromtimestamp(float(t[-1]), KST).replace(hour=0, minute=0, second=0, microsecond=0)
        legs = {}
        for d, (f, tt) in by_dir.items():
            if d in LEG_OF:
                legs[LEG_OF[d]] = {**_plan(f, tt), "code": d}
        for d, (f, tt) in by_dir.items():
            for leg in DIAG.get(d, ""):
                legs.setdefault(leg, {**_plan(f, tt), "code": d})
        out[itst] = {
            "dir": d0, **_plan(fit, t), "day0": day0.timestamp(),
            "impurity": fit.impurity, "observed_min": round((t[-1] - t[0]) / 60, 1),
            "from": datetime.fromtimestamp(t[0], KST).strftime("%m/%d %H:%M"),
            "to": datetime.fromtimestamp(t[-1], KST).strftime("%m/%d %H:%M"),
            "legs": legs,
        }
    last = max((v["day0"] for v in out.values()), default=None)
    # 교차로마다 관측한 날의 KST 자정(day0)을 기준으로 위상을 계산한다(며칠 넘게 외삽하면 주기 오차가 쌓인다)
    return {"day0": last, "date": datetime.fromtimestamp(last, KST).strftime("%Y-%m-%d") if last else None, "signals": out}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("data_dir", type=Path)
    ap.add_argument("--write", type=Path, help="프로토타입 HTML에 결과를 넣는다")
    a = ap.parse_args()
    res = build(a.data_dir)
    print(json.dumps({k: (v["dir"], round(v["c"], 1), v["observed_min"], sorted(v["legs"])) for k, v in res["signals"].items()}, ensure_ascii=False))
    if a.write:
        html = a.write.read_text(encoding="utf-8")
        assert MARK.search(html), "프로토타입에 /*REAL_SIGNALS*/ 표시가 없어요"
        html = MARK.sub("/*REAL_SIGNALS*/" + json.dumps(res, ensure_ascii=False) + "/*END_REAL*/", html)
        a.write.write_text(html, encoding="utf-8")
        print(f"{a.write}에 실제 신호 {len(res['signals'])}곳을 넣었어요")
    return 0


if __name__ == "__main__":
    sys.exit(main())
