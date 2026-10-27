// 사용: docs/prototype를 http://localhost:8765 로 띄우고(데이터 seoul/ 포함) node scripts/eval_routes.js 300
// 서울 전역 출발·도착 쌍으로 쭉고 vs 최단 비교. 결과는 eval_out.json
const { chromium } = require('playwright');
const N = +process.argv[2] || 300;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => console.log('PAGE', e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(3000);
  const out = await p.evaluate(async N => {
    // 같은 결과가 나오게 고정된 난수
    let seed = 20261028; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const list = await ensureSearch();
    const places = list.filter(x => x.kind !== '카페' && x.kind !== '건물');
    const pairs = [];
    while (pairs.length < N) {
      const a = places[Math.floor(rnd() * places.length)], c = places[Math.floor(rnd() * places.length)];
      const d = distLL(a.ll, c.ll);
      if (d >= 500 && d <= 2500) pairs.push([a, c, d]);
    }
    const realSIG = { ...SIG };
    const allCits = [...SIGMETA.entries()].filter(([, m]) => m.cits).map(([id]) => id);
    const setTiming = on => { for (const k of Object.keys(SIG)) delete SIG[k]; Object.assign(SIG, realSIG); if (on) for (const id of allCits) SIG[id] = exampleSig(id); };
    const better = (sj, ss) => {
      const nSig = s => s.unknownN + s.knownN, extra = sj.total - ss.total;
      const st = ss.stops - sj.stops, sg = nSig(ss) - nSig(sj), w = ss.wait - sj.wait;
      return st >= 0 && w >= -5 && sg >= 0 && (st > 0 || w > 5 || sg > 0) && extra <= SLOW_OK;
    };
    const rows = [];
    for (const [a, c, d] of pairs) {
      state.from = { name: a.name, ll: a.ll }; state.to = { name: c.name, ll: c.ll };
      await Promise.all(cellsFor(a.ll, c.ll).map(loadCell));
      const sa = snap(a.ll), sc = snap(c.ll);
      if (sa.d > 300 || sc.d > 300) { rows.push({ skip: 'snap' }); continue; }
      state.src = sa.id; state.dst = sc.id;
      const short = routeFor('short', 0); // 최단 시간(기다림 포함)
      if (!short) { rows.push({ skip: 'noroute' }); continue; }
      const r = { a: a.name, c: c.name, straight: Math.round(d), shortM: Math.round(short.length) };
      for (const mode of ['A', 'B']) {
        setTiming(mode === 'B');
        const t0 = performance.now();
        let jj = routeFor('jjuk', 0);
        const ms = performance.now() - t0;
        let sj = simulate(jj, 0); const ss = simulate(short, 0);
        if (!better(sj, ss) || jj.key === short.key) { jj = short; sj = ss; }
        r[mode] = { diff: jj.key !== short.key, extraM: Math.round(jj.length - short.length), sigS: ss.knownN + ss.unknownN, sigJ: sj.knownN + sj.unknownN,
                    stopsS: ss.stops, stopsJ: sj.stops, waitS: Math.round(ss.wait), waitJ: Math.round(sj.wait), totS: Math.round(ss.total), totJ: Math.round(sj.total), ms: Math.round(ms) };
      }
      rows.push(r);
    }
    setTiming(false);
    return rows;
  }, N);
  require('fs').writeFileSync('eval_out.json', JSON.stringify(out));
  const ok = out.filter(r => !r.skip);
  const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0);
  const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  console.log('pairs', out.length, 'routed', ok.length, 'skipped', out.length - ok.length);
  for (const m of ['A', 'B']) {
    const d = ok.filter(r => r[m].diff);
    console.log(`\n[${m}] 쭉고가 최단과 다른 길: ${d.length}/${ok.length} (${(100 * d.length / ok.length).toFixed(1)}%)`);
    console.log(`  전체 평균 신호 수: 최단 ${(sum(ok, r => r[m].sigS) / ok.length).toFixed(2)} → 쭉고 ${(sum(ok, r => r[m].sigJ) / ok.length).toFixed(2)}`);
    if (d.length) {
      console.log(`  다를 때: 더 걷는 거리 중앙값 ${med(d.map(r => r[m].extraM))}m, 신호 ${(sum(d, r => r[m].sigS - r[m].sigJ) / d.length).toFixed(2)}곳 덜`);
      if (m === 'B') {
        console.log(`  다를 때: 멈춤 ${(sum(d, r => r[m].stopsS - r[m].stopsJ) / d.length).toFixed(2)}번 덜, 기다림 ${(sum(d, r => r[m].waitS - r[m].waitJ) / d.length).toFixed(0)}초 덜, 도착 ${(sum(d, r => r[m].totS - r[m].totJ) / d.length).toFixed(0)}초 빠름(중앙값 ${med(d.map(r => r[m].totS - r[m].totJ))}초)`);
        console.log(`  다를 때 도착이 늦어진 경우: ${d.filter(r => r[m].totJ > r[m].totS + 5).length}`);
      }
    }
    if (m === 'B') console.log(`  전체: 멈춤 최단 ${(sum(ok, r => r.B.stopsS) / ok.length).toFixed(2)} → 쭉고 ${(sum(ok, r => r.B.stopsJ) / ok.length).toFixed(2)}, 기다림 ${(sum(ok, r => r.B.waitS) / ok.length).toFixed(0)}초 → ${(sum(ok, r => r.B.waitJ) / ok.length).toFixed(0)}초`);
    console.log(`  길찾기 계산 시간 중앙값 ${med(ok.map(r => r[m].ms))}ms`);
  }
  await b.close();
})();
