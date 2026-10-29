const { run } = require('./harness.cjs');
(async () => {
  await run(`(async()=>{
    [GMETA, TERRAIN] = await Promise.all([getJSON("graph/index.json"), getJSON("terrain.json")]);
    const rows = await getJSON("search.json"); globalThis.PLACES = rows.map(([name,x,y,kind])=>({name,kind,ll:fromQ(x,y)}));
  })()`);
  const kinds = JSON.parse(run('JSON.stringify(PLACES.reduce((m,p)=>(m[p.kind]=(m[p.kind]||0)+1,m),{}))'));
  console.log(kinds);
  // 결정적 표본: 종류별 최대 80곳(인덱스 간격 추출)
  const res = await run(`(async()=>{
    const by={}; for(const p of PLACES) (by[p.kind]??=[]).push(p);
    const out=[];
    for (const [k,list] of Object.entries(by)) {
      const step=Math.max(1,Math.floor(list.length/80)); 
      for (let i=0;i<list.length;i+=step) {
        const p=list[i];
        G.cells.clear();G.node.clear();G.adj.clear();G.seen.clear();
        const cells=cellsFor(p.ll,p.ll,200); await Promise.all(cells.map(loadCell));
        if(!G.adj.size){out.push([k,p.name,null]);continue;}
        const s=snap(p.ll); out.push([k,p.name,Number.isFinite(s.d)?Math.round(s.d):null]);
      }
    }
    return JSON.stringify(out);
  })()`);
  const rows = JSON.parse(res);
  const byK = {};
  for (const [k, n, d] of rows) { (byK[k] ??= []).push(d); }
  for (const [k, ds] of Object.entries(byK)) {
    const v = ds.filter(x => x != null).sort((a, b) => a - b);
    const over = ds.filter(x => x == null || x > 35).length;
    console.log(k.padEnd(4), 'n=' + ds.length, 'median ' + v[Math.floor(v.length / 2)] + 'm', 'p90 ' + v[Math.floor(v.length * .9)] + 'm', '>35m 또는 없음: ' + over + ' (' + Math.round(over / ds.length * 100) + '%)', '>60m ' + ds.filter(x => x == null || x > 60).length);
  }
  const all = rows.map(r => r[2]); const o = all.filter(x => x == null || x > 35).length;
  console.log('전체 표본', all.length, '35m 초과/없음', o, Math.round(o / all.length * 100) + '%');
  require('fs').writeFileSync('snap1.json', JSON.stringify(rows));
})().catch(e => { console.error(e); process.exit(1); });
