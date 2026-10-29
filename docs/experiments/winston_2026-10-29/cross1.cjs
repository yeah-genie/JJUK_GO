const { run } = require('./harness.cjs');
(async () => {
  await run(`(async()=>{
    [GMETA, TERRAIN] = await Promise.all([getJSON("graph/index.json"), getJSON("terrain.json")]);
    for (const [id,x,y,name] of await getJSON("signals.json")) SIGMETA.set(id,{name,ll:fromQ(x,y)});
    REAL = await loadSignalPlans([8,9,10]);
    globalThis.__ok = Object.keys(REAL.signals).length;
  })()`);
  console.log('signals loaded (08~10 merged):', run('Object.keys(REAL.signals).length'), 'GMETA cells', run('Object.keys(GMETA.cells).length'));
})().catch(e => { console.error(e); process.exit(1); });
