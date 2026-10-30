// 서울 출발·도착 묶음을 실제 앱으로 열어 빠른 길·쭉고 길 결과와 화면을 저장하고, 이상한 결과를 표시한다.
// 사용: node scripts/preview.cjs & 뒤에
//   node scripts/qa_routes.cjs [출력 폴더] [OD 목록 json]            # 결과·화면 저장 + 이상 표시
//   node scripts/qa_routes.cjs --check [출력 폴더]                    # 고정 회귀 묶음(reports/qa/regression_od.json)을 기준값과 비교
// 기준값: reports/qa/regression_baseline.json (node scripts/qa_routes.cjs --update-baseline 로 다시 만든다)
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), CHECK = args.includes('--check'), UPDATE = args.includes('--update-baseline');
const pos = args.filter(a => !a.startsWith('--'));
const QA = path.join(__dirname, '../reports/qa');
const listPath = pos[1] || (CHECK || UPDATE ? path.join(QA, 'regression_od.json') : path.join(QA, 'qa_od_list.json'));
const list = JSON.parse(fs.readFileSync(listPath, 'utf8'));
const out = pos[0] || path.join(QA, 'latest');
const BASELINE = path.join(QA, 'regression_baseline.json');
const QA_TIME = '2026-10-27T08:40:00+09:00';
const BANNED = /뛰세요|안전한|보장|무장애|건널 수|건너도|한 번에/;
fs.mkdirSync(out, { recursive: true });

// 이상한 결과 판정(원시값 기준). 하나라도 걸리면 사람이 지도를 보고 판단한다.
function flags(od, r) {
  const f = [];
  if (r.error) return ['오류: ' + r.error.title];
  const straight = od.straight_m || 1, fast = r.fast, jj = r.jjuk;
  if (!od.detour_ok && fast.meters / straight > 1.9 && fast.meters - straight > 400) f.push(`빠른 길 우회 ${(fast.meters / straight).toFixed(1)}배`);
  if (jj && jj.meters / fast.meters > 1.35) f.push(`쭉고 길이 빠른 길보다 ${(jj.meters / fast.meters).toFixed(2)}배 김`);
  for (const [k, m] of [['빠른 길', fast], ['쭉고 길', jj]]) {
    if (!m) continue;
    if (m.gain_m > Math.max(40, m.meters * 0.08)) f.push(`${k} 오르막 ${m.gain_m}m (거리의 ${Math.round(m.gain_m / m.meters * 100)}%)`);
    if (m.steep8_m > m.meters * 0.5 && m.steep8_m > 200) f.push(`${k} 급경사 ${m.steep8_m}m (거리의 ${Math.round(m.steep8_m / m.meters * 100)}%)`);
    if (m.stairs > 6) f.push(`${k} 계단 ${m.stairs}구간`);
  }
  if (r.route_ms > 20000) f.push(`계산 ${Math.round(r.route_ms / 1000)}초`);
  if (BANNED.test(r.headline + r.sub + r.line)) f.push('금지 문구');
  return f;
}

(async () => {
  const b = await chromium.launch();
  const rows = [];
  for (const od of list) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, timezoneId: 'Asia/Seoul' });
    // 출발 시각을 고정한다(평일 화요일 08:40 KST). 예상 신호 대기가 시각·요일에 따라 달라 회귀 비교가 흔들리지 않게.
    await c.clock.setFixedTime(new Date(QA_TIME));
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.addInitScript(() => { localStorage.setItem('jjukgo:profile', JSON.stringify({ version: 2, onboarded: true })); window.JJUKGO_NO_LOG = true; });
    const url = `http://127.0.0.1:8771/?from=${od.from.join(',')}&to=${od.to.join(',')}&fn=${encodeURIComponent(od.fn)}&tn=${encodeURIComponent(od.tn)}`;
    const t0 = Date.now();
    try { await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch (e) { errs.push('열기 시간 초과'); }
    try { await p.waitForSelector('#s-result:not([hidden]) #result-content:not([hidden]), #s-result:not([hidden]) #result-status b', { timeout: 120000 }); } catch (e) { errs.push('시간 초과'); }
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => {
      const pick = m => m && { walk_s: Math.round(m.walk), meters: Math.round(m.meters), sig: m.sig, cross: m.cross, big: m.big, stairs: m.stairs, gain_m: Math.round(m.gain), steep8_m: Math.round(m.steep), wait_s: Math.round(m.wait), wait_known: m.waitKnown, wait_total: m.waitTotal };
      const dirs = r => r && { sig_x: (r.x || []).length, sig_dir: (r.x || []).filter(x => x.dir).length };
      return { line: document.getElementById('compare-line').textContent, headline: document.getElementById('route-headline').textContent, sub: document.getElementById('route-sub').textContent, error: state.error, alt: !!(state.routes && state.routes.alt),
        candidates: state.candidateCount, rejected: pickAlternative.rejected, route_ms: Math.round(state.lastRouteMs || 0), trip_ms: Math.round(state.lastTripMs || 0), fast: pick(state.routes && state.routes.short.m), fast_x: dirs(state.routes && state.routes.short), jjuk: state.routes && state.routes.alt ? pick(state.routes.jjuk.m) : null };
    });
    await p.screenshot({ path: path.join(out, od.id + '.png') });
    const row = { ...od, ...r, load_ms: Date.now() - t0, page_errors: errs };
    row.flags = flags(od, r).concat(errs.length ? ['페이지 오류'] : []);
    rows.push(row);
    console.log(od.id, od.kind, r.error ? '오류 ' + r.error.title : (r.alt ? '쭉고 길 있음' : '대안 없음'), '|', r.line, '|', r.route_ms + 'ms', row.flags.length ? '⚠ ' + row.flags.join(', ') : '');
    await c.close();
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(rows, null, 1));
  await b.close();
  const keep = row => ({ alt: row.alt, error: row.error ? row.error.kind || row.error.title : null, fast_walk_s: row.fast?.walk_s ?? null, fast_sig: row.fast?.sig ?? null, fast_stairs: row.fast?.stairs ?? null,
    jjuk_walk_s: row.jjuk?.walk_s ?? null, headline: row.headline });
  if (UPDATE) {
    fs.writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(rows.map(r => [r.id, keep(r)])), null, 1) + '\n');
    console.log('기준값 저장', BASELINE);
  }
  if (CHECK) {
    // 회귀 판정: 대안 유무·오류가 바뀌거나, 걷는 시간이 5%(최소 20초) 넘게 바뀌거나, 새 이상 표시가 생기면 실패
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); const fails = [];
    for (const row of rows) {
      const was = base[row.id], now = keep(row);
      if (!was) { fails.push(`${row.id}: 기준값 없음`); continue; }
      if (row.flags.length) fails.push(`${row.id}: ${row.flags.join(', ')}`);
      if (was.alt !== now.alt) fails.push(`${row.id}: 쭉고 길 ${was.alt ? '있음→없음' : '없음→있음'}`);
      if (was.error !== now.error) fails.push(`${row.id}: 오류 ${was.error}→${now.error}`);
      for (const k of ['fast_walk_s', 'jjuk_walk_s']) if (was[k] != null && now[k] != null && Math.abs(was[k] - now[k]) > Math.max(20, was[k] * 0.05)) fails.push(`${row.id}: ${k} ${was[k]}→${now[k]}`);
    }
    console.log(fails.length ? '회귀 실패\n' + fails.join('\n') : `회귀 통과 ${rows.length}곳`);
    process.exitCode = fails.length ? 1 : 0;
  }
})();
