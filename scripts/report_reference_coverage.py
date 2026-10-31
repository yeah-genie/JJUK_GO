"""Count bundled signal records near public landmarks; not a live coverage claim."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'docs/prototype/seoul'


def distance(x, y, lon, lat):
    return math.hypot((126.58 + x / 1e5 - lon) * 111320 * math.cos(math.radians(lat)),
                      (37.35 + y / 1e5 - lat) * 110540)


def main():
    signals = json.loads((DATA / 'signals.json').read_text(encoding='utf-8'))
    hours = {int(f.stem): json.loads(f.read_text(encoding='utf-8'))
             for f in (DATA / 'signal-hours').glob('*.json')}
    history = set().union(*(set(h) for h in hours.values()))
    report = {'snapshot': '2026-10-31 19h KST, origin default 67e7788',
              'location_records': len(signals), 'history_candidate_ids': len(history),
              'history_ids_with_location': sum(str(r[0]) in history for r in signals),
              'note': 'Records, not deduplicated physical pedestrian crossings. Presence is not confidence.',
              'areas': []}
    for name, lon, lat in [('성신여대입구역', 127.0163, 37.5927), ('혜화역', 127.0017, 37.5822),
                            ('강남역', 127.0276, 37.4979), ('홍대입구역', 126.924, 37.557)]:
        rows = [r for r in signals if distance(r[1], r[2], lon, lat) < 1000]
        report['areas'].append({'landmark': name, 'radius_m': 1000, 'locations': len(rows),
                               'any_hour_history': sum(str(r[0]) in history for r in rows),
                               'saturday_19h_history': sum(any(b.get('legsWe') for b in hours[19].get(str(r[0]), [])) for r in rows)})
    out = ROOT / 'reports/reference-ui/audit-2026-10-31/coverage.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Saved', out.relative_to(ROOT))


if __name__ == '__main__':
    main()
