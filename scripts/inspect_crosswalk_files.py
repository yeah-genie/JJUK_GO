# 사용자가 올린 서울 횡단보도 자료 2종(전국 표준 서울분 CSV, OA-23081 XLSX)을 점검한다. D는 업로드 폴더(재실행 시 경로를 바꿔야 함).
import csv,json,math,collections,openpyxl,statistics as st,glob
D='/root/.claude/uploads/81d85301-0811-5800-b421-2042850d1c0b/'
# TM 역변환 (EPSG:5186: GRS80, 중부원점 127E 38N, k=1, FE=200000, FN=600000)
a=6378137.0;f=1/298.257222101;e2=f*(2-f);ep2=e2/(1-e2)
lat0=math.radians(38);lon0=math.radians(127);k0=1;FE=200000;FN=600000
def M(phi):
    return a*((1-e2/4-3*e2**2/64-5*e2**3/256)*phi-(3*e2/8+3*e2**2/32+45*e2**3/1024)*math.sin(2*phi)+(15*e2**2/256+45*e2**3/1024)*math.sin(4*phi)-(35*e2**3/3072)*math.sin(6*phi))
M0=M(lat0)
def inv(x,y):
    m=M0+(y-FN)/k0;mu=m/(a*(1-e2/4-3*e2**2/64-5*e2**3/256))
    e1=(1-math.sqrt(1-e2))/(1+math.sqrt(1-e2))
    p1=mu+(3*e1/2-27*e1**3/32)*math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*math.sin(4*mu)+(151*e1**3/96)*math.sin(6*mu)
    C1=ep2*math.cos(p1)**2;T1=math.tan(p1)**2;N1=a/math.sqrt(1-e2*math.sin(p1)**2);R1=a*(1-e2)/(1-e2*math.sin(p1)**2)**1.5
    D_=(x-FE)/(N1*k0)
    lat=p1-(N1*math.tan(p1)/R1)*(D_**2/2-(5+3*T1+10*C1-4*C1**2-9*ep2)*D_**4/24)
    lon=lon0+(D_-(1+2*T1+C1)*D_**3/6)/math.cos(p1)
    return math.degrees(lon),math.degrees(lat)
K=111320*math.cos(math.radians(37.5));KY=110540
def dm(p,q):return math.hypot((p[0]-q[0])*K,(p[1]-q[1])*KY)
# CSV (전국 표준 서울분)
C=list(csv.DictReader(open(D+'1e3c2f45-_______________.csv',encoding='cp949')))
print('CSV 행',len(C)); print(' 종류',collections.Counter(r['횡단보도종류'] for r in C).most_common(6))
for k in('보행등유무','음향신호기설치여부','고원식횡단보도유무','보행자작동신호기유무'): print(' ',k,collections.Counter(r[k] for r in C))
print(' 기준일',collections.Counter(r['데이터기준일자'][:7] for r in C).most_common(4))
cmap={r['횡단보도관리번호']:(float(r['경도']),float(r['위도'])) for r in C if r['경도'] and r['위도']}
# XLSX (OA-23081)
ws=openpyxl.load_workbook(D+'63931dde-_______________________20260824.xlsx',read_only=True).worksheets[0]
X=[dict(zip(['n','gu','id','itst','kind','ped','name','x','y'],r)) for i,r in enumerate(ws.iter_rows(values_only=True)) if i]
print('XLSX 행',len(X)); print(' 종류',collections.Counter(r['kind'] for r in X).most_common(5)); print(' 보행등',collections.Counter(r['ped'] for r in X))
print(' 교차로번호 고유',len({r['itst'] for r in X}))
print(' 좌표 없음',sum(1 for r in X if not r['x'] or not r['y']))
X=[r for r in X if r['x'] and r['y']]
ds=[];both=0
for r in X:
    r['ll']=inv(float(r['x']),float(r['y']))
    if r['id'] in cmap: both+=1; ds.append(dm(r['ll'],cmap[r['id']]))
print('XLSX∩CSV 번호 일치',both,'좌표 차 중앙값 m',round(st.median(ds),2),'90%',round(sorted(ds)[int(.9*len(ds))],2))
# 교차로관리번호 vs C-ITS ITST_ID
LON0,LAT0=126.58,37.35
sig={str(g[0]):((g[1]/1e5+LON0,g[2]/1e5+LAT0),g[3]) for g in json.load(open('docs/prototype/seoul/signals.json'))}
byi=collections.defaultdict(list)
for r in X: byi[str(r['itst'])].append(r)
dd=[];same=0;ex=[]
for i,rs in byi.items():
    if i in sig:
        c=(sum(r['ll'][0] for r in rs)/len(rs),sum(r['ll'][1] for r in rs)/len(rs))
        d=dm(c,sig[i][0]);dd.append(d)
        if len(ex)<8: ex.append((i,rs[0]['name'],sig[i][1],round(d)))
print('교차로번호가 C-ITS 번호와 같은 수',len(dd),'/',len(byi),'중심 거리 중앙값 m',round(st.median(dd)),'100m안',sum(d<100 for d in dd))
for e in ex: print('  ',e)
json.dump([[r['id'],str(r['itst']),r['kind'],r['ped'],r['name'],round(r['ll'][0],6),round(r['ll'][1],6)] for r in X],open('/tmp/claude-0/x/oa23081.json','w'),ensure_ascii=False)
