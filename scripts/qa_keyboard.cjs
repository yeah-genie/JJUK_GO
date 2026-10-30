// 휴대폰 키보드가 올라온 상황을 흉내 낸다: 검색칸에 입력하는 동안 화면 높이를 키보드만큼 줄여(844→520, 640→360)
// 검색 결과 첫 줄과 출발·도착 표시가 보이는지, 결과 화면 버튼이 하단에 가려지지 않는지 본다.
//   node scripts/preview.cjs &  →  node scripts/qa_keyboard.cjs
// 한계: 실제 키보드·브라우저 하단 막대의 높이는 기기마다 다르다(실기기 확인은 따로 필요).
const { chromium } = require('playwright');
const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 0.5; }, sel);
(async () => {
  const b = await chromium.launch(), res = [];
  for (const [w, h, kb] of [[390, 844, 520], [360, 640, 360]]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true }); const p = await c.newPage();
    await p.addInitScript(() => { localStorage.setItem('jjukgo:profile', JSON.stringify({ version: 2, onboarded: true })); localStorage.setItem('jjukgo:seenSplash', 'true'); window.JJUKGO_NO_LOG = true; });
    await p.goto('http://127.0.0.1:8771/#home'); await p.waitForFunction(() => typeof current !== 'undefined' && current === 'home', null, { timeout: 60000 });
    await p.tap('.searchbox'); await p.waitForFunction(() => current === 'search');
    await p.setViewportSize({ width: w, height: kb });   // 키보드가 올라옴
    await p.fill('#sq', '낙산'); await p.waitForTimeout(1200);
    res.push([`${w}x${h} 키보드: 첫 검색 결과 보임`, await vis(p, '[data-res="0"]')]);
    res.push([`${w}x${h} 키보드: 입력칸 보임`, await vis(p, '#sq')]);
    res.push([`${w}x${h} 키보드: 출발·도착 표시 보임`, await vis(p, '.search-trip')]);
    await p.tap('[data-res="0"]'); await p.waitForFunction(() => current === 'search' && state.pick === 'from');
    await p.fill('#sq', '혜화역'); await p.waitForTimeout(1000);
    res.push([`${w}x${h} 키보드: 출발지 화면에서 도착지(낙산) 표시`, /낙산/.test(await p.evaluate(() => document.querySelector('.search-trip').innerText)) && await vis(p, '.search-trip')]);
    await p.tap('[data-res="0"]');
    await p.setViewportSize({ width: w, height: h });   // 키보드 내려감
    await p.waitForFunction(() => current === 'result' && state.sims, null, { timeout: 90000 }); await p.waitForTimeout(1200);
    res.push([`${w}x${h} 결과: 걷기 시작 버튼 보임`, await vis(p, '#start-walk')]);
    res.push([`${w}x${h} 결과: 두 카드의 시간 보임`, await vis(p, '#card-jjuk .mins') || await vis(p, '#card-short .mins')]);
    await p.setViewportSize({ width: w, height: h - 80 });   // 브라우저 하단 막대가 있는 경우(약 80px)
    await p.waitForTimeout(600);
    res.push([`${w}x${h - 80} 하단 막대: 걷기 시작 버튼 보임`, await vis(p, '#start-walk')]);
    await c.close();
  }
  await b.close();
  for (const [n, ok] of res) console.log(ok ? 'PASS' : 'FAIL', n);
  process.exitCode = res.some(r => !r[1]) ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
