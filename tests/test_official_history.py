import importlib.util
from pathlib import Path

import pandas as pd

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
