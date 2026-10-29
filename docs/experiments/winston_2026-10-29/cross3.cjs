const { run } = require('./harness.cjs');
(async () => {
  await run(`(async()=>{
    [GMETA, TERRAIN] = await Promise.all([getJSON("graph/index.json"), getJSON("terrain.json")]);
    for (const [id,x,y,name] of await getJSON("signals.json")) SIGMETA.set(id,{name,ll:fromQ(x,y)});
    REAL = await loadSignalPlans([8,9,10,11]);
    const rows = await getJSON("search.json"); globalThis.PLACES = rows.map(([name,x,y,kind])=>({name,kind,ll:fromQ(x,y)}));
  })()`);
  run(`
  globalThis.PERP = {n:['e','w'], s:['w','e'], e:['n','s'], w:['s','n']};
  globalThis.dirFor = (id,t,dir,map) => { if(map==='same') return dir; for (const d of PERP[dir]||[]) if (signalPlan(id,t,d)) return d; return null; };
  globalThis.findP = n => PLACES.find(p=>p.name===n) || PLACES.find(p=>p.name.startsWith(n));
  globalThis.groupsOf = steps => { const gs=[]; let cur=null;
    for (const [u,v,e] of steps) { if (e.cls===5 && (e.sig || cur)) { if (e.sig && (!cur || cur.sig!==e.sig)) { cur={sig:e.sig,dir:e.dir,len:0}; gs.push(cur);} if(cur) cur.len+=e.len; } else cur=null; }
    return gs; };
  // 각 횡단: 도착 시각의 신호 상태를 방향 가정별로 기록(걸음 속도 v, 정지 없이 걷는 시각 + 대기 반영은 same 기준 경로 시간)
  globalThis.crossingStates = (steps, v) => { let t=BASE; const out=[]; let inG=null; const gs=groupsOf(steps); let gi=0;
    for (const [u,vv,e] of steps) {
      const start = e.cls===5 && e.sig && (!inG || inG.sig!==e.sig);
      if (start) inG=gs[gi++]; else if (!(e.cls===5 && inG)) inG=null;
      if (start) { const g=inG; const rec={sig:g.sig,dir:g.dir,len:g.len,t};
        for (const m of ['same','perp']) { const d=dirFor(g.sig,t,g.dir,m); if (d===null) {rec[m]=null; continue;} const s=sigState(g.sig,t,d); rec[m]= s.unknown? null : {g:s.g, rem:s.rem??null, wait:s.wait??0, w: sigWait(g.sig,t,d)}; }
        out.push(rec);
        const w = rec.same? rec.same.w : UNKNOWN_SIG_COST; t+=w+g.len/v; continue; }
      if (e.cls===5 && inG) continue; t+=e.len/v; }
    return out; };
  `);
  const stations = JSON.parse(run(`JSON.stringify(PLACES.filter(p=>p.kind==='역' && p.ll[0]>126.93&&p.ll[0]<127.03&&p.ll[1]>37.52&&p.ll[1]<37.59).map(p=>[p.name,p.ll]))`));
  console.log('central stations', stations.length);
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pairs = []; let guard = 0;
  while (pairs.length < 45 && guard++ < 5000) {
    const a = stations[Math.floor(rnd() * stations.length)], b = stations[Math.floor(rnd() * stations.length)];
    const d = Math.hypot((a[1][0] - b[1][0]) * 88000, (a[1][1] - b[1][1]) * 111000);
    if (a[0] !== b[0] && d > 900 && d < 2500) pairs.push([a[0], b[0]]);
  }
  const all = [];
  for (const [a, b] of pairs) {
    const r = await run(`(async()=>{
      const A=findP(${JSON.stringify(a)}), B=findP(${JSON.stringify(b)});
      state.from={name:A.name,ll:A.ll}; state.to={name:B.name,ll:B.ll}; state.mode='example'; BASE=31200; SPEED=1.2; state.routes=null; state.tripKey=null; state.dep=0; state.error=null;
      await computeTrip(); if (state.error) return JSON.stringify({err:state.error.title});
      const res={};
      for (const mode of ['jjuk']) { const steps=search(state.src,state.dst,mode,0); res[mode]=crossingStates(steps,1.2); res.dist=Math.round(routeFor(mode,0).length); }
      return JSON.stringify(res); })()`.replace('globalThis.findP','findP'));
    run; const o = JSON.parse(r);
    if (o.err) { all.push({ a, b, err: o.err }); continue; }
    all.push({ a, b, dist: o.dist, x: o.jjuk });
  }
  require('fs').writeFileSync('cross3.json', JSON.stringify(all));
  console.log('pairs', all.length, 'ok', all.filter(x => x.x).length, 'err', all.filter(x => x.err).length);
})().catch(e => { console.error(e); process.exit(1); });
