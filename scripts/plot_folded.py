#!/usr/bin/env python3
"""신호 기록을 찾은 주기로 잘라 한 줄씩 쌓은 그림(phase folding). 초록 칸이 세로로 맞으면 주기가 맞은 것.

  PYTHONPATH=src python scripts/plot_folded.py datastore --itst 2691 --direction wt --out docs/assets/folded_2691_wt.png
"""

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from analyze_cycles import load  # noqa: E402
from jjukgo.signal.cycle import fit_cycle, samples_from_segments  # noqa: E402
from jjukgo.viz.replay import BG, GREEN, MUTED, RED, TEXT, find_font  # noqa: E402

KST = timezone(timedelta(hours=9))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("data_dir", type=Path)
    ap.add_argument("--itst", required=True)
    ap.add_argument("--direction", required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()

    segs = load(a.data_dir)[(a.itst, a.direction)]
    t, g = samples_from_segments(segs)
    fit = fit_cycle(t, g)
    if fit is None:
        print("주기를 찾을 만큼 기록이 없어요")
        return 1
    c = fit.cycle_s
    k = np.floor((t - fit.t_ref) / c).astype(int)
    ph = np.mod(t - fit.t_ref, c)
    rows = sorted(set(k))

    W, H = 1080, 1350
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    f = lambda s: ImageFont.truetype(find_font(), s)
    left, right, top, bottom = 90, W - 60, 300, H - 210
    cw = (right - left) / c
    rh = min(34, (bottom - top) / max(1, len(rows)))
    for i, kk in enumerate(rows):
        sel = k == kk
        y = top + i * rh
        for p_, gg in zip(ph[sel], g[sel]):
            x = left + p_ * cw
            d.rectangle((x, y, x + cw + 0.6, y + rh - 2), fill=GREEN if gg else RED)
    start = datetime.fromtimestamp(t[0], KST).strftime("%m/%d %H:%M")
    end = datetime.fromtimestamp(t[-1], KST).strftime("%H:%M")
    d.text((90, 70), "쭉고 JJUK GO", font=f(40), fill=TEXT)
    d.text((90, 140), f"교차로 {a.itst} 보행신호를 {c:.1f}초씩 잘라 쌓으면", font=f(40), fill=TEXT)
    d.text((90, 196), "초록 칸이 세로로 정확히 맞아요", font=f(40), fill=GREEN)
    for s in (0, 30, 60, 90, 120):
        if s < c:
            x = left + s * cw
            d.text((x, bottom + 14), f"{s}초", font=f(24), fill=MUTED)
    d.text((90, H - 140), f"실제 수집 데이터 · {start}–{end} KST · 수집 안 한 시간은 빼고 이어 붙임", font=f(26), fill=MUTED)
    d.text((90, H - 96), "서울시 C-ITS 보행신호 API · 한 줄 = 신호 한 바퀴", font=f(26), fill=MUTED)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    img.save(a.out)
    print(a.out, f"cycle={c:.2f}s rows={len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
