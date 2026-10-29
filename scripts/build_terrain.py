"""Build a coarse, offline terrain grid; no API key or user locations are sent.

Mapzen Terrain Tiles on AWS, Terrarium RGB. Sample at z12 / 4 pixels
(about 120m in Seoul). This estimates terrain, not street/bridge height.
"""
import io
import json
import math
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "docs/prototype/seoul"
ZOOM, STEP = 12, 4


def tile_xy(lon, lat):
    n = 2**ZOOM
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def height(rgb):
    return rgb[0] * 256 + rgb[1] + rgb[2] / 256 - 32768


def main():
    nodes = [n for p in (ROOT / "graph").glob("c*.json") for n in json.loads(p.read_text())["n"]]
    points = [tile_xy(126.58 + n[1] / 1e5, 37.35 + n[2] / 1e5) for n in nodes]
    tiles = sorted({(math.floor(x), math.floor(y)) for x, y in points})
    result = {"zoom": ZOOM, "step": STEP, "size": 64, "tiles": {}, "source": "Mapzen Terrain Tiles on AWS", "accessed": "2026-10-28"}
    for x, y in tiles:
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{x}/{y}.png"
        with urllib.request.urlopen(url, timeout=45) as response:
            img = Image.open(io.BytesIO(response.read())).convert("RGB")
        result["tiles"][f"{x}_{y}"] = [round(height(img.getpixel((px, py))), 1) for py in range(0, 256, STEP) for px in range(0, 256, STEP)]
        print(f"terrain {len(result['tiles'])}/{len(tiles)}", flush=True)
    (ROOT / "terrain.json").write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print("Wrote terrain.json")


if __name__ == "__main__":
    assert height((128, 0, 0)) == 0
    assert height((127, 255, 128)) == -0.5
    assert tile_xy(0, 0) == (2048, 2048)
    main()
