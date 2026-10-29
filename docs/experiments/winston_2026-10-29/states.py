import pandas as pd, numpy as np
df=pd.read_csv('data/20261027.csv.gz')
df['a']=pd.to_datetime(df.start_utc,utc=True); df['b']=pd.to_datetime(df.end_utc,utc=True)
df['dur']=(df.b-df.a).dt.total_seconds()+1
print(df.state.value_counts())
print(df.groupby('state').dur.describe().round(1))
# sequences: typical order for id 1537 / 1821 et
for ident in (1537,1821):
    g=df[(df.itst_id==ident)].sort_values('a')
    print(ident, g.direction.unique())
    d=g[g.direction==g.direction.iloc[0]].head(14)
    print(d[['state','start_utc','dur','rem_start_ds','rem_end_ds','samples']].to_string())
