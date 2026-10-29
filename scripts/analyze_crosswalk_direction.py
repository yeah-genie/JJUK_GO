# OA-21209 횡단 길이로 신호 방향 대응(동서/남북)을 통계로 검증하려는 시도. 입력: origin/data 의 oa21209_rows.csv.gz 를 /tmp/claude-0/x/rows.csv.gz 로 저장해 사용(임시 경로).
import csv,gzip,json,math,re,statistics as st
LON0,LAT0=126.58,37.35
rows=list(csv.DictReader(gzip.open('/tmp/claude-0/x/rows.csv.gz','rt',encoding='utf-8-sig')))
links=[]
for r in rows:
    w=r.get('LNKG_WKT') or ''
    if not w.startswith('LINESTRING'):continue
    pts=[tuple(map(float,p.split())) for p in re.findall(r'\(([^)]*)\)',w)[0].split(',')]
    L=float(r['LNKG_LEN'] or 0)
    links.append((pts,L,r['LNKG_TYPE_CD']))
# check length unit
def dm(a,b):
    return math.hypot((b[0]-a[0])*111320*math.cos(math.radians(37.5)),(b[1]-a[1])*110540)
ratios=[L/ sum(dm(p[i],p[i+1]) for i in range(len(p)-1)) for p,L,t in links if len(p)>1 and sum(dm(p[i],p[i+1]) for i in range(len(p)-1))>3]
print('len/geom ratio median',st.median(ratios),len(ratios))
sig=json.load(open('docs/prototype/seoul/signals.json'))
S={}
for h in range(8,11):
    d=json.load(open(f'docs/prototype/seoul/signal-hours/{h:02d}.json'))
    for k,v in d.items():
        for e in v:
            if e['start']<=h*3600<e['end']: S[k]=e['legs']
print('intersections w/ legs',len(S))
cx=[]
for g in sig:
    if str(g[0]) in S:
        cx.append((str(g[0]),g[1]/1e5+LON0,g[2]/1e5+LAT0))
print('cits w history',len(cx))
# grid index of link midpoints
idx={}
for i,(p,L,t) in enumerate(links):
    m=((p[0][0]+p[-1][0])/2,(p[0][1]+p[-1][1])/2)
    idx.setdefault((int(m[0]*500),int(m[1]*500)),[]).append((i,m))
def near(lon,lat,R=35):
    out=[]
    cxk,cyk=int(lon*500),int(lat*500)
    for dx in(-1,0,1):
        for dy in(-1,0,1):
            for i,m in idx.get((cxk+dx,cyk+dy),[]):
                if dm((lon,lat),m)<=R: out.append(i)
    return out
def green(leg):
    return sum(b-a for a,b in leg['win']) if leg.get('win') else None
XA=[];YA=[];XB=[];YB=[];n=0
for k,lon,lat in cx:
    legs=S[k]
    ew=[green(legs[x]) for x in 'ew' if x in legs and green(legs[x])]
    ns=[green(legs[x]) for x in 'ns' if x in legs and green(legs[x])]
    if not ew or not ns:continue
    near_i=near(lon,lat)
    ewl=[];nsl=[]
    for i in near_i:
        p,L,t=links[i]
        if t!='1000' and t!='1011' : pass
        dx=(p[-1][0]-p[0][0])*math.cos(math.radians(37.5));dy=p[-1][1]-p[0][1]
        if abs(dx)>abs(dy): ewl.append(L)   # 동서로 건너는 횡단보도
        else: nsl.append(L)
    if not ewl or not nsl:continue
    n+=1
    # 가설 same: 동서로 건너는 횡단보도 -> e/w 신호; perp: -> n/s 신호
    lenEWc=st.mean(ewl);lenNSc=st.mean(nsl);gEW=st.mean(ew);gNS=st.mean(ns)
    XA+= [lenEWc,lenNSc];YA+=[gEW,gNS]    # same
    XB+= [lenEWc,lenNSc];YB+=[gNS,gEW]    # perp
print('intersections used',n)
def corr(x,y):
    mx,my=st.mean(x),st.mean(y)
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/math.sqrt(sum((a-mx)**2 for a in x)*sum((b-my)**2 for b in y))
print('same corr',corr(XA,YA),'perp corr',corr(XB,YB))
# within-intersection difference test: sign agreement of (lenEW-lenNS) vs (gEW-gNS)
