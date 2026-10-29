import json, sys, gzip
import numpy as np, pandas as pd
from datetime import datetime, timezone, timedelta
KST = timezone(timedelta(hours=9))
D = 'data/'
df = pd.read_csv(D+'20261027.csv.gz')
df['a'] = pd.to_datetime(df.start_utc, utc=True).astype('datetime64[ns, UTC]').astype('int64')/1e9
df['b'] = pd.to_datetime(df.end_utc, utc=True).astype('datetime64[ns, UTC]').astype('int64')/1e9
df['green'] = df.state.str.startswith(('protected','permissive'))
day0 = datetime(2026,10,27,tzinfo=KST).timestamp()
print('day0 target', day0, 'rows', len(df))
idx = {}
for (i, d), g in df.groupby(['itst_id','direction'], sort=False):
    idx[(str(int(i)), d)] = g[['a','b','green']].to_numpy()
def green_at(r, t_local, day0_fit=None):
    ph = (((r['day0'] + t_local - r['ref']) % r['c']) + r['c']) % r['c']
    for a,b in r['win']:
        for sh in (0, r['c']):
            if a <= ph+sh < b: return True
    return False
rows = []
for h in (8,9,10):
    shard = json.load(open(D+f'h{h:02d}.json'))
    for ident, bands in shard.items():
        for band in bands:
            for leg, r in band['legs'].items():
                key = (ident, r['code'])
                if key not in idx: continue
                if r['date'] == '2026-10-27': continue
                obs = idx[key]
                lo, hi = day0 + h*3600, day0 + (h+1)*3600
                ts=[];gs=[]
                for a,b,g in obs:
                    a2, b2 = max(a,lo), min(b,hi)
                    if b2 <= a2: continue
                    t = np.arange(a2, b2, 1.0)
                    ts.append(t); gs.append(np.full(len(t), g))
                if not ts: continue
                t = np.concatenate(ts); g = np.concatenate(gs)
                if len(t) < 120: continue
                pred = np.array([green_at(r, tt-day0) for tt in t])
                acc = float(np.mean(pred == g))
                base = float(max(g.mean(), 1-g.mean()))
                fit_day0 = r['day0']
                days = round((day0 - fit_day0)/86400)
                c = r['c']
                rows.append(dict(id=ident, code=r['code'], hour=h, date=r['date'], days=days, c=c, n=len(t), acc=acc, base=base, div=abs((86400/c)-round(86400/c))<0.01))
R = pd.DataFrame(rows)
print('legs tested', len(R), 'intersections', R.id.nunique())
print('mean acc', R.acc.mean().round(3), 'median', R.acc.median().round(3), 'baseline(majority)', R.base.mean().round(3))
print('share legs acc>=0.95', (R.acc>=.95).mean().round(3), ' >=0.8', (R.acc>=.8).mean().round(3), ' <=0.6', (R.acc<=.6).mean().round(3))
print(R.groupby('days').agg(n=('acc','size'), acc=('acc','mean'), ge95=('acc', lambda x:(x>=.95).mean())).round(3))
print(R.groupby('div').agg(n=('acc','size'), acc=('acc','mean'), ge95=('acc', lambda x:(x>=.95).mean())).round(3))
print(R.c.round(0).value_counts().head(12))
R.to_csv('xday_result.csv', index=False)
