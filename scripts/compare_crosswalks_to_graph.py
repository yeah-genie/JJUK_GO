# 서울 횡단보도 표준 자료(CSV)와 앱 보행 그래프의 횡단 간선(cls=5)을 위치·보행등으로 대조한다. D는 업로드 폴더.
import csv,json,math,glob,collections,statistics as st
D='/root/.claude/uploads/81d85301-0811-5800-b421-2042850d1c0b/'
K=111320*math.cos(math.radians(37.5));KY=110540
def dm(p,q):return math.hypot((p[0]-q[0])*K,(p[1]-q[1])*KY)
LON0,LAT0=126.58,37.35
C=[r for r in csv.DictReader(open(D+'1e3c2f45-_______________.csv',encoding='cp949')) if r['경도'] and r['위도']]
pts=[(float(r['경도']),float(r['위도']),r['보행등유무']) for r in C]
idx=collections.defaultdict(list)
for i,(x,y,_) in enumerate(pts): idx[(int(x*1000),int(y*1000))].append(i)
def near(p,R):
    b=(1e9,None)
    for dx in(-1,0,1):
        for dy in(-1,0,1):
            for i in idx.get((int(p[0]*1000)+dx,int(p[1]*1000)+dy),[]):
                d=dm(p,pts[i][:2])
                if d<b[0]:b=(d,i)
    return b if b[0]<=R else (None,None)
# OSM 횡단 간선 (앱 그래프 cls=5), 신호 연결 여부(e[5] 존재)
nodes={};E={}
for f in glob.glob('docs/prototype/seoul/graph/c*.json'):
    d=json.load(open(f))
    for r in d['n']:nodes[r[0]]=(LON0+r[1]/1e5,LAT0+r[2]/1e5)
    for e in d['e']:
        if e[3]==5:E[(e[0],e[1])]=e
osm=[(((nodes[a][0]+nodes[b][0])/2,(nodes[a][1]+nodes[b][1])/2),len(e)>5) for (a,b),e in E.items() if a in nodes and b in nodes]
print('앱 지도 횡단 간선',len(osm),'중 신호 연결',sum(s for _,s in osm))
hit=0;agree=collections.Counter()
for p,s in osm:
    d,i=near(p,15)
    if i is not None:
        hit+=1;agree[(s,pts[i][2])]+=1
print('서울시 횡단보도 15m 안에 있는 앱 횡단',hit,f'{100*hit/len(osm):.0f}%')
print('앱 신호연결 vs 서울시 보행등:',dict(agree))
# 반대로: 서울시 횡단보도 중 앱 횡단 간선 15m 안
oidx=collections.defaultdict(list)
for j,(p,_) in enumerate(osm): oidx[(int(p[0]*1000),int(p[1]*1000))].append(j)
cov=0
for x,y,_ in pts:
    ok=False
    for dx in(-1,0,1):
        for dy in(-1,0,1):
            for j in oidx.get((int(x*1000)+dx,int(y*1000)+dy),[]):
                if dm((x,y),osm[j][0])<15: ok=True;break
    cov+=ok
print('서울시 횡단보도 중 앱 지도에 15m 안 횡단이 있는 것',cov,'/',len(pts),f'{100*cov/len(pts):.0f}%')
ds=[];off=[]
for x,y,_ in pts[::5]:
    b=1e9;bp=None
    for dx in range(-2,3):
        for dy in range(-2,3):
            for j in oidx.get((int(x*1000)+dx,int(y*1000)+dy),[]):
                d=dm((x,y),osm[j][0])
                if d<b:b=d;bp=osm[j][0]
    ds.append(b)
    if b<60: off.append(((x-bp[0])*K,(y-bp[1])*KY))
ds.sort();n=len(ds)
print('서울시→앱 가장 가까운 횡단 거리: 중앙값',round(ds[n//2]),'m, 25%',round(ds[n//4]),'75%',round(ds[3*n//4]))
print('60m 안 쌍의 평균 어긋남(동,북 m)',round(st.mean(o[0] for o in off),1),round(st.mean(o[1] for o in off),1))
