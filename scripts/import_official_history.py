"""Stream official daily ZIPs into pedestrian-only state segments (no extraction).

  python scripts/import_official_history.py --date 20261027
  python scripts/import_official_history.py --all
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'official-history'
RAW = ROOT / 'datastore/history/raw'
PAGE = 'https://t-data.seoul.go.kr/dataprovide/trafficdataviewfile.do?data_id=10382'
DIRS = ('NT', 'ET', 'ST', 'WT', 'NE', 'SE', 'SW', 'NW')
COLUMNS = ['itst_id', 'direction', 'movement', 'state', 'start_utc', 'end_utc', 'rem_start_ds', 'rem_end_ds', 'samples']


def catalog():
    with urllib.request.urlopen(PAGE, timeout=60) as r:
        html = r.read().decode('utf-8')
    return {date: ident for ident, date in re.findall(r'<option[^>]*value=["\'](\d+)["\'][^>]*>\s*signalPhaseTimeFusion_(\d{8})\.zip', html)}


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def compact(frame, direction):
    """Keep observed runs only; gaps/resets/unknown states cannot become green time."""
    prefix = direction + '_PDSG_'
    f = frame[['ITST_ID', 'TRSM_UTC_TIME', prefix + 'STAT_NM', prefix + 'RMDR_CS']].copy()
    f.columns = ['id', 't', 'state', 'rem']
    f = f.dropna(subset=['id', 't', 'state'])
    f = f[f.state.isin(['protected-Movement-Allowed', 'permissive-Movement-Allowed', 'stop-And-Remain'])]
    if f.empty:
        return []
    f = f.sort_values(['id', 't']).drop_duplicates(['id', 't'])
    boundary = (f.id.ne(f.id.shift()) | f.state.ne(f.state.shift()) | f.t.diff().gt(5000) | f.rem.diff().gt(20))
    grouped = f.groupby(boundary.cumsum(), sort=False).agg(id=('id', 'first'), state=('state', 'first'), start=('t', 'first'), end=('t', 'last'), r0=('rem', 'first'), r1=('rem', 'last'), n=('t', 'size'))
    return [[str(int(i)), direction.lower(), 'pd', s, iso(a), iso(b), '' if pd.isna(r0) else int(r0), '' if pd.isna(r1) else int(r1), int(n)] for i, s, a, b, r0, r1, n in grouped.itertuples(index=False, name=None)]


def import_day(date, ident):
    OUT.mkdir(exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    meta_path = OUT / (date + '.json')
    target = OUT / (date + '.csv.gz')
    if meta_path.exists() and target.exists():
        return json.loads(meta_path.read_text(encoding='utf-8'))
    archive = RAW / ('signalPhaseTimeFusion_' + date + '.zip')
    url = 'https://t-data.seoul.go.kr/dataprovide/download.do?id=' + ident
    if not archive.exists():
        partial = archive.with_suffix('.part')
        with urllib.request.urlopen(url, timeout=120) as response, partial.open('wb') as dest:
            while chunk := response.read(4 * 1024 * 1024):
                dest.write(chunk)
        partial.replace(archive)
    digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    usecols = ['ITST_ID', 'TRSM_UTC_TIME'] + [d + '_PDSG_' + suffix for d in DIRS for suffix in ('STAT_NM', 'RMDR_CS')]
    rows = 0
    segments = []
    sample = []
    intersections = set()
    with zipfile.ZipFile(archive) as z:
        entries = [e for e in z.infolist() if e.filename.lower().endswith('.csv')]
        if len(entries) != 1:
            raise ValueError('Expected exactly one CSV in official ZIP')
        uncompressed = entries[0].file_size
        with z.open(entries[0]) as source:
            for f in pd.read_csv(source, usecols=usecols, chunksize=150000, low_memory=False):
                rows += len(f)
                intersections.update(str(int(x)) for x in f.ITST_ID.dropna().unique())
                for direction in DIRS:
                    segments.extend(compact(f, direction))
                print(json.dumps({'date': date, 'rows': rows, 'segments': len(segments)}), flush=True)
    segments.sort(key=lambda r: (r[0], r[1], r[4]))
    if not segments:
        raise ValueError('No pedestrian state data found; refuse empty publication')
    partial = target.with_suffix('.part')
    with gzip.open(partial, 'wt', encoding='utf-8', newline='') as dest:
        writer = csv.writer(dest)
        writer.writerow(COLUMNS)
        writer.writerows(segments)
    partial.replace(target)
    if not (OUT / 'sample.csv').exists():
        with (OUT / 'sample.csv').open('w', encoding='utf-8', newline='') as dest:
            writer = csv.writer(dest)
            writer.writerow(COLUMNS)
            writer.writerows(segments[:200])
    ped_ids = sorted({r[0] for r in segments}, key=int)
    meta = {'date': date, 'source': PAGE, 'download_url': url, 'sha256': digest, 'zip_bytes': archive.stat().st_size, 'csv_bytes': uncompressed, 'source_rows': rows, 'source_intersections': len(intersections), 'pedestrian_intersections': len(ped_ids), 'pedestrian_ids': ped_ids, 'direction_groups': len({(r[0], r[1]) for r in segments}), 'segments': len(segments), 'segment_bytes': target.stat().st_size, 'first_utc': min(r[4] for r in segments), 'last_utc': max(r[5] for r in segments), 'remaining_unit': 'decisecond (verified by adjacent 1s messages decreasing by about 10)', 'license': 'Seoul T Data attribution BY', 'kind': 'historical observations, not live signals'}
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in meta.items() if k != 'pedestrian_ids'}), flush=True)
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--remove-raw', action='store_true', help='Remove verified temporary ZIP after compact output is saved')
    args = ap.parse_args()
    available = catalog()
    if not available:
        raise ValueError('Official file catalog is empty')
    dates = sorted(available) if args.all else [args.date or max(available)]
    for date in dates:
        if date not in available:
            raise ValueError('Date not listed in official catalog: ' + date)
        import_day(date, available[date])
        if args.remove_raw:
            archive = RAW / ('signalPhaseTimeFusion_' + date + '.zip')
            if archive.resolve().parent != RAW.resolve():
                raise ValueError('Raw cleanup path escaped temporary directory')
            archive.unlink(missing_ok=True)
    summaries = [json.loads(p.read_text(encoding='utf-8')) for p in sorted(OUT.glob('????????.json'))]
    (OUT / 'manifest.json').write_text(json.dumps({'source': PAGE, 'available_dates': sorted(available), 'days': summaries}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
