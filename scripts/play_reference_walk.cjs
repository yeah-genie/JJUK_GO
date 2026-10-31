// 새 화면(reference-ui)을 가짜 GPS와 고정 시각(화 14:10 KST)으로 처음부터 도착까지 걸어 보고 화면을 찍는다.
// 사용: node scripts/preview.cjs & 뒤에 node scripts/play_reference_walk.cjs [가로] [세로]  → 화면은 reports/qa/reference-walk/
const { chromium } = require('playwright');
const OUT=require('node:path').join(__dirname,'../reports/qa/reference-walk');require('node:fs').mkdirSync(OUT,{recursive:true});
const [W,H]=[+process.argv[2]||390,+process.argv[3]||844];
const routes = { seongsu: 'from=37.5446,127.0560&to=37.5444,127.0374&fn=성수역&tn=서울숲', hyehwa: 'from=37.5822,127.0019&to=37.5806,127.0075&fn=혜화역&tn=낙산공원' };
(async () => {
  const b = await chromium.launch();
  for (const [name, q] of Object.entries(routes)) {
    const ctx = await b.newContext({ viewport: { width: W, height: H }, timezoneId: 'Asia/Seoul' });
    await ctx.clock.install({ time: new Date('2026-10-27T14:10:00+09:00') });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', d => d.accept());
    await p.addInitScript(() => {
      localStorage.setItem('jjukgo:reference:seenSplash', 'true'); window.JJUKGO_NO_LOG = true; window.__pos = null;
      const mk = () => ({ coords: { longitude: __pos[0], latitude: __pos[1], accuracy: 8 }, timestamp: Date.now() });
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition(ok) { const t = setInterval(() => { if (__pos) { clearInterval(t); ok(mk()); } }, 200); }, watchPosition(ok) { return setInterval(() => { if (__pos) ok(mk()); }, 1000); }, clearWatch(id) { clearInterval(id); } } });
    });
    await p.goto('http://127.0.0.1:8771/reference-ui/index.html?' + q);
    await p.waitForSelector('.ma-result .ma-card', { timeout: 120000 }); await p.waitForTimeout(3000);
    await p.screenshot({ path: `${OUT}/f-${name}-${W}-result.png` });
    const L = await p.evaluate(() => state.routes[state.focus].length);
    await p.evaluate(() => { window.__pos = pointAt(state.routes[state.focus], 5); });
    await p.click('[data-ref-action="start"]');
    const seen = new Set(); let shot = 0;
    for (let d = 5; d <= L + 5; d += 6) {
      await p.evaluate(dd => { const r = state.routes[state.focus]; window.__pos = pointAt(r, Math.min(dd, r.length)); }, d);
      await p.waitForTimeout(1050);
      const s = await p.evaluate(() => ({ head: document.getElementById('ref-next-distance').textContent, line: document.getElementById('ref-instruction').textContent, banner: document.getElementById('ref-signal-banner').hidden ? '' : document.getElementById('ref-signal-banner').innerText.replace(/\n/g, ' / '), end: document.querySelector('.ma-end').textContent }));
      const key = s.head.replace(/\d+m/, 'Nm') + '|' + s.banner.replace(/\d+/g, 'N');
      if (!seen.has(key)) { seen.add(key); console.log(name, Math.round(d), JSON.stringify(s)); }
      if (s.banner && shot < 1) { shot++; await p.screenshot({ path: `${OUT}/f-${name}-${W}-banner.png` }); }
      if (s.head === '도착') break;
    }
    await p.screenshot({ path: `${OUT}/f-${name}-${W}-arrive.png` });
    await p.click('[data-ref-action="finish"]'); await p.waitForTimeout(2500);
    console.log(name, 'SUMMARY', await p.evaluate(() => refScreen + ' :: ' + (document.querySelector('.summary')?.innerText || '').replace(/\n+/g, ' / ')));
    await p.screenshot({ path: `${OUT}/f-${name}-${W}-summary.png` });
    console.log('ERRS', errs); await ctx.close();
  }
  await b.close();
})();
