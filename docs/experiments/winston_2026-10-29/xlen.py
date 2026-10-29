import json, glob, collections
import numpy as np, pandas as pd
G='/home/user/DeeplearningApplication1/docs/prototype/seoul/graph/'
rows=[]; allc5=[]
for f in glob.glob(G+'c*.json'):
    if f.endswith('index.json'): continue
    c=json.load(open(f))
    for e in c['e']:
        if e[3]==5:
            allc5.append(e)
            if len(e)>5 and e[5]:
                rows.append(dict(a=e[0],b=e[1],len=e[2],sig=e[5],dir=e[6],half=e[7]))
E=pd.DataFrame(rows).drop_duplicates(['a','b','len'])
print('cls5 edges',len(allc5),'sig crossing edges',len(E),'unique sig ids',E.sig.nunique())
print('no-sig cls5 (medians/marks):', len(allc5)-len(rows))
print(E.groupby('half').len.describe().round(1))
q=E.len.quantile([.05,.25,.5,.75,.95,.99]).round(1); print(q.to_dict())
print('len<8 share',(E.len<8).mean().round(3),' len>40',(E.len>40).mean().round(3))
# permissive durations from 10/27 csv
df=pd.read_csv('data/20261027.csv.gz')
df['a']=pd.to_datetime(df.start_utc,utc=True); df['b']=pd.to_datetime(df.end_utc,utc=True)
df['dur']=(df.b-df.a).dt.total_seconds()+1
p=df[(df.state=='permissive-Movement-Allowed')&(df.rem_start_ds>=50)&(df.rem_end_ds<=40)&(df.samples>=5)]
pr=df[(df.state=='protected-Movement-Allowed')&(df.samples>=5)]
st=df[(df.state=='stop-And-Remain')&(df.samples>=5)]
per=p.groupby(['itst_id','direction']).dur.median().rename('perm').reset_index()
pro=pr.groupby(['itst_id','direction']).dur.median().rename('prot').reset_index()
M=per.merge(pro,on=['itst_id','direction'],how='outer')
M['id']=M.itst_id.astype(int).astype(str); M['dir']=M.direction.str[0]
print('legs with perm',per.shape[0])
# join to edge by (sig id, compass dir) – assumption of direction mapping: edge dir n/e/s/w == code nt/et/st/wt
J=E[E.half==0].merge(M[['id','dir','perm','prot']],left_on=['sig','dir'],right_on=['id','dir'])
J=J.dropna(subset=['perm'])
print('joined',len(J),'edges; unique sig',J.sig.nunique())
# per (sig,dir) take median edge len (several edges)
K=J.groupby(['sig','dir']).agg(len=('len','median'),perm=('perm','median'),prot=('prot','median')).reset_index()
print('pairs',len(K))
print(K[['len','perm','prot']].describe().round(1))
print('corr len~perm', K[['len','perm']].corr().iloc[0,1].round(3),' corr len~prot',K[['len','prot']].corr().iloc[0,1].round(3), ' corr len~(perm+prot)', (K.len.corr(K.perm+K.prot)).round(3))
r=(K.len/K.perm); print('len/perm ratio quantiles',r.quantile([.1,.25,.5,.75,.9]).round(2).to_dict())
ok=(K.len/K.perm).between(.7,1.3).mean(); print('share |len/perm-1|<0.3',round(ok,3))
# slope
b=np.polyfit(K.perm,K.len,1); print('fit len = %.2f*perm + %.1f'%tuple(b))
K.to_csv('xlen_pairs.csv',index=False)
