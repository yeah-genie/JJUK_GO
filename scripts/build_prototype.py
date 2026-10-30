"""프로토타입 소스(docs/prototype/src)를 한 파일(docs/prototype/index.html)로 합친다.

  python scripts/build_prototype.py

- template.html 안의 /*MAPLIBRE_CSS*/ 자리에 MapLibre 기본 CSS, /*APP_JS*/ 자리에 app.js를 넣는다.
- 실제 신호 패턴은 app.js 안 /*REAL_SIGNALS*/…/*END_REAL*/ 사이에 있다:
  PYTHONPATH=src python scripts/export_signal_plans.py datastore --write docs/prototype/src/app.js
- 지도·길찾기 데이터(docs/prototype/seoul/)는 저장소에 포함되어 있다. 재생성은 scripts/build_seoul_map.py를 쓴다.
"""
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "docs" / "prototype" / "src"
OUT = SRC.parent / "index.html"


def main():
    css = re.sub(r"/\*#\s*sourceMappingURL=.*?\*/", "", (SRC / "maplibre-gl.min.css").read_text(encoding="utf-8"))
    html = (SRC / "template.html").read_text(encoding="utf-8")
    app = (SRC / "app.js").read_text(encoding="utf-8")
    app = app.replace("/*WALKING_PROFILE*/", (SRC / "walking-profile.js").read_text(encoding="utf-8"), 1)
    app = app.replace("/*ASPHALT_UI*/", (SRC / "screens.js").read_text(encoding="utf-8"), 1)
    app += "\n" + (SRC / "walk-card.js").read_text(encoding="utf-8") + "\n" + (SRC / "external-search.js").read_text(encoding="utf-8") + "\n" + (SRC / "live-signals.js").read_text(encoding="utf-8")
    html = html.replace("/*MAPLIBRE_CSS*/", css, 1).replace("/*ASPHALT_CSS*/", (SRC / "asphalt.css").read_text(encoding="utf-8"), 1).replace("/*APP_JS*/", app, 1)
    OUT.write_text(html, encoding="utf-8")
    print(f"{OUT} ({len(html):,}자)")


if __name__ == "__main__":
    main()
