"""수집한 보행신호 기록을 영상으로 다시 재생한다 (쓰레드/인스타용 4:5 세로 영상).

화면: 큰 신호등 원 + 남은 시간, 그 아래 톱니 모양 카운트다운 그래프(상태별 색 배경), 현재 시각 커서.
모든 값은 실제 수집한 `signals/*.csv.gz` 그대로이며 가짜 데이터를 섞지 않는다.
"""

from __future__ import annotations

import math
import subprocess
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1350
KST = timezone(timedelta(hours=9))

BG = (15, 23, 32)
PANEL = (24, 34, 46)
TEXT = (236, 241, 247)
MUTED = (140, 156, 173)
GREEN = (34, 197, 94)
GREEN_DIM = (22, 74, 46)
RED = (239, 68, 68)
GRAY = (100, 116, 139)

LABEL = {"green": "초록", "blink": "초록 점멸", "red": "빨강", "other": "-"}
BAND = {"green": (22, 74, 46), "blink": (40, 96, 62), "red": (88, 32, 38), "other": PANEL}
LINE = {"green": GREEN, "blink": (134, 239, 172), "red": RED, "other": GRAY}

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "C:/Windows/Fonts/malgunbd.ttf",
]


def find_font() -> str:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return path
    raise FileNotFoundError("한글 폰트를 찾지 못했습니다. fonts-noto-cjk 또는 fonts-nanum을 설치하세요.")


def state_kind(state: str) -> str:
    """신호 상태값 → 화면 색 종류.

    stop-And-Remain=빨강, protected-Movement-Allowed=초록, permissive-Movement-Allowed=초록 점멸.
    점멸은 남은 시간이 초록에서 끊김 없이 이어서 줄어드는 것으로 추정한 것이며 서울시 문서로 확인한 건 아니다.
    """
    s = str(state).lower()
    if s.startswith("stop"):
        return "red"
    if s.startswith("protected"):
        return "green"
    if s.startswith("permissive"):
        return "blink"
    return "other"


@dataclass
class Series:
    t: list[float]        # 절대 시각(UTC epoch 초)
    remaining_s: list[float]
    state: list[str]
    itst_id: str
    direction: str

    @property
    def kinds(self) -> list[str]:
        return [state_kind(s) for s in self.state]


def load_series(paths: list[Path], itst_id: str, direction: str, movement: str = "Pd") -> Series:
    frames = [pd.read_csv(p, dtype={"itst_id": str}) for p in paths]
    df = pd.concat(frames, ignore_index=True)
    df = df[(df.itst_id == str(itst_id)) & (df.direction == direction) & (df.movement == movement)]
    df = df[df.remaining_ds.notna() & (df.remaining_ds.astype(str) != "")]
    df = df.assign(t=df.trsm_utc.astype(float) / 1000).drop_duplicates("t").sort_values("t")
    if df.empty:
        raise ValueError(f"교차로 {itst_id} {direction} {movement} 데이터가 없습니다")
    return Series(
        t=df.t.tolist(),
        remaining_s=(df.remaining_ds.astype(float) / 10).tolist(),
        state=df.state.astype(str).tolist(),
        itst_id=str(itst_id),
        direction=direction,
    )


def pick_start(series: Series) -> float:
    """처음 나오는 '빨강 시작' 시각. 빨강 카운트다운부터 보여주면 이야기가 선다."""
    kinds = series.kinds
    for i in range(1, len(kinds)):
        if kinds[i] == "red" and kinds[i - 1] != "red":
            return series.t[i]
    return series.t[0]


def sample_at(series: Series, t: float) -> tuple[float, str]:
    """t 이전 마지막 표본의 (남은 시간 초, 상태)."""
    lo, hi = 0, len(series.t) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if series.t[mid] <= t:
            lo = mid
        else:
            hi = mid - 1
    return series.remaining_s[lo], series.state[lo]


def frame_times(start: float, duration: float, speed: float, fps: int) -> list[float]:
    n = int(duration / speed * fps)
    return [start + i * speed / fps for i in range(n)]


class Painter:
    def __init__(self, series: Series, start: float, duration: float, speed: float):
        font = find_font()
        self.f = lambda size: ImageFont.truetype(font, size)
        self.series, self.start, self.duration, self.speed = series, start, duration, speed
        self.ymax = max(60.0, math.ceil(max(series.remaining_s) / 10) * 10)
        self.box = (90, 790, 990, 1150)  # 그래프 영역
        self.idx = [i for i, t in enumerate(series.t) if start <= t <= start + duration]
        self.base = self._static_layer()

    # --- 그래프 좌표
    def _x(self, t: float) -> float:
        l, _, r, _ = self.box
        return l + (t - self.start) / self.duration * (r - l)

    def _y(self, rem: float) -> float:
        _, top, _, bottom = self.box
        return bottom - rem / self.ymax * (bottom - top)

    def _static_layer(self) -> Image.Image:
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        l, top, r, bottom = self.box
        d.text((90, 62), "쭉고 JJUK GO", font=self.f(44), fill=TEXT)
        d.rounded_rectangle((l - 20, top - 50, r + 20, bottom + 56), 28, fill=PANEL)
        d.text((l, top - 38), "남은 시간(초)", font=self.f(28), fill=MUTED)
        # 상태 구간 배경
        kinds = self.series.kinds
        i = 0
        ix = self.idx
        while i < len(ix):
            j = i
            while j + 1 < len(ix) and kinds[ix[j + 1]] == kinds[ix[i]]:
                j += 1
            x0 = self._x(self.series.t[ix[i]])
            x1 = self._x(self.series.t[ix[j + 1]] if j + 1 < len(ix) else self.start + self.duration)
            d.rectangle((x0, top, x1, bottom), fill=BAND[kinds[ix[i]]])
            i = j + 1
        # 눈금
        for v in range(0, int(self.ymax) + 1, 20):
            y = self._y(v)
            d.line((l, y, r, y), fill=(60, 76, 94), width=1)
            d.text((l - 6, y), str(v), font=self.f(24), fill=MUTED, anchor="rm")
        d.text((l, bottom + 14), "시간 흐름 →", font=self.f(26), fill=MUTED)
        return img

    def frame(self, t: float, n: int) -> Image.Image:
        img = self.base.copy()
        d = ImageDraw.Draw(img)
        rem, state = sample_at(self.series, t)
        kind = state_kind(state)
        l, top, r, bottom = self.box

        # 지금까지의 선 (같은 상태 구간 안에서만 이어 그려 톱니 모양이 살게 한다)
        pts = [i for i in self.idx if self.series.t[i] <= t]
        for a, b in zip(pts, pts[1:]):
            if self.series.state[a] != self.series.state[b]:
                continue
            d.line(
                (self._x(self.series.t[a]), self._y(self.series.remaining_s[a]),
                 self._x(self.series.t[b]), self._y(self.series.remaining_s[b])),
                fill=LINE[kind if self.series.state[a] == state else state_kind(self.series.state[a])], width=6,
            )
        cx = self._x(t)
        d.line((cx, top, cx, bottom), fill=TEXT, width=3)
        d.ellipse((cx - 11, self._y(rem) - 11, cx + 11, self._y(rem) + 11), fill=TEXT)

        # 신호등 원
        cxl, cyl, rad = W // 2, 430, 200
        lit = RED if kind == "red" else GREEN if kind in ("green", "blink") else GRAY
        if kind == "blink" and (n // 8) % 2 == 1:  # 점멸: 영상 시간 기준으로 깜빡
            d.ellipse((cxl - rad, cyl - rad, cxl + rad, cyl + rad), fill=GREEN_DIM, outline=GREEN, width=8)
        else:
            d.ellipse((cxl - rad - 14, cyl - rad - 14, cxl + rad + 14, cyl + rad + 14), fill=tuple(c // 3 for c in lit))
            d.ellipse((cxl - rad, cyl - rad, cxl + rad, cyl + rad), fill=lit)
        d.text((cxl, cyl - 6), str(math.ceil(rem)), font=self.f(240), fill=(255, 255, 255), anchor="mm")
        d.text((cxl, cyl + 150), "초", font=self.f(48), fill=(255, 255, 255), anchor="mm")
        d.text((cxl, 700), LABEL[kind], font=self.f(60), fill=TEXT, anchor="mm")

        # 실제 시각 / 상태값 / 캡션
        clock = datetime.fromtimestamp(t, KST).strftime("%H:%M:%S")
        d.text((W - 90, 70), clock, font=self.f(46), fill=TEXT, anchor="ra")
        d.text((W - 90, 128), "KST · 실제 시각", font=self.f(24), fill=MUTED, anchor="ra")
        d.text((90, 1215), f"상태값  {state}", font=self.f(30), fill=MUTED)
        d.text((90, 1265), f"실제 수집 데이터 · {self.speed:g}배속 · 교차로 {self.series.itst_id} ({self.series.direction})", font=self.f(32), fill=TEXT)
        d.text((90, 1308), "서울시 C-ITS 보행신호 API", font=self.f(26), fill=MUTED)
        return img


def _run(cmd: list[str], **kw):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, **kw)


def render(series: Series, out_dir: Path, name: str, start: float | None = None, duration: float = 164,
           speed: float = 8, fps: int = 30) -> dict[str, Path]:
    start = pick_start(series) if start is None else start
    painter = Painter(series, start, duration, speed)
    times = frame_times(start, duration, speed, fps)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    mp4, gif, png = out_dir / f"{name}.mp4", out_dir / f"{name}.gif", out_dir / f"{name}.png"

    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps),
         "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", str(mp4)],
        stdin=subprocess.PIPE,
    )
    thumb_at = len(times) // 5
    for n, t in enumerate(times):
        img = painter.frame(t, n)
        if n == thumb_at:
            img.save(png)
        ff.stdin.write(img.tobytes())
    ff.stdin.close()
    if ff.wait() != 0:
        raise RuntimeError("ffmpeg mp4 인코딩 실패")

    _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp4), "-vf",
          "fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
          str(gif)])
    return {"mp4": mp4, "gif": gif, "png": png}
