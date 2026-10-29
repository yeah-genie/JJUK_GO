"""Run only after Release upload succeeds; metadata lets later jobs skip old ZIPs."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'official-history'
RELEASE = 'https://github.com/yeah-genie/JJUK_GO/releases/download/signal-history-sample-20261027/'


def mark():
    for path in ROOT.glob('????????.csv.gz'):
        meta_path = ROOT / (path.name[:8] + '.json')
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        with path.open('rb') as source:
            meta['segment_sha256'] = hashlib.file_digest(source, 'sha256').hexdigest()
        meta['archive_release_url'] = RELEASE + path.name
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    manifest_path = ROOT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['days'] = [json.loads(p.read_text(encoding='utf-8')) for p in sorted(ROOT.glob('????????.json')) if p.stem.isdigit()]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    mark()
