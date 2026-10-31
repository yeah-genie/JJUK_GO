"""Export duration-only history; never export a phase anchor for current countdowns."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'docs/prototype/seoul'


def eligible(r):
    return (r.get('observed_samples', 0) >= 900 and r.get('test_samples', 0) >= 300
            and r.get('holdout_accuracy', 0) >= .95 and r.get('impurity', 1) <= .02
            and math.isfinite(r.get('c', 0)) and r.get('c', 0) > 0
            and abs(r['c'] - round(r['c'])) <= .06
            and bool(r.get('win')) and all(0 <= a < b <= r['c'] for a, b in r['win']))


def main():
    result = {}
    for path in sorted((DATA / 'signal-hours').glob('*.json')):
        shard = json.loads(path.read_text(encoding='utf-8'))
        for signal, bands in shard.items():
            for band in bands:
                for key, day in [('legs', 'wd'), ('legsWe', 'we')]:
                    for direction, record in band.get(key, {}).items():
                        if not eligible(record):
                            continue
                        slot = result.setdefault(signal, {}).setdefault(direction, {})
                        old = slot.get(day)
                        rank = lambda r: (r.get('date', ''), r.get('test_samples', 0))
                        if old and rank(old) >= rank(record):
                            continue
                        fields = ['date', 'start', 'end', 'c', 'win', 'observed_samples',
                                  'test_samples', 'holdout_accuracy', 'impurity']
                        slot[day] = {k: record[k] for k in fields if k in record}
    out = ROOT / 'docs/prototype/reference-ui/signal-facts.json'
    manifest = json.loads((DATA / 'signal-plans.json').read_text(encoding='utf-8'))
    out.write_text(json.dumps({'kind': 'historical-duration-only; never live',
                              'source': manifest.get('source'), 'source_dates': manifest.get('source_dates', []),
                              'signals': result},
                              ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Saved duration-only history for {len(result)} controller IDs ({out.stat().st_size} bytes).')


if __name__ == '__main__':
    main()
