"""실시간 수집기(data 브랜치 segments/)의 보행 신호 구간을 공식 일별 이력과 같은 형식의 하루 파일로 만든다.

공식 일별 파일(T Data 10382)이 없는 날만 채운다. 나중에 공식 파일이 나오면 import_official_history.py가 덮어쓴다.
  - 열: itst_id,direction,movement,state,start_utc,end_utc,rem_start_ds,rem_end_ds,samples (공식 이력과 같음)
  - movement는 공식 이력처럼 소문자 'pd'. 보행(Pd)만 남긴다.
  - 하루 = 한국 시각 0시~24시(공식 파일과 같음). 수집 실행마다 겹쳐 받은 구간은 합친다.
  - 실시간 수집은 일부 교차로만 돌기 때문에 공식 파일보다 교차로 수가 적다.

  python scripts/realtime_to_history.py --data-dir <data 브랜치 경로> --date 20261116
  python scripts/realtime_to_history.py --data-dir <data 브랜치 경로> --missing   # 어제까지 빠진 날 모두
"""
import argparse
import csv
import gzip
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'official-history'
KST = timezone(timedelta(hours=9))
COLUMNS = ['itst_id', 'direction', 'movement', 'state', 'start_utc', 'end_utc', 'rem_start_ds', 'rem_end_ds', 'samples']
MAX_GAP_S, JUMP_DS = 5.0, 20  # segments.py, import_official_history.py와 같은 구간 경계
STATES = ('protected-Movement-Allowed', 'permissive-Movement-Allowed', 'stop-And-Remain')  # 공식 이력에 남기는 상태(dark 등은 뺀다)


def ts(iso):
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp()


def num(v):
    return None if v in ('', None) else int(float(v))


def read_rows(data_dir, date):
    """그 날(KST)에 걸칠 수 있는 수집 폴더(전날·당일·다음날)를 읽어 그 날 시작 구간만 돌려준다."""
    day = datetime.strptime(date, '%Y%m%d').replace(tzinfo=KST)
    lo, hi = day.timestamp(), (day + timedelta(days=1)).timestamp()
    for d in (day - timedelta(days=1), day, day + timedelta(days=1)):
        for path in sorted((Path(data_dir) / 'segments' / d.strftime('%Y/%m/%d')).glob('*.csv.gz')):
            with gzip.open(path, 'rt', encoding='utf-8', newline='') as f:
                for r in csv.DictReader(f):
                    if r['movement'].lower() != 'pd' or r['state'] not in STATES:
                        continue
                    a = ts(r['start_utc'])
                    if lo <= a < hi:
                        yield r


def merge(rows):
    """같은 신호·같은 상태가 끊김 없이 이어지면(겹침 포함) 한 구간으로 합친다."""
    out = []
    keyed = sorted(({**r, 'direction': r['direction'].lower(), 'movement': 'pd'} for r in rows),
                   key=lambda r: (int(r['itst_id']), r['direction'], r['start_utc'], r['end_utc']))
    for r in keyed:
        p = out[-1] if out else None
        if (p and (p['itst_id'], p['direction'], p['state']) == (r['itst_id'], r['direction'], r['state'])
                and ts(r['start_utc']) <= ts(p['end_utc']) + MAX_GAP_S):
            r0, prev_end = num(r['rem_start_ds']), num(p['rem_end_ds'])
            if r0 is None or prev_end is None or r0 <= prev_end + JUMP_DS or ts(r['start_utc']) <= ts(p['end_utc']):
                if r['end_utc'] > p['end_utc']:
                    overlap = ts(r['start_utc']) <= ts(p['end_utc'])
                    p['samples'] = int(p['samples']) + (0 if overlap else int(r['samples']))
                    if overlap:  # 겹친 만큼은 이미 센 표본이므로 늘어난 시간만큼만 더한다(1초 간격)
                        p['samples'] += max(0, round(ts(r['end_utc']) - ts(p['end_utc'])))
                    p['end_utc'], p['rem_end_ds'] = r['end_utc'], r['rem_end_ds']
                continue
        out.append(dict(r))
    return out


def is_official(date):
    meta = OUT / (date + '.json')
    return meta.exists() and json.loads(meta.read_text(encoding='utf-8')).get('source_kind') != 'realtime'


def convert(data_dir, date):
    if is_official(date):
        print(json.dumps({'date': date, 'skip': 'official file exists'}), flush=True)
        return None
    segments = merge(read_rows(data_dir, date))
    if not segments:
        print(json.dumps({'date': date, 'skip': 'no realtime pedestrian data'}), flush=True)
        return None
    OUT.mkdir(exist_ok=True)
    target = OUT / (date + '.csv.gz')
    partial = target.with_suffix('.part')
    with gzip.open(partial, 'wt', encoding='utf-8', newline='') as dest:
        writer = csv.writer(dest)
        writer.writerow(COLUMNS)
        writer.writerows([s[c] for c in COLUMNS] for s in segments)
    partial.replace(target)
    with target.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    ped_ids = sorted({s['itst_id'] for s in segments}, key=int)
    meta = {'date': date, 'source_kind': 'realtime', 'source': 'data branch segments/ (실시간 수집기, T Data 10381 또는 옛 실시간 API)',
            'segment_sha256': digest, 'pedestrian_intersections': len(ped_ids), 'pedestrian_ids': ped_ids,
            'direction_groups': len({(s['itst_id'], s['direction']) for s in segments}), 'segments': len(segments),
            'segment_bytes': target.stat().st_size, 'first_utc': min(s['start_utc'] for s in segments),
            'last_utc': max(s['end_utc'] for s in segments), 'remaining_unit': 'decisecond',
            'license': 'Seoul T Data attribution BY', 'kind': 'historical observations, not live signals',
            'note': '공식 일별 파일이 없는 날을 실시간 수집으로 채움. 공식 파일이 나오면 그것으로 바뀐다.'}
    (OUT / (date + '.json')).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in meta.items() if k != 'pedestrian_ids'}, ensure_ascii=False), flush=True)
    return meta


def missing_dates(data_dir, today=None):
    """수집 폴더가 있는 날 중 어제(KST)까지, 아직 이력 파일(공식이든 실시간이든)이 없는 날. 지난 날은 다시 만들지 않는다."""
    today = today or datetime.now(KST).strftime('%Y%m%d')
    found = {p.relative_to(Path(data_dir) / 'segments').as_posix().replace('/', '') for p in (Path(data_dir) / 'segments').glob('*/*/*')}
    return sorted(d for d in found if len(d) == 8 and d < today and not (OUT / (d + '.json')).exists())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data-dir', required=True)
    ap.add_argument('--date')
    ap.add_argument('--missing', action='store_true')
    args = ap.parse_args()
    for date in (missing_dates(args.data_dir) if args.missing else [args.date]):
        convert(args.data_dir, date)


if __name__ == '__main__':
    main()
