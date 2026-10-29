const { run } = require('./harness.cjs');
const PAIRS = [['서대문역','청계광장'],['독립문역','서울광장'],['시청역','경복궁'],['서울역','광화문'],['안국역','종각역'],['종각역','을지로3가역'],['강남역','역삼역'],['홍대입구역','합정역'],['신촌역','이대역'],['잠실역','석촌호수'],['종로3가역','동대문역'],['광화문','동대문역']];
(async () => {
  await run(`(async()=>{
    [GMETA, TERRAIN] = await Promise.all([getJSON("graph/index.json"), getJSON("terrain.json")]);
    for (const [id,x,y,name] of await getJSON("signals.json")) SIGMETA.set(id,{name,ll:fromQ(x,y)});
    REAL = await loadSignalPlans([8,9,10,11]);
    const rows = await getJSON("search.json"); globalThis.PLACES = rows.map(([name,x,y,kind])=>({name,kind,ll:fromQ(x,y)}));
  })()`);
  run(`
  globalThis.findP = n => PLACES.find(p=>p.name===n) || PLACES.find(p=>p.name.startsWith(n));
  globalThis.groupsOf = steps => { // 연속된 횡단보도(cls 5) 묶음
    const gs=[]; let cur=null;
    for (const [u,v,e] of steps) {
      if (e.cls===5 && (e.sig || cur)) {
        if (e.sig && (!cur || cur.sig!==e.sig)) { cur={sig:e.sig,dir:e.dir,len:0,halves:0,pre:null}; gs.push(cur); }
        if (cur) { cur.len+=e.len; if(e.half) cur.halves++; }
      } else cur=null;
    }
    return gs;
  };
  globalThis.analyze = (steps, v, policy) => {
    let t=BASE, out={cross:0,unknown:0,stops:0,wait:0,badStart:0,impossible:0,minMargin:Infinity,n:[]};
    let i=0; const gs=groupsOf(steps); let gi=0, inGroup=null;
    for (const [u,vv,e] of steps) {
      const isStart = e.cls===5 && e.sig && (!inGroup || inGroup.sig!==e.sig);
      if (e.cls===5 && e.sig) { if (isStart) { inGroup=gs[gi++]; } }
      else if (!(e.cls===5 && inGroup)) inGroup=null;
      if (isStart && inGroup) {
        const g=inGroup, need=g.len/v;
        const st=sigState(g.sig,t,g.dir);
        if (st.unknown) { out.unknown++; t+=UNKNOWN_SIG_COST; }
        else {
          out.cross++;
          let w=0, remAfter;
          if (policy==='A') { w=sigWait(g.sig,t,g.dir); remAfter = st.g ? (w===0? st.rem : null) : null;
            // A: MIN_GREEN만 본다. 시작 뒤 남은 초록이 필요한 시간보다 적으면 '못 건너는데 건넌 것'
            if (w===0 && st.g && st.rem < need) out.badStart++;
            if (w===0 && st.g) out.minMargin=Math.min(out.minMargin, st.rem-need);
          } else { // B: 남은 초록 >= 필요 시간일 때만 출발
            if (st.g && st.rem>=need) { w=0; out.minMargin=Math.min(out.minMargin, st.rem-need); }
            else {
              const waitRed = st.g ? st.rem + sigState(g.sig,t+st.rem+.5,g.dir).wait : st.wait;
              w=waitRed; const s2=sigState(g.sig,t+w+.5,g.dir);
              if (s2.g && s2.rem < need) { out.impossible++; }
              else if (s2.g) out.minMargin=Math.min(out.minMargin, s2.rem-need);
            }
          }
          if (w>2) out.stops++; out.wait+=w; t+=w;
        }
        t+=g.len/v; // 횡단 시간
        // 묶음의 나머지 간선은 아래에서 중복으로 더하지 않도록 길이만큼 이미 더했음
        g._done=true;
        continue;
      }
      if (e.cls===5 && inGroup) continue; // 묶음에 포함됨
      t+=e.len/v;
    }
    out.total=t-BASE; return out;
  };
  `);
  const rows = [];
  for (const [a,b] of PAIRS) {
    const ok = run(`(async()=>{
      const A=findP(${JSON.stringify(a)}), B=findP(${JSON.stringify(b)}); if(!A||!B) return 'missing';
      state.from={name:A.name,ll:A.ll}; state.to={name:B.name,ll:B.ll}; state.mode='example'; BASE=31200; SPEED=1.2; state.routes=null; state.tripKey=null; state.dep=0; state.error=null;
      await computeTrip(); if (state.error) return 'err:'+state.error.title; return 'ok';
    })()`);
    const r = await ok;
    if (r !== 'ok') { console.log(a, '→', b, r); continue; }
    for (const mode of ['short','jjuk']) for (const v of [0.8, 1.0, 1.2, 1.4]) for (const pol of ['A','B']) {
      const res = run(`(()=>{ const steps=search(state.src,state.dst,${JSON.stringify(mode)},0); const o=analyze(steps,${v},${JSON.stringify(pol)}); const gs=groupsOf(steps); o.groups=gs.length; o.lenAvg=gs.length? gs.reduce((s,g)=>s+g.len,0)/gs.length:0; o.lenMax=gs.reduce((m,g)=>Math.max(m,g.len),0); o.distM=Math.round(routeFor(${JSON.stringify(mode)},0).length); return JSON.stringify(o); })()`);
      rows.push({ pair: a+'→'+b, mode, v, pol, ...JSON.parse(res) });
    }
  }
  require('fs').writeFileSync('cross2.json', JSON.stringify(rows));
  console.log('rows', rows.length);
})().catch(e => { console.error(e); process.exit(1); });
