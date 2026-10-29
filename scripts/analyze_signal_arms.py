# 서울시 C-ITS MAP 파일 3종(차로 좌표·신호연결)으로 교차로 접근로의 실제 방위를 계산하고 신호 그룹(10~80)과 대조한다. 입력 경로는 업로드 임시 폴더라 재실행 시 D를 바꿔야 한다.
import csv,collections,math,json
D='/root/.claude/uploads/81d85301-0811-5800-b421-2042850d1c0b/'
lanes=collections.defaultdict(list)
for r in csv.DictReader(open(D+'cf483cfe-v2xNodeMapInformation.csv',encoding='utf-8-sig')):
    lanes[(r['ITST_ID'],int(float(r['LANE_ID'])))].append((int(float(r['NODE_ORDR'])),float(r['OFST_XAXS_CRDNT']),float(r['OFST_YAXS_CRDNT'])))
end={}
for k,p in lanes.items():
    p.sort();x=y=0
    for o,dx,dy in p:x+=dx;y+=dy
    first=p[0]
    end[k]=(first[1]/100,first[2]/100,x/100,y/100)  # (start m, end m)
sig={}
for r in csv.DictReader(open(D+'62a5a676-v2xSignalConnectionMapInformation.csv',encoding='utf-8-sig')):
    sig[(r['ITST_ID'],int(float(r['LANE_ID'])))]=r['SIGNLGROUP_CD']
perm={}
for r in csv.DictReader(open(D+'d9013c68-v2xLaneMapInformation.csv',encoding='utf-8-sig')):
    perm[(r['ITST_ID'],int(float(r['LANE_ID'])))]=r['PERM_DRC_CD']
def comp(dx,dy):
    b=(math.degrees(math.atan2(dx,dy))+360)%360  # 0=북, 90=동
    return b
tab=collections.Counter();per={}
for (i,l),(sx,sy,ex,ey) in end.items():
    g=sig.get((i,l))
    if not g or l>=100:continue
    arm=(l-1)//20
    per.setdefault(i,{}).setdefault(arm,[]).append((comp(ex,ey),g))
res={}
for i,arms in per.items():
    out={}
    for a,v in arms.items():
        # circular mean bearing
        sx=sum(math.sin(math.radians(b)) for b,_ in v);cy=sum(math.cos(math.radians(b)) for b,_ in v)
        b=(math.degrees(math.atan2(sx,cy))+360)%360
        gs=collections.Counter(g for _,g in v).most_common(1)[0][0]
        out[a]=(b,gs)
    res[i]=out
    for a,(b,g) in out.items():
        tab[(g,int(((b+22.5)%360)//45))]+=1
names=['북','북동','동','남동','남','남서','서','북서']
for g in sorted({g for g,_ in tab}):
    row=[tab[(g,k)] for k in range(8)]
    print(g,dict(zip(names,row)))
json.dump({i:{a:[round(b),g] for a,(b,g) in o.items()} for i,o in res.items()},open('/tmp/claude-0/x/arms.json','w'))
print(len(res))
