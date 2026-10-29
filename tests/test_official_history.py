import importlib.util
import io
import json
from pathlib import Path

import pandas as pd
import pytest

spec = importlib.util.spec_from_file_location('history', Path(__file__).parents[1] / 'scripts/import_official_history.py')
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


def test_pedestrian_runs_split_on_gap_reset_and_state():
    f = pd.DataFrame({'ITST_ID': [1537]*6, 'TRSM_UTC_TIME': [100000, 101000, 102000, 110000, 111000, 112000], 'NT_PDSG_STAT_NM': ['stop-And-Remain']*4 + ['protected-Movement-Allowed']*2, 'NT_PDSG_RMDR_CS': [100, 90, 200, 100, 300, 290]})
    rows = history.compact(f, 'NT')
    assert [r[-1] for r in rows] == [2, 1, 1, 2]
    assert all(r[2] == 'pd' for r in rows)
    f.loc[:, 'NT_PDSG_STAT_NM'] = 'unavailable'
    assert history.compact(f, 'NT') == []


def test_hourly_fit_requires_holdout_and_never_fills_gaps():
    spec = importlib.util.spec_from_file_location('plans', Path(__file__).parents[1] / 'scripts/export_history_plans.py')
    plans = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plans)
    start = 1793026800.
    rows = []
    for cycle in range(15):
        t = start + cycle * 120
        rows.extend([(t, t + 29, True, 10), (t + 30, t + 119, False, 10)])
    result = plans.fit_hour(rows, start, start + 3600)
    assert result is not None
    assert abs(result['c'] - 120) < .05
    assert result['holdout_accuracy'] >= .95
    assert plans.fit_hour(rows[:2], start, start + 3600) is None


def test_incomplete_download_never_publishes(monkeypatch, tmp_path):
    monkeypatch.setattr(history, 'OUT', tmp_path / 'out')
    monkeypatch.setattr(history, 'RAW', tmp_path / 'raw')
    monkeypatch.setattr(history.time, 'sleep', lambda seconds: None)
    class TruncatedResponse(io.BytesIO):
        headers = {'Content-Length': '500'}
    monkeypatch.setattr(history.urllib.request, 'urlopen', lambda *a, **k: TruncatedResponse(b'PK-incomplete'))
    with pytest.raises(history.zipfile.BadZipFile):
        history.import_day('20261028', '15984')
    assert not (history.OUT / '20261028.json').exists()
    assert not (history.OUT / '20261028.csv.gz').exists()
    assert not list(history.RAW.glob('*.zip'))


def test_archived_day_skips_original_download(monkeypatch, tmp_path):
    monkeypatch.setattr(history, 'OUT', tmp_path / 'out')
    monkeypatch.setattr(history, 'RAW', tmp_path / 'raw')
    history.OUT.mkdir()
    meta = {'date': '20261027', 'archive_release_url': 'https://github.com/yeah-genie/JJUK_GO/releases/download/signal-history-sample-20261027/20261027.csv.gz'}
    (history.OUT / '20261027.json').write_text(json.dumps(meta))
    def unexpected(*args, **kwargs):
        raise AssertionError('Archived dates must not download ZIPs again')
    monkeypatch.setattr(history.urllib.request, 'urlopen', unexpected)
    assert history.import_day('20261027', '15973') == meta


def test_incremental_export_preserves_newer_seed(monkeypatch, tmp_path):
    spec = importlib.util.spec_from_file_location('plans_incremental', Path(__file__).parents[1] / 'scripts/export_history_plans.py')
    plans = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plans)
    monkeypatch.setattr(plans, 'ROOT', tmp_path)
    folder = tmp_path / 'docs/prototype/seoul/signal-hours'
    folder.mkdir(parents=True)
    newer = {'date': '2026-10-27', 'code': 'nt', 'c': 120}
    (folder / '08.json').write_text(json.dumps({'1537': [{'start': 28800, 'end': 32400, 'legs': {'n': newer}}]}))
    (folder.parent / 'signal-plans.json').write_text(json.dumps({'source_dates': ['20261027']}))
    (tmp_path / 'official-history').mkdir()
    (tmp_path / 'official-history/20261014.csv.gz').touch()
    monkeypatch.setattr(plans, 'build_day', lambda path: {'1537': {'8': {'nt': {**newer, 'date': '2026-10-14'}}}})
    plans.publish(incremental=True)
    result = json.loads((folder / '08.json').read_text())
    assert result['1537'][0]['legs']['n']['date'] == '2026-10-27'
