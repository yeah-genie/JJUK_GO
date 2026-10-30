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
# 보행 코드 → 건너는 다리. 2026-10-29 검증(차량 직진 신호와 동시 초록 17건 중 16건 + T자 교차로 69곳): et=북쪽 다리, st=동쪽, wt=남쪽, nt=서쪽.
# 대각 코드(ne 등)는 확인하지 못해 쓰지 않는다('모름').
LEGS = {'et': 'n', 'st': 'e', 'wt': 's', 'nt': 'w'}
DIAGONAL = {}
# '초록'은 건너기 시작할 수 있는 고정 초록(protected-Movement-Allowed)만 뜻한다. permissive(초록 점멸로 추정, 확정 아님)는 빨강과 같이 '시작할 수 없는 때'로 센다.
# 그래서 예상 대기시간은 '다음 고정 초록 시작까지'이고, 건널 수 있는지는 말하지 않는다.
GREEN_STATES = ('protected',)
SAME_DAYTYPE_MIN_PAIRS = 1


def hour_samples(rows, lower, upper):
    """관측된 구간만 1초 표본으로(공백은 표본이 아니다). (t, g) 반환."""
    ts, gs = [], []
    for a, b, green, remaining in rows:
        lo, hi = max(a, lower), min(b + 1, upper)
        if hi <= lo:
            continue
        t = np.arange(lo, hi, 1.)
        ts.append(t)
        gs.append(np.full(len(t), green, dtype=float))
    if not ts:
        return None
    t, g = np.concatenate(ts), np.concatenate(gs)
    order = np.argsort(t)
    t, g = t[order], g[order]
    keep = np.r_[True, np.diff(t) > .5]
    return t[keep], g[keep]


def plan_accuracy(plan, t, g, day0_b):
    """다른 날 plan을 이 날 표본에 대보기. 앱과 같게 '하루 중 시각'으로 옮겨 위상을 구한다."""
    if t is None or len(t) < 300:
        return None
    wins = plan['win']
    c = plan['c']
    ph = np.mod(plan['day0'] + (t - day0_b) - plan['ref'], c)
    on = np.zeros(len(t), dtype=bool)
    for a, b in wins:
        on |= (ph >= a) & (ph < b)
        if b > c:
            on |= (ph + c >= a) & (ph + c < b)
    return float(np.mean(on == (g >= .5))), len(t)


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


def build_day(path, earlier=None):
    """earlier: {날짜: build_day 결과} 앞선 날들. 있으면 각 시간대 plan에 '앞선 날 plan을 이 날에 대본 일치율(xday)'을 붙인다."""
    CACHE.mkdir(parents=True, exist_ok=True)
    meta = path.with_name(path.name[:8] + '.json')
    kind = json.loads(meta.read_text()).get('source_kind', 'official') if meta.exists() else 'official'
    cache = CACHE / (path.name[:8] + ('-realtime' if kind == 'realtime' else '') + '.json')  # 실시간으로 채운 날이 공식 파일로 바뀌면 다시 계산
    if cache.exists():
        return json.loads(cache.read_text())
    date = datetime.strptime(path.name[:8], '%Y%m%d').replace(tzinfo=KST)
    day0 = date.timestamp()
    frame = pd.read_csv(path)
    frame['a'] = pd.to_datetime(frame.start_utc, utc=True).astype('datetime64[ns, UTC]').astype('int64') / 1e9
    frame['b'] = pd.to_datetime(frame.end_utc, utc=True).astype('datetime64[ns, UTC]').astype('int64') / 1e9
    frame['green'] = frame.state.str.startswith(GREEN_STATES)
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
                xday = []
                smp = None
                for other, prior_day in (earlier or {}).items():
                    prior = prior_day.get(str(ident), {}).get(str(hour), {}).get(direction)
                    if not prior:
                        continue
                    if smp is None:
                        smp = hour_samples(subset, day0 + hour * 3600, day0 + (hour + 1) * 3600) or (None, None)
                    acc = plan_accuracy(prior, smp[0], smp[1], day0)
                    if acc:
                        xday.append([prior['date'], round(acc[0], 4), acc[1]])
                result['xday'] = xday
                out.setdefault(str(ident), {}).setdefault(str(hour), {})[direction] = result
    cache.write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'date': path.name[:8], 'fitted_intersections': len(out), 'direction_hours': sum(len(d) for h in out.values() for d in h.values())}), flush=True)
    return out


def daytype(date):
    """'YYYY-MM-DD' → 'wd'(평일) / 'we'(주말). 공휴일은 구분하지 못한다."""
    return 'we' if datetime.strptime(date, '%Y-%m-%d').weekday() >= 5 else 'wd'


def compact_plan(p):
    """앱으로 보낼 plan: 날짜별 일치 목록(xday)을 같은 요일 종류끼리 요약 xd=[같은 종류 쌍 수, 중앙값, 최솟값, 다른 종류 쌍 수, 중앙값]로 줄인다."""
    out = {k: v for k, v in p.items() if k != 'xday'}
    if 'xday' in p:
        t = daytype(p['date'])
        same = sorted(a for d, a, n in p['xday'] if daytype(d) == t)
        other = sorted(a for d, a, n in p['xday'] if daytype(d) != t)
        med = lambda v: round(float(np.median(v)), 3) if v else None
        out['xd'] = [len(same), med(same), same[0] if same else None, len(other), med(other)]
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
                    for kind, legs in (('wd', band.get('legs', {})), ('we', band.get('legsWe', {}))):
                        directions = {(p['code'], kind): p for p in legs.values()}
                        merged.setdefault(ident, {}).setdefault(str(band['start'] // 3600), {}).update(directions)
    earlier = {}
    for path in sorted((ROOT / 'official-history').glob('????????.csv.gz')):
        date = path.name[:8]
        dates.append(date)
        day_result = build_day(path, dict(earlier))
        earlier[date] = day_result
        for ident, hours in day_result.items():
            for hour, directions in hours.items():
                prior = merged.setdefault(ident, {}).setdefault(hour, {})
                for direction, plan in directions.items():
                    # 평일 패턴과 주말 패턴을 따로 둔다(각각 가장 최근에 통과한 날짜). 앱은 오늘의 요일 종류에 맞는 쪽만 쓴다.
                    key = (direction, daytype(plan['date']))
                    if key not in prior or plan['date'] >= prior[key]['date']:
                        prior[key] = plan
    signals = {}
    for ident, hours in merged.items():
        bands = []
        for hour, directions in sorted(hours.items(), key=lambda item: int(item[0])):
            legs = {LEGS[d]: compact_plan(p) for (d, kind), p in directions.items() if d in LEGS and kind == 'wd'}
            legs_we = {LEGS[d]: compact_plan(p) for (d, kind), p in directions.items() if d in LEGS and kind == 'we'}
            # shortcut: C-ITS bearing-to-leg mapping is assumed; validate with MAP/field survey before live navigation.
            if legs or legs_we:
                band = {'start': int(hour) * 3600, 'end': (int(hour) + 1) * 3600, 'legs': legs}
                if legs_we:
                    band['legsWe'] = legs_we
                bands.append(band)
        if not bands:
            continue
        preferred = next((b for b in bands if b['start'] <= 31200 < b['end'] and b['legs']), next((b for b in bands if b['legs']), bands[-1]))
        base = next(iter(preferred['legs'].values()), None) or next(iter(preferred.get('legsWe', {}).values()))
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
