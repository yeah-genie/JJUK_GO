// 사용: docs/prototype를 http://localhost:8765 로 띄우고 gwang_plans.json(광화문 3곳 실측 패턴)을 옆에 두고 node scripts/eval_departure.js v1|v2
const { chromium } = require('playwright');
const plans = require('./gwang_plans.json');
const VARIANT = process.argv[2] || 'v1';
const pick = VARIANT === 'v1' ? { '1537': 'nw', '2691': 'wt', '1619': 'nw' } : { '1537': 'ne', '2691': 'et', '1619': 'nw' };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => console.log('PAGE', e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(3000);
  const out = await p.evaluate(async ([plans, pick]) => {
    REAL.day0 = plans.day0;
    for (const [id, d] of Object.entries(pick)) { const q = plans.plans[id][d]; REAL.signals[id] = { c: q.c, ref: q.ref, win: q.win }; SIG[id] = { c: q.c, g: 40, o: 0 }; }
    const ids = Object.keys(pick);
    let seed = 777; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const list = await ensureSearch(); const C = SIGMETA.get('1619').ll;
    const near = list.filter(x => x.kind !== '건물' && distLL(x.ll, C) < 1600);
    const rows = [];
    let tries = 0;
    while (rows.length < 120 && tries++ < 4000) {
      const a = near[Math.floor(rnd() * near.length)], c = near[Math.floor(rnd() * near.length)];
      const d = distLL(a.ll, c.ll); if (d < 500 || d > 2000) continue;
      state.from = { name: a.name, ll: a.ll }; state.to = { name: c.name, ll: c.ll };
      await Promise.all(cellsFor(a.ll, c.ll).map(loadCell));
      const sa = snap(a.ll), sc = snap(c.ll); if (sa.d > 300 || sc.d > 300) continue;
      state.src = sa.id; state.dst = sc.id;
      const per = [];
      for (let dep = 0; dep < 180; dep += 5) {
        const r = routeFor('short', dep); if (!r) break;
        const s = simulate(r, dep);
        per.push({ dep, stops: s.stops, wait: s.wait, total: s.total, hit: s.xings.filter(x => ids.includes(x.id)).length, known: s.knownN });
      }
      if (per.length < 36) continue;
      if (Math.max(...per.map(x => x.hit)) < 2) continue; // 모은 신호를 2곳 이상 지나는 길만
      rows.push({ a: a.name, c: c.name, d: Math.round(d), per });
    }
    return rows;
  }, [plans, pick]);
  require('fs').writeFileSync(`evalA_${VARIANT}.json`, JSON.stringify(out));
  const n = out.length; if (!n) { console.log('no pairs'); await b.close(); return; }
  const m = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const now = r => r.per[0], within = (r, lim) => r.per.filter(x => x.dep <= lim);
  console.log(`[${VARIANT}] 모은 신호 2곳 이상 지나는 길 ${n}쌍`);
  console.log(`지금 출발: 멈춤 평균 ${m(out.map(r => now(r).stops)).toFixed(2)}번, 기다림 평균 ${m(out.map(r => now(r).wait)).toFixed(0)}초`);
  for (const lim of [30, 60, 120, 175]) {
    let saved = 0, better = 0, extra = [], arrChange = [];
    for (const r of out) {
      const w = within(r, lim), n0 = now(r);
      // 가장 덜 멈추는 출발(같으면 도착 빠른 쪽)
      const best = w.slice().sort((a, b) => a.stops - b.stops || (a.dep + a.total) - (b.dep + b.total))[0];
      if (best.stops < n0.stops) better++;
      saved += n0.stops - best.stops; arrChange.push((best.dep + best.total) - (n0.dep + n0.total));
    }
    console.log(`  ${lim}초 안에 출발 시각을 고르면: 멈춤 ${(saved / n).toFixed(2)}번 덜(평균), 멈춤이 줄어드는 길 ${(100 * better / n).toFixed(0)}%, 도착 시각 평균 ${m(arrChange).toFixed(0)}초 변화(기다렸다 출발 포함)`);
  }
  // 도착 시각은 늦어지지 않고 멈춤만 줄어드는 경우: 0~60초 사이 출발 중 (dep+total) <= now.total + 10 이면서 stops 감소
  let free = 0, freeSaved = 0;
  for (const r of out) { const n0 = now(r); const c = within(r, 60).filter(x => x.dep + x.total <= n0.total + 10 && x.stops < n0.stops); if (c.length) { free++; freeSaved += n0.stops - Math.min(...c.map(x => x.stops)); } }
  console.log(`  '도착은 안 늦는데(+10초 이내) 60초 안에 출발해서 덜 멈추는' 길: ${(100 * free / n).toFixed(0)}% (평균 ${(freeSaved / Math.max(1, free)).toFixed(2)}번 덜)`);
  await b.close();
})();
