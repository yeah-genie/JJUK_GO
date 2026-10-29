# 교차로 접근로(차로 좌표로 계산한 방위)와 OA-21209 횡단보도 선을 맞추고, 시계방향 한 칸 보행코드 가설로 코드를 붙여 센다.
# 입력: /tmp/claude-0/x/arms.json(analyze_signal_arms.py 결과), rows.csv.gz(origin/data 의 oa21209_rows.csv.gz)
import csv,gzip,json,math,re,collections,statistics as st
LON0,LAT0=126.58,37.35
A=json.load(open('/tmp/claude-0/x/arms.json'))
sig={str(g[0]):(g[1]/1e5+LON0,g[2]/1e5+LAT0,g[3]) for g in json.load(open('docs/prototype/seoul/signals.json'))}
links=[]
for r in csv.DictReader(gzip.open('/tmp/claude-0/x/rows.csv.gz','rt',encoding='utf-8-sig')):
    w=r.get('LNKG_WKT') or ''
    if not w.startswith('LINESTRING'):continue
    p=[tuple(map(float,q.split())) for q in re.findall(r'\(([^)]*)\)',w)[0].split(',')]
    links.append((p,float(r['LNKG_LEN'] or 0)))
K=111320*math.cos(math.radians(37.5));KY=110540
def xy(p,o):return ((p[0]-o[0])*K,(p[1]-o[1])*KY)
idx=collections.defaultdict(list)
for i,(p,L) in enumerate(links):
    m=((p[0][0]+p[-1][0])/2,(p[0][1]+p[-1][1])/2);idx[(int(m[0]*400),int(m[1]*400))].append((i,m))
G={'10':0,'20':90,'30':180,'40':270}
ROT={0:'e',90:'s',180:'w',270:'n'}   # 접근로 방위 -> 그 접근로를 건너는 횡단보도의 보행코드(가설)
legs=collections.defaultdict(set)
for h in range(24):
    d=json.load(open(f'docs/prototype/seoul/signal-hours/{h:02d}.json'))
    for k,v in d.items():
        for e in v:
            for l,x in e['legs'].items():
                if len(l)==1 and x.get('win') is not None: legs[k].add(l)
def angdiff(a,b):return abs((a-b+180)%360-180)
tot_arm=0;got=collections.Counter();lens=[];ok_hist=0;ok_one=0
per_inter=collections.Counter()
for i,arms in A.items():
    if i not in sig:continue
    lon,lat,name=sig[i];o=(lon,lat)
    for a,(b,g) in arms.items():
        if g not in G:continue
        tot_arm+=1
        cand=[]
        cx0,cy0=int(lon*400),int(lat*400)
        for dx in(-1,0,1):
            for dy in(-1,0,1):
                for j,m in idx.get((cx0+dx,cy0+dy),[]):
                    x,y=xy(m,o);dist=math.hypot(x,y)
                    if not(5<=dist<=50):continue
                    brg=(math.degrees(math.atan2(x,y))+360)%360
                    if angdiff(brg,G[g])>40:continue
                    p,L=links[j];x0,y0=xy(p[0],o);x1,y1=xy(p[-1],o)
                    lb=(math.degrees(math.atan2(x1-x0,y1-y0))+360)%360
                    # 횡단보도는 접근로 방향과 직각이어야 한다
                    if abs(angdiff(lb%180,G[g]%180)-90)>30:continue
                    if not(4<=L<=60):continue
                    cand.append((dist,L))
        n=len(cand);got[min(n,3)]+=1
        if n>=1:
            code=ROT[G[g]]
            if code in legs[i]: ok_hist+=1
            if n==1: ok_one+=1; lens.append(cand[0][1])
print('접근로(동서남북) 수',tot_arm)
print('맞는 횡단보도 후보 개수별(0,1,2,3+)',dict(sorted(got.items())))
print('후보 1개 이상이고 그 방향 신호 이력이 있는 접근로',ok_hist)
print('후보가 정확히 1개(모호하지 않음)',ok_one,'길이 중앙값',st.median(lens))
