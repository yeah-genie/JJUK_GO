// 사람 없이 길찾기를 검증한다(정답 경로 없이도 성립해야 하는 성질 + 독립 엔진 대조).
//   node scripts/preview.cjs &  →  node scripts/qa_invariants.cjs [출력 폴더]
// 1) 불변 조건: 경로 점 사이 순간이동 없음, 길이=점 사이 거리 합, 출발·도착 연결, 빠른 길 ≤ 쭉고 길 시간,
//    문구(장단점 칩)의 숫자 = 비교표 숫자, 같은 입력이면 같은 결과(재현성)
// 2) 대칭: B→A 빠른 길 거리가 A→B와 크게 다르지 않음(보행망은 방향이 없다)
// 3) 독립 엔진: routing.openstreetmap.de 보행(OSRM foot) 거리와 비교(공용 서버라 1초에 1번만 부른다)
// 출발 시각은 평일 08:40 KST로 고정(qa_routes.cjs와 같다).
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const out = process.argv[2] || path.join(__dirname, '../reports/qa/invariants-latest');
const ods = JSON.parse(fs.readFileSync(path.join(__dirname, '../reports/qa/regression_od.json'), 'utf8'));
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });

async function osrm(od) {
  const u = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${od.from[1]},${od.from[0]};${od.to[1]},${od.to[0]}?overview=false`;
  try { const r = await fetch(u, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'jjukgo-qa (test script)' } }); const j = await r.json(); return j.code === 'Ok' ? Math.round(j.routes[0].distance) : null; } catch { return null; }
}

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul' });
  await c.clock.setFixedTime(new Date('2026-10-27T08:40:00+09:00'));
  const p = await c.newPage(); const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(String(e)));
  await p.addInitScript(() => { localStorage.setItem('jjukgo:profile', JSON.stringify({ version: 2, onboarded: true })); localStorage.setItem('jjukgo:seenSplash', 'true'); window.JJUKGO_NO_LOG = true; });
  await p.goto('http://127.0.0.1:8771/#home', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof current !== 'undefined' && current === 'home', null, { timeout: 60000 });

  const run = (from, to) => p.evaluate(async ([from, to]) => {
    state.from = { name: '출발', ll: [from[1], from[0]] }; state.to = { name: '도착', ll: [to[1], to[0]] };
    state.mode = 'actual'; state.routes = null; state.tripKey = null; state.fixedRoute = null; state.dep = 0; state.error = null; state.sims = null; state.focus = 'jjuk';
    if (current === 'result') renderResult(); else go('result');
    for (let i = 0; i < 600 && !(current === 'result' && (state.error || (state.sims && !document.getElementById('result-content').hidden))); i++) await new Promise(r => setTimeout(r, 100));
    if (state.error) return { error: state.error.kind || state.error.title };
    const R = state.routes, inv = [];
    for (const k of ['short', 'jjuk']) {
      const r = R[k]; let sum = 0, gap = 0;
      for (let i = 1; i < r.coords.length; i++) { const d = distLL(r.coords[i - 1], r.coords[i]); sum += d; gap = Math.max(gap, d); }
      if (Math.abs(sum - r.length) > 1) inv.push(`${k} 길이 ${Math.round(r.length)} ≠ 점 사이 합 ${Math.round(sum)}`);
      if (gap > 400) inv.push(`${k} 점 사이 ${Math.round(gap)}m 건너뜀`);
      if (distLL(r.coords[0], state.from.ll) > 1 || distLL(r.coords[r.coords.length - 1], state.to.ll) > 1) inv.push(`${k} 출발·도착 점 불일치`);
    }
    if (R.alt && R.jjuk.m.walk + 0.5 < R.short.m.walk) inv.push('쭉고 길이 빠른 길보다 빠름(빠른 길이 최단이 아님)');
    // 문구=표: 쭉고 길 탭의 장단점 칩 숫자를 비교표에 보이는 숫자로 다시 계산해 맞춰 본다(화면 글자만 사용)
    if (R.alt) {
      const rows = [...document.querySelectorAll('#route-metrics .mrow:not(.mhead)')].map(r => [...r.children].map(x => x.textContent.trim()));
      const num = s => +((s.match(/\d+/) || [0])[0]);
      const row = name => rows.find(r => r[0].replace('›', '').trim().startsWith(name));
      const chips = document.getElementById('route-tradeoffs').innerText;
      for (const [name, unit] of [['확인된 계단', '구간'], ['신호 횡단', '곳'], ['오르막', 'm'], ['급경사', 'm']]) {
        const r = row(name); if (!r) { inv.push(`표에 ${name} 행 없음`); continue; }
        const d = num(r[2]) - num(r[1]);   // 빠른 길 - 쭉고 길 (양수면 쭉고 길이 적음)
        const m = chips.match(new RegExp(`${name} (\\d+)${unit} (적어요|많아요)`));
        const said = m ? (m[2] === '적어요' ? +m[1] : -m[1]) : 0;
        const min = name === '급경사' ? 10 : name === '오르막' ? 5 : 1;
        if ((Math.abs(d) >= min ? d : 0) !== said) inv.push(`문구≠표: ${name} 표 차이 ${d}, 문구 ${said}`);
      }
      const tabs = [...document.querySelectorAll('.rtab .mins')].map(x => num(x.textContent)), tm = chips.match(/약 (\d+)분 더 걸어요/);
      if (tm && +tm[1] !== tabs[0] - tabs[1]) inv.push(`문구≠탭: '${tm[0]}' vs 탭 ${tabs.join('/')}분`);
    }
    const pick = m => ({ walk_s: Math.round(m.walk), meters: Math.round(m.meters), sig: m.sig, stairs: m.stairs, gain: Math.round(m.gain), steep: Math.round(m.steep) });
    return { alt: !!R.alt, fast: pick(R.short.m), jjuk: R.alt ? pick(R.jjuk.m) : null, inv, key: R.short.key + '|' + R.jjuk.key, ms: Math.round(state.lastTripMs || 0) };
  }, [from, to]);

  const rows = [];
  for (const [i, od] of ods.entries()) {
    const a = await run(od.from, od.to);
    const rev = await run(od.to, od.from);
    const again = i < 10 ? await run(od.from, od.to) : null;   // 재현성은 앞 10곳만(시간)
    const ext = await osrm(od); await wait(1100);
    const f = [...(a.inv || [])];
    if (a.error) f.push('오류 ' + a.error);
    if (again && !a.error && again.key !== a.key) f.push('같은 입력인데 다른 경로(재현성)');
    if (!a.error && !rev.error && Math.abs(rev.fast.meters - a.fast.meters) > Math.max(80, a.fast.meters * 0.1)) f.push(`왕복 비대칭: A→B ${a.fast.meters}m, B→A ${rev.fast.meters}m`);
    const ratio = ext && a.fast ? +(a.fast.meters / ext).toFixed(2) : null;
    if (ratio && (ratio > 1.3 || ratio < 0.75)) f.push(`외부 보행 엔진과 거리 차이: 우리 ${a.fast.meters}m / OSRM ${ext}m (${ratio}배)`);
    rows.push({ id: od.id, fn: od.fn, tn: od.tn, straight_m: od.straight_m, ...a, reverse_fast_m: rev.fast?.meters ?? null, osrm_m: ext, osrm_ratio: ratio, flags: f });
    console.log(od.id, a.error ? '오류' : (a.alt ? '대안' : '-'), `우리 ${a.fast?.meters}m 역방향 ${rev.fast?.meters}m OSRM ${ext}m`, f.length ? '⚠ ' + f.join(' · ') : 'OK');
  }
  await b.close();
  const ratios = rows.map(r => r.osrm_ratio).filter(Boolean).sort((x, y) => x - y);
  const summary = { checked: rows.length, flagged: rows.filter(r => r.flags.length).length, page_errors: pageErrors,
    osrm_ratio_median: ratios[ratios.length >> 1], osrm_ratio_min: ratios[0], osrm_ratio_max: ratios[ratios.length - 1] };
  fs.writeFileSync(path.join(out, 'invariants.json'), JSON.stringify({ summary, rows }, null, 1));
  console.log(JSON.stringify(summary));
  process.exitCode = summary.flagged || pageErrors.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
