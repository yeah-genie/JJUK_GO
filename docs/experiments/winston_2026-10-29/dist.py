import json, pandas as pd, datetime as dt
from collections import Counter
cnt=Counter(); tot=0; sigs=set(); legs_by_h={}
for h in (8,9,10):
    s=json.load(open(f'data/h{h:02d}.json'))
    n=0
    for ident,bands in s.items():
        for b in bands:
            for leg,r in b['legs'].items():
                # dedupe diag copies by code identity
                pass
            seen=set()
            for leg,r in b['legs'].items():
                k=(r['code'],r['date'],r['ref'])
                if k in seen: continue
                seen.add(k); cnt[r['date']]+=1; n+=1; sigs.add(ident)
    legs_by_h[h]=(len(s), n)
print(legs_by_h, 'unique intersections 8-10:', len(sigs))
wk=lambda d: dt.date.fromisoformat(d).weekday()>=5
we=sum(v for d,v in cnt.items() if wk(d)); T=sum(cnt.values())
for d,v in sorted(cnt.items()): print(d, dt.date.fromisoformat(d).strftime('%a'), v)
print('weekend-dated direction-hours', we, 'of', T, round(we/T,3))
R=pd.read_csv('xday_result.csv')
R['wkend']=R.date.map(wk)
print(R.groupby('wkend').agg(n=('acc','size'),acc=('acc','mean'),ge95=('acc',lambda x:(x>=.95).mean())).round(3))
# weekday-fit only
W=R[~R.wkend]
print('weekday-fit legs: mean',W.acc.mean().round(3),'ge95',(W.acc>=.95).mean().round(3),'n',len(W))
# by observation of c integer-ness
print(R.assign(cint=(R.c%1).abs().lt(0.05)).groupby('cint').acc.agg(['size','mean']).round(3))
