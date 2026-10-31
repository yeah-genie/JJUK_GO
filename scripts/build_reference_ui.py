"""Build the isolated image-reference prototype; never writes the production entry."""
import re
from pathlib import Path
from build_reference_signal_facts import main as build_signal_facts

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'docs/prototype/src'
OUT = ROOT / 'docs/prototype/reference-ui'

def main():
    build_signal_facts()
    app = (SRC / 'app.js').read_text(encoding='utf-8')
    app = app.replace('/*WALKING_PROFILE*/', (SRC / 'walking-profile.js').read_text(encoding='utf-8'), 1)
    app = app.replace('/*ASPHALT_UI*/', (SRC / 'screens.js').read_text(encoding='utf-8'), 1)
    # Keep engine functions intact. The prototype owns startup, presentation and storage.
    app = app.replace('\nboot();', '\n// Startup supplied by the isolated reference prototype.')
    app = app.replace('"jjukgo:" + k', '"jjukgo:reference:" + k')
    for name in ['walk-card.js', 'external-search.js', 'live-signals.js', 'signal-view.js']:
        app += '\n' + (SRC / name).read_text(encoding='utf-8')
    template = (SRC / 'template.html').read_text(encoding='utf-8')
    backend = template[template.index('<div class="phone"'):template.index('<script src=')]
    html = (OUT / 'shell.html').read_text(encoding='utf-8')
    html = html.replace('<!--ENGINE_DOM-->', backend)
    html = html.replace('/*MAP_CSS*/', (SRC / 'maplibre-gl.min.css').read_text(encoding='utf-8'))
    html = html.replace('/*ENGINE_JS*/', app)
    (OUT / 'index.html').write_text(html, encoding='utf-8')
    print('Built isolated reference-ui/index.html; production entry unchanged.')

if __name__ == '__main__':
    main()
