"""Fit bounded hourly baselines, retaining only patterns that pass held-out states."""
import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from jjukgo.signal.cycle import CycleFit, _impurity, green_windows

KST = timezone(timedelta(hours=9))
CACHE = ROOT / 'datastore/history/plans-v2'
LEGS = {'nt': 'n', 'et': 'e', 'st': 's', 'wt': 'w'}
DIAGONAL = {'ne': 'ne', 'nw': 'nw', 'se': 'se', 'sw': 'sw'}


def fit_hour(rows, lower, upper):
    # Each run contributes only its observed interval; gaps never become samples.
    ts, gs, ends = [], [], []
    for a, b, green, remaining in rows:
        lo, hi = max(a, lower), min(b + 1, upper)
        if hi <= lo:
            continue
        t = np.arange(lo, hi, 1.)
        ts.append(t)
        gs.append(np.full(len(t), green, dtype=float))
        if green and np.isfinite(remaining):
            ends.append((b, round(b + remaining / 10)))
    if not ts:
        return None
    t, g = np.concatenate(ts), np.concatenate(gs)
    order = np.argsort(t)
    t, g = t[order], g[order]
    keep = np.r_[True, np.diff(t) > .5]
    t, g = t[keep], g[keep]
    if len(t) < 400 or g.min() == g.max():
        return None
    cut = int(len(t) * .7)
    train, obs = t[:cut], g[:cut]
    test, truth = t[cut:], g[cut:]
    if train[-1] - train[0] < 150 or len(test) < 100 or truth.min() == truth.max():
        return None
    # Candidate periods come from repeated green endings, rather than a full grid.
    unique = np.array(sorted({end for observed, end in ends if observed <= train[-1]}))
    diffs = np.diff(unique)
    candidates = [c for c, n in Counter(diffs[(diffs >= 50) & (diffs <= 240)]).most_common(6) if n >= 2]
    if not candidates:
        return None
    fitted = []
    for c in candidates:
        for period in (float(c) - .02, float(c), float(c) + .02):
            imp, cov, profile = _impurity(train, obs, period, train[0])
            if imp > .02 or cov < .9 or train[-1] - train[0] < 2 * period:
                continue
            phase = np.floor(np.mod(test - train[0], period)).astype(int) % len(profile)
            prediction = np.nan_to_num(profile[phase], nan=0) >= .5
            accuracy = float(np.mean(prediction == truth))
            if accuracy < .95:
                continue
            fit = CycleFit(period, float(train[0]), 0., round(imp, 4), round(cov, 3), float(train[-1] - train[0]), len(train), profile)
            wins = green_windows(fit)
            if not wins:
                continue
            fitted.append((imp, period, accuracy, wins, fit))
    if not fitted:
        return None
    imp, period, accuracy, wins, fit = min(fitted, key=lambda x: (x[0], x[1]))
    return {'c': round(period, 3), 'ref': round(fit.t_ref, 3), 'win': wins, 'impurity': imp, 'holdout_accuracy': round(accuracy, 4), 'test_samples': len(test), 'observed_samples': len(t), 'observed_min': round(len(t) / 60, 1), 'from': datetime.fromtimestamp(t[0], KST).strftime('%m/%d %H:%M'), 'to': datetime.fromtimestamp(t[-1], KST).strftime('%m/%d %H:%M')}


def build_day(path):
    CACHE.mkdir(parents=True, exist_ok=True)
    cache = CACHE / (path.name[:8] + '.json')
    if cache.exists():
        return json.loads(cache.read_text())
    date = datetime.strptime(path.name[:8], '%Y%m%d').replace(tzinfo=KST)
    day0 = date.timestamp()
    frame = pd.read_csv(path)
    frame['a'] = pd.to_datetime(frame.start_utc, utc=True).astype('datetime64[ns, UTC]').astype('int64') / 1e9
    frame['b'] = pd.to_datetime(frame.end_utc, utc=True).astype('datetime64[ns, UTC]').astype('int64') / 1e9
    frame['green'] = frame.state.str.startswith(('protected', 'permissive'))
    out = {}
    for (ident, direction), group in frame.groupby(['itst_id', 'direction'], sort=False):
        rows = list(group[['a', 'b', 'green', 'rem_end_ds']].itertuples(index=False, name=None))
        # Only inspect hours that contain observations; no overnight extrapolation.
        hours = set(int((a - day0) // 3600) for a in group.a)
        for hour in sorted(hours & set(range(24))):
            subset = [r for r in rows if r[0] < day0 + (hour + 1) * 3600 and r[1] >= day0 + hour * 3600]
            result = fit_hour(subset, day0 + hour * 3600, day0 + (hour + 1) * 3600)
            if result:
                result.update(day0=day0, date=date.strftime('%Y-%m-%d'), code=direction, start=hour * 3600, end=(hour + 1) * 3600)
                out.setdefault(str(ident), {}).setdefault(str(hour), {})[direction] = result
    cache.write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'date': path.name[:8], 'fitted_intersections': len(out), 'direction_hours': sum(len(d) for h in out.values() for d in h.values())}), flush=True)
    return out


def publish(incremental=False):
    merged = {}
    dates = []
    index_path = ROOT / 'docs/prototype/seoul/signal-plans.json'
    if incremental and index_path.exists():
        dates.extend(json.loads(index_path.read_text())['source_dates'])
        for path in sorted((index_path.parent / 'signal-hours').glob('*.json')):
            for ident, bands in json.loads(path.read_text()).items():
                for band in bands:
                    directions = {p['code']: p for p in band['legs'].values()}
                    merged.setdefault(ident, {}).setdefault(str(band['start'] // 3600), {}).update(directions)
    for path in sorted((ROOT / 'official-history').glob('????????.csv.gz')):
        date = path.name[:8]
        dates.append(date)
        for ident, hours in build_day(path).items():
            for hour, directions in hours.items():
                prior = merged.setdefault(ident, {}).setdefault(hour, {})
                for direction, plan in directions.items():
                    if direction not in prior or plan['date'] >= prior[direction]['date']:
                        prior[direction] = plan
    signals = {}
    for ident, hours in merged.items():
        bands = []
        for hour, directions in sorted(hours.items(), key=lambda item: int(item[0])):
            legs = {LEGS[d]: p for d, p in directions.items() if d in LEGS}
            # shortcut: C-ITS bearing-to-leg mapping is assumed; validate with MAP/field survey before live navigation.
            for d, p in directions.items():
                for leg in DIAGONAL.get(d, ''):
                    legs.setdefault(leg, p)
            if legs:
                bands.append({'start': int(hour) * 3600, 'end': (int(hour) + 1) * 3600, 'legs': legs})
        if not bands:
            continue
        preferred = next((b for b in bands if b['start'] <= 31200 < b['end']), bands[-1])
        base = next(iter(preferred['legs'].values()))
        signals[ident] = {**base, 'dir': base['code'], 'legs': preferred['legs'], 'bands': bands}
    dates = sorted(set(dates))
    latest = max(dates)
    result = {'day0': datetime.strptime(latest, '%Y%m%d').replace(tzinfo=KST).timestamp(), 'date': latest[:4] + '-' + latest[4:6] + '-' + latest[6:], 'source_dates': dates, 'kind': 'hourly historical baseline; not live', 'source': 'Seoul T Data (BY), data_id=10382', 'signals': signals}
    folder = ROOT / 'docs/prototype/seoul/signal-hours'
    folder.mkdir(exist_ok=True)
    for hour in range(24):
        shard = {ident: [b for b in signal['bands'] if b['start'] == hour * 3600] for ident, signal in signals.items()}
        shard = {ident: bands for ident, bands in shard.items() if bands}
        (folder / f'{hour:02d}.json').write_text(json.dumps(shard, separators=(',', ':')), encoding='utf-8')
    result['signal_count'] = len(signals)
    result['signals'] = {}
    result['hours'] = list(range(24))
    dest = ROOT / 'docs/prototype/seoul/signal-plans.json'
    dest.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'published': len(signals), 'bytes': dest.stat().st_size, 'days': len(dates)}), flush=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--day', type=Path)
    ap.add_argument('--incremental', action='store_true')
    args = ap.parse_args()
    if args.day:
        build_day(args.day)
    else:
        publish(args.incremental)
