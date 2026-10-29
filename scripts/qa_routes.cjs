// 대표 출발·도착(reports/qa/qa_od_list.json)을 실제 앱으로 열어 빠른 길·쭉고 길 결과와 화면을 저장한다(수동 QA용).
// 사용: node scripts/preview.cjs & 뒤에 node scripts/qa_routes.cjs [출력 폴더]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const list = JSON.parse(fs.readFileSync(path.join(__dirname, '../reports/qa/qa_od_list.json'), 'utf8'));
const out = process.argv[2] || path.join(__dirname, '../reports/qa/latest');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const rows = [];
  for (const od of list) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.addInitScript(() => localStorage.setItem('jjukgo:profile', JSON.stringify({ version: 2, onboarded: true })));
    const url = `http://127.0.0.1:8771/?from=${od.from.join(',')}&to=${od.to.join(',')}&fn=${encodeURIComponent(od.fn)}&tn=${encodeURIComponent(od.tn)}`;
    const t0 = Date.now();
    try { await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }); } catch (e) { errs.push('열기 시간 초과'); }
    try { await p.waitForSelector('#s-result:not([hidden]) #result-content:not([hidden]), #s-result:not([hidden]) #result-status b', { timeout: 120000 }); } catch (e) { errs.push('시간 초과'); }
    await p.waitForTimeout(2000);
    const r = await p.evaluate(() => {
      const pick = m => m && { walk_s: Math.round(m.walk), meters: Math.round(m.meters), sig: m.sig, cross: m.cross, big: m.big, stairs: m.stairs, gain_m: Math.round(m.gain), steep8_m: Math.round(m.steep) };
      return { line: document.getElementById('compare-line').textContent, error: state.error, alt: !!(state.routes && state.routes.alt),
        candidates: state.candidateCount, route_ms: Math.round(state.lastRouteMs || 0), fast: pick(state.routes && state.routes.short.m), jjuk: state.routes && state.routes.alt ? pick(state.routes.jjuk.m) : null };
    });
    await p.screenshot({ path: path.join(out, od.id + '.png') });
    rows.push({ ...od, ...r, load_ms: Date.now() - t0, page_errors: errs });
    console.log(od.id, od.kind, r.error ? '오류 ' + r.error.title : (r.alt ? '쭉고 길 있음' : '대안 없음'), '|', r.line, '|', r.route_ms + 'ms');
    await c.close();
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(rows, null, 1));
  await b.close();
})();
