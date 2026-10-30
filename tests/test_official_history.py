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
    monkeypatch.setattr(plans, 'build_day', lambda path, earlier=None: {'1537': {'8': {'nt': {**newer, 'date': '2026-10-14'}}}})
    plans.publish(incremental=True)
    result = json.loads((folder / '08.json').read_text())
    # 보행 코드 nt는 서쪽 다리를 건넌다(2026-10-29 검증). 2026-10-27(평일)과 2026-10-14(평일) 중 최신 날짜가 남는다.
    assert result['1537'][0]['legs']['w']['date'] == '2026-10-27'


def test_leg_mapping_and_daytype_split():
    spec = importlib.util.spec_from_file_location('plans_map', Path(__file__).parents[1] / 'scripts/export_history_plans.py')
    plans = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plans)
    # 직진 신호와 동시 초록 검증으로 정한 매핑: et=북, st=동, wt=남, nt=서. 대각 코드는 쓰지 않는다.
    assert plans.LEGS == {'et': 'n', 'st': 'e', 'wt': 's', 'nt': 'w'}
    assert plans.DIAGONAL == {}
    assert plans.daytype('2026-10-27') == 'wd' and plans.daytype('2026-10-24') == 'we'
    p = {'date': '2026-10-27', 'xday': [['2026-10-26', .99, 900], ['2026-10-24', .5, 900], ['2026-10-21', .97, 900]]}
    xd = plans.compact_plan(p)['xd']
    assert xd[0] == 2 and xd[2] == .97 and xd[3] == 1   # 같은 종류(평일) 2개, 다른 종류(주말) 1개


def test_plan_accuracy_uses_time_of_day_like_the_app():
    spec = importlib.util.spec_from_file_location('plans_acc', Path(__file__).parents[1] / 'scripts/export_history_plans.py')
    plans = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plans)
    import numpy as np
    plan = {'c': 100.0, 'ref': 0.0, 'day0': 1000.0, 'win': [[0.0, 30.0]]}
    day0_b = 5000.0                                   # 다른 날의 0시
    t = day0_b + np.arange(0, 1000.0)                 # 그날 0시부터 1000초
    tt = plan['day0'] + (t - day0_b)
    g = (np.mod(tt - plan['ref'], 100.0) < 30).astype(float)
    acc, n = plans.plan_accuracy(plan, t, g, day0_b)
    assert acc == 1.0 and n == 1000
    assert plans.plan_accuracy(plan, t, 1 - g, day0_b)[0] == 0.0
