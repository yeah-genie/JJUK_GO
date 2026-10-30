"""실시간 수집 구간 → 공식 일별 이력 형식 변환."""
import csv
import gzip
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('realtime_to_history', ROOT / 'scripts/realtime_to_history.py')
rt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rt)
HEADER = 'itst_id,direction,movement,state,start_utc,end_utc,rem_start_ds,rem_end_ds,samples\n'


def write(data_dir, kst_day, name, body):
    path = data_dir / 'segments' / kst_day / (name + '.csv.gz')
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, 'wt', encoding='utf-8') as f:
        f.write(HEADER + body)


def test_realtime_segments_become_official_format(tmp_path, monkeypatch):
    monkeypatch.setattr(rt, 'OUT', tmp_path / 'out')
    data = tmp_path / 'data'
    # 11/16 KST = 11/15 15:00Z ~ 11/16 15:00Z. 두 수집 실행이 같은 초록 구간을 겹쳐 받았다.
    write(data, '2026/11/16', '000500',
          '2217,et,Pd,protected-Movement-Allowed,2026-11-15T15:00:00.000Z,2026-11-15T15:00:10.000Z,300,200,11\n'
          '2217,et,St,protected-Movement-Allowed,2026-11-15T15:00:00.000Z,2026-11-15T15:00:10.000Z,300,200,11\n'
          '2217,et,Pd,stop-And-Remain,2026-11-15T14:59:00.000Z,2026-11-15T14:59:59.000Z,600,10,60\n')
    write(data, '2026/11/16', '001000',
          '2217,et,Pd,protected-Movement-Allowed,2026-11-15T15:00:05.000Z,2026-11-15T15:00:20.000Z,250,100,16\n'
          '2217,et,Pd,permissive-Movement-Allowed,2026-11-15T15:00:21.000Z,2026-11-15T15:00:30.000Z,90,1,10\n'
          '2217,et,Pd,dark,2026-11-15T15:01:00.000Z,2026-11-15T15:01:30.000Z,,,31\n')
    meta = rt.convert(data, '20261116')
    with gzip.open(tmp_path / 'out' / '20261116.csv.gz', 'rt', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    assert list(rows[0]) == rt.COLUMNS
    assert [(r['movement'], r['state'], r['start_utc'], r['end_utc'], r['samples']) for r in rows] == [
        ('pd', 'protected-Movement-Allowed', '2026-11-15T15:00:00.000Z', '2026-11-15T15:00:20.000Z', '21'),
        ('pd', 'permissive-Movement-Allowed', '2026-11-15T15:00:21.000Z', '2026-11-15T15:00:30.000Z', '10'),
    ]  # 전날(KST) 구간·직진(St)·꺼짐(dark)은 빠지고, 겹친 초록은 하나로
    assert meta['source_kind'] == 'realtime' and meta['pedestrian_ids'] == ['2217']


def test_official_day_is_never_overwritten(tmp_path, monkeypatch):
    monkeypatch.setattr(rt, 'OUT', tmp_path / 'out')
    (tmp_path / 'out').mkdir()
    (tmp_path / 'out' / '20261028.json').write_text(json.dumps({'date': '20261028', 'source': 'official'}))
    write(tmp_path / 'data', '2026/10/28', '120000',
          '2217,et,Pd,stop-And-Remain,2026-10-28T03:00:00.000Z,2026-10-28T03:00:10.000Z,100,1,11\n')
    assert rt.convert(tmp_path / 'data', '20261028') is None
    assert rt.missing_dates(tmp_path / 'data', today='20261030') == []


def test_official_import_replaces_realtime_day(monkeypatch, tmp_path):
    import import_official_history as history
    monkeypatch.setattr(history, 'OUT', tmp_path / 'out')
    monkeypatch.setattr(history, 'RAW', tmp_path / 'raw')
    history.OUT.mkdir()
    (history.OUT / '20261116.json').write_text(json.dumps({'date': '20261116', 'source_kind': 'realtime'}))
    (history.OUT / '20261116.csv.gz').write_bytes(b'')
    called = []
    def download(*a, **k):
        called.append(1)
        raise history.urllib.error.URLError('offline')
    monkeypatch.setattr(history.urllib.request, 'urlopen', download)
    monkeypatch.setattr(history.time, 'sleep', lambda s: None)
    try:
        history.import_day('20261116', '1')
    except history.urllib.error.URLError:
        pass
    assert called  # 실시간으로 채운 날은 건너뛰지 않고 공식 파일을 받으러 간다
