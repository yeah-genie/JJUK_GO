// 실제 브라우저(Playwright)로 화면 구조·지도 렌더·스크롤 여유·상태 문구를 확인한다.
// CI에는 브라우저가 없어 playwright가 없으면 건너뛴다(구조 시험은 check_app_shell.cjs).
// 실행: node scripts/check_screens.cjs   (미리보기 서버가 8771에서 돌고 있으면 재사용, 없으면 잠깐 띄운다)
const http = require('node:http'), path = require('node:path'), { spawn } = require('node:child_process'), assert = require('node:assert/strict');
let chromium;
for (const m of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { ({ chromium } = require(m)); break; } catch {} }
if (!chromium) { console.log('SKIP screens: playwright가 설치돼 있지 않아요'); process.exit(0); }

const BASE = 'http://127.0.0.1:8771/', VIEWPORTS = [[390, 844], [360, 640]];
const ping = () => new Promise(r => http.get(BASE, res => { res.resume(); r(res.statusCode === 200); }).on('error', () => r(false)));
const wait = ms => new Promise(r => setTimeout(r, ms));
const YELLOW = 'rgb(246, 195, 67)';
// DESIGN_SYSTEM 토큰: bg #242A32, surface #303844, line #46505D, text #F4F2E9, muted #B7BEC8, yellow #F6C343, control-line #8793A3
const TOKENS = new Set(['rgb(36, 42, 50)', 'rgb(48, 56, 68)', 'rgb(70, 80, 93)', 'rgb(244, 242, 233)', 'rgb(183, 190, 200)', YELLOW, 'rgb(135, 147, 163)']);

// 스크린샷을 빈 페이지의 캔버스로 읽어, 구역에서 가장 흔한 한 색이 차지하는 비율을 구한다(단색에 가까우면 지도가 안 그려진 것).
async function dominantShare(helper, png, rect) {
  return helper.evaluate(async ([b64, r]) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const count = new Map(); let total = 0;
    for (let yy = Math.floor(r.y); yy < r.y + r.h; yy += 2) for (let xx = Math.floor(r.x); xx < r.x + r.w; xx += 2) { const d = x.getImageData(xx, yy, 1, 1).data, k = d[0] >> 2 << 16 | d[1] >> 2 << 8 | d[2] >> 2; count.set(k, (count.get(k) || 0) + 1); total++; }
    return Math.max(...count.values()) / total;
  }, [png.toString('base64'), rect]);
}

const results = [];
const ok = name => { results.push(name); };
const LEARNING = { version: 2, onboarded: true, paceHint: 'similar', equipment: [], equipmentAnswered: true, learned: { speed: null, seconds: 60, windows: 3 } };
const DONE = { version: 2, onboarded: true };

async function newPage(browser, w, h, errors, profile, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
  if (profile) await page.addInitScript(p => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('jjukgo:profile', JSON.stringify(p)); sessionStorage.setItem('seeded', '1'); } } catch {} }, profile);
  return page;
}
const rectOf = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; }, sel);
const text = (page, sel) => page.evaluate(s => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim(), sel);
const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e || e.closest('[hidden]')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);
const css = (page, sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
async function untilTrue(page, fn, arg, what, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return; await wait(250); }
  throw new Error('시간 초과: ' + what);
}
// 시작 로고 화면이 끝나고 홈이 그려질 때까지 기다린다(고정 대기는 로고 화면 길이에 따라 흔들린다).
const homeReady = (page, what = '홈') => untilTrue(page, () => current === 'home' && !!document.getElementById('home-pace') && document.getElementById('home-pace').textContent.trim().length > 0, null, what, 40000).then(() => wait(600));
const resultReady = (page, what) => untilTrue(page, () => current === 'result' && !document.getElementById('result-content').hidden && !!state.sims, null, what);
// 좌표로 길 열기(빠른 길 vs 쭉고 길 비교판 시험용)
async function openLL(page, a, b) {
  await page.evaluate(([a, b]) => {
    state.from = { name: '출발', ll: [a[1], a[0]] }; state.to = { name: '도착', ll: [b[1], b[0]] }; state.mode = 'example'; BASE = 31200;
    state.routes = null; state.tripKey = null; state.fixedRoute = null; state.dep = 0; state.error = null; state.sims = null; state.focus = 'jjuk'; go('result');
  }, [a, b]);
  await resultReady(page, '좌표 길');
}
async function openTrip(page, a, b) {
  await page.evaluate(async ([a, b]) => {
    const rows = (await getJSON('search.json')).map(([name, x, y]) => ({ name, ll: fromQ(x, y) }));
    const f = n => rows.find(r => r.name === n);
    state.from = { name: a, ll: f(a).ll }; state.to = { name: b, ll: f(b).ll }; state.mode = 'example'; BASE = 31200;
    state.routes = null; state.tripKey = null; state.fixedRoute = null; state.dep = 0; state.error = null; state.sims = null; state.focus = 'jjuk'; go('result');
  }, [a, b]);
  await resultReady(page, `${a}→${b} 결과`); await wait(500);
}
// 요소가 화면 안에 완전히 들어오고 다른 요소에 가려지지 않는지
async function assertInViewport(page, sel, tag, what) {
  const r = await page.evaluate(s => { const e = document.querySelector(s), b = e.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: innerWidth, h: innerHeight, covered: !(hit && (hit === e || e.contains(hit) || hit.contains(e))) }; }, sel);
  assert(r.top >= 0 && r.bottom <= r.h && r.left >= 0 && r.right <= r.w, `${tag} ${what}가 화면 밖으로 나가요 ${JSON.stringify(r)}`);
  assert(!r.covered, `${tag} ${what}가 다른 요소에 가려져요`);
}
async function assertNoOverflow(page, tag, what) {
  const o = await page.evaluate(() => { const bad = []; for (const e of document.querySelectorAll('.screen:not([hidden]) *')) { if (e.closest('[hidden]')) continue; const cs = getComputedStyle(e); const bar = e.offsetWidth - e.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth); if (bar > 0.5 && ['auto', 'scroll'].includes(cs.overflowY) && e.clientWidth > 0) bad.push(`${e.tagName}#${e.id}.${e.className} 스크롤바 ${bar}px`); } return { sw: document.documentElement.scrollWidth, iw: innerWidth, bad }; });
  assert(o.sw <= o.iw, `${tag} ${what} 가로 넘침 ${o.sw}>${o.iw}`);
  assert.deepEqual(o.bad, [], `${tag} ${what} 스크롤바가 보여요`);
}
async function mapDraw(helper, page, sheetSel, tag, what, limit = 0.6) {
  // 타일이 다 올라온 뒤에 찍는다. 올라오기 전 캡처는 지도가 비어 보여 거짓 실패가 난다.
  await page.waitForFunction(() => map && map.loaded() && !map.isMoving(), null, { timeout: 30000 }).catch(() => {});
  await wait(400);
  const shot = await page.screenshot(), mp = await page.evaluate(() => { const r = map.getContainer().getBoundingClientRect(); return { t: r.top, h: r.height }; });
  const sheetTop = (await rectOf(page, sheetSel)).y, seg = (sheetTop - mp.t) / 3, w = page.viewportSize().width;
  for (let i = 0; i < 3; i++) {
    const share = await dominantShare(helper, shot, { x: 150, y: mp.t + i * seg + 6, w: w - 150 - 60, h: seg - 12 });
    assert(share < limit, `${tag} ${what} 지도 ${['위', '가운데', '아래'][i]} 구역이 단색에 가까워요(최다 색 ${(share * 100).toFixed(0)}%)`);
  }
}

(async () => {
  let server = null;
  if (!(await ping())) { server = spawn(process.execPath, [path.join(__dirname, 'preview.cjs')], { stdio: 'ignore' }); for (let i = 0; i < 30 && !(await ping()); i++) await wait(100); }
  const browser = await chromium.launch();
  const errors = [];
  try {
    const helper = await (await browser.newContext()).newPage();
    for (const [w, h] of VIEWPORTS) {
      const tag = `${w}x${h}`;
      // ---- A. 홈 지도: 사용자 재현 절차 그대로(설문 건너뛰기 → 8초) 곧바로 캡처해도 위·가운데·아래가 모두 그려진다.
      // rAF 폴링 같은 대기는 화면을 다시 그리게 해 문제를 가리므로 고정 시간만 기다린다.
      let page = await newPage(browser, w, h, errors);
      await page.goto(BASE + '#home'); await untilTrue(page, () => current === 'onboarding', null, '첫 설문', 40000); await wait(300);
      await page.click('#onboarding-skip'); await wait(8000);
      const dims = await page.evaluate(() => { const c = map.getCanvas().getBoundingClientRect(), m = document.getElementById('map-home').getBoundingClientRect(); return { c: [c.top, c.height, c.width], m: [m.top, m.height, m.width], tr: [map.transform.width, map.transform.height] }; });
      await mapDraw(helper, page, '#sheet-home', tag, '홈');
      assert.deepEqual(dims.c.map(Math.round), dims.m.map(Math.round), `${tag} 홈 지도 캔버스가 컨테이너와 다름 ${JSON.stringify(dims)}`);
      assert.deepEqual(dims.tr.map(Math.round), [dims.m[2], dims.m[1]].map(Math.round), `${tag} 지도 내부 크기가 컨테이너와 다름`);
      ok(`A ${tag} 홈 지도 전체 렌더(캔버스=컨테이너, 위·가운데·아래 구역 비어 있지 않음)`);
      await page.click('[data-trip="demo"]'); await resultReady(page, '예시 길'); await wait(5000);
      await mapDraw(helper, page, '#sheet-result', tag, '결과');
      await page.evaluate(() => go('home')); await wait(5000);
      // 결과 경로 범위로 맞춰진 작은 화면 홈은 넓은 녹지·땅 면이 위쪽을 채워 64%까지 나온다(직접 눈으로 확인). 비어 있는 지도는 100%에 가까우므로 이 확인만 기준을 0.8로 둔다.
      await mapDraw(helper, page, '#sheet-home', tag, '결과에서 돌아온 홈', 0.8);
      ok(`A ${tag} 결과·홈 왕복 뒤에도 지도 렌더`);
      await assertNoOverflow(page, tag, '홈');
      await assertInViewport(page, '#home-actions .btn-primary', tag, '홈 주 행동');
      assert.equal(await text(page, '#home-pace'), '내 걸음 · 아직 측정 전'); assert.match(await text(page, '#home-pace-row'), /설정 ›$/);
      await page.context().close();

      // ---- B. 설정: 휠로 끝까지 스크롤하면 마지막 항목이 '적용' 위로 온전히 보이고, 어떤 요소도 푸터와 겹치지 않는다.
      page = await newPage(browser, w, h, errors, DONE);
      await page.goto(BASE + '#settings'); await page.waitForSelector('#s-settings:not([hidden])');
      for (const manualOpen of [false, true]) {
        if (manualOpen) await page.click('#settings-manual summary');
        await page.mouse.move(w / 2, h / 2); await page.mouse.wheel(0, 5000); await wait(400);
        const sb = await page.evaluate(() => {
          const sc = document.querySelector('.settings-content'), f = document.querySelector('#s-settings .sheet-footer').getBoundingClientRect();
          const over = [...sc.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && getComputedStyle(e).display !== 'inline' && r.bottom > f.top + 0.5 && r.top < f.bottom; }).map(e => e.id || e.tagName);
          const last = [...sc.querySelectorAll('button,input,summary,select,label')].filter(e => e.getBoundingClientRect().height > 0).pop().getBoundingClientRect();
          return { canScroll: sc.scrollHeight > sc.clientHeight, atEnd: sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1, footTop: f.top, lastBottom: last.bottom, over, contentBottom: sc.getBoundingClientRect().bottom };
        });
        assert(sb.atEnd, `${tag} 설정이 휠로 끝까지 스크롤되지 않아요 ${JSON.stringify(sb)}`);
        assert(sb.contentBottom <= sb.footTop + 0.5, `${tag} 설정 스크롤 영역이 푸터 밑으로 내려가요`);
        assert.deepEqual(sb.over, [], `${tag} 설정 끝에서 푸터와 겹치는 요소 ${sb.over}`);
        assert(sb.lastBottom + 8 <= sb.footTop, `${tag} 설정 마지막 항목이 적용 버튼에 가려져요 ${JSON.stringify(sb)}`);
      }
      await assertInViewport(page, '#settings-apply', tag, '설정 적용 버튼');
      await assertNoOverflow(page, tag, '설정');
      ok(`B ${tag} 설정 마지막 항목이 적용 버튼 위로 보임(직접 정하기 열린 상태 포함)`);
      await page.context().close();

      // ---- D. 설문: 로고 표식·진행 막대·선택 전 다음 비활성·승인 시안 문구·토큰 색.
      page = await newPage(browser, w, h, errors);
      await page.goto(BASE + '#home'); await page.waitForSelector('#s-onboarding:not([hidden])'); await wait(600);
      const marks = await page.evaluate(() => [...document.querySelectorAll('#s-onboarding .brand .lane-mark i')].map(i => getComputedStyle(i).backgroundColor));
      assert.equal(marks.length, 2, `${tag} 설문 로고 옆 차선 표식 두 개`); assert.equal(marks[0], YELLOW, `${tag} 첫 표식은 노랑`); assert(TOKENS.has(marks[1]) && marks[1] !== YELLOW, `${tag} 둘째 표식은 회색 토큰 ${marks[1]}`);
      assert.equal(await text(page, '#onboarding-step'), '1 / 2'); assert.equal(await css(page, '#onboarding-step b', 'color'), YELLOW);
      const bars = await page.evaluate(() => [...document.querySelectorAll('#onboarding-progress i')].map(i => getComputedStyle(i).backgroundColor));
      assert.deepEqual(bars.map(b => b === YELLOW), [true, false], `${tag} 1/2 진행 막대는 노랑·회색 ${bars}`); assert(TOKENS.has(bars[1]));
      assert.equal(await text(page, '#onboarding-title'), '다른 사람과 걸으면?'); assert.equal(await text(page, '#onboarding-copy'), '처음 길을 추천할 때 참고해요');
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#onboarding-answers [data-pace-hint] > span:first-child')].map(e => e.textContent)), ['조금 뒤처지는 편이에요', '비슷하게 걷는 편이에요', '앞서가는 편이에요', '잘 모르겠어요']);
      assert.equal(await text(page, '#onboarding-hint'), '걸음 속도는 걷는 동안 맞춰요'); assert.equal(await text(page, '#onboarding-note'), '나중에 설정할 수 있어요');
      assert(await page.evaluate(() => document.getElementById('onboarding-next').disabled), `${tag} 선택 전 다음은 비활성`);
      assert.notEqual(await css(page, '#onboarding-next', 'backgroundColor'), YELLOW, `${tag} 비활성 다음이 노란 활성처럼 보여요`); assert.equal(await css(page, '#onboarding-next', 'opacity'), '1', `${tag} 비활성을 투명도로만 표현해요`);
      assert(!(await page.evaluate(() => document.getElementById('onboarding-skip').disabled)), '건너뛰기는 항상 활성');
      await assertInViewport(page, '#onboarding-skip', tag, '건너뛰기'); await assertInViewport(page, '#onboarding-next', tag, '다음');
      for (const sel of ['[data-pace-hint="behind"]', '[data-pace-hint="unknown"]']) await assertInViewport(page, sel, tag, '설문 선택지 ' + sel);
      await page.click('[data-pace-hint="unknown"]');   // 잘 모르겠어요도 유효 응답
      assert(!(await page.evaluate(() => document.getElementById('onboarding-next').disabled)), `${tag} '잘 모르겠어요' 뒤 다음 활성`);
      assert.equal(await css(page, '#onboarding-next', 'backgroundColor'), YELLOW);
      assert.equal(await page.getAttribute('[data-pace-hint="unknown"]', 'aria-checked'), 'true'); assert.equal(await page.getAttribute('[data-pace-hint="behind"]', 'aria-checked'), 'false');
      const bad = await page.evaluate(allowed => { const out = new Set(); for (const e of document.querySelectorAll('#s-onboarding, #s-onboarding *')) { const cs = getComputedStyle(e); for (const p of ['color', 'backgroundColor']) { const v = cs[p]; if (!/rgba\(.*, 0\)|transparent/.test(v) && !allowed.includes(v)) out.add(`${e.id || e.className || e.tagName}.${p}=${v}`); } for (const s of ['Top', 'Bottom']) if (parseFloat(cs['border' + s + 'Width']) > 0 && !allowed.includes(cs['border' + s + 'Color'])) out.add(`${e.id || e.className}.border${s}=${cs['border' + s + 'Color']}`); } return [...out]; }, [...TOKENS]);
      assert.deepEqual(bad, [], `${tag} 설문에 토큰 밖 색: ${bad}`);
      ok(`D ${tag} 설문 로고 표식·진행 막대·비활성 다음·시안 문구·토큰 색`);
      // E1. 설문 2단계
      await page.click('#onboarding-next'); await wait(200);
      assert.equal(await text(page, '#onboarding-step'), '2 / 2');
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#onboarding-progress i')].map(i => getComputedStyle(i).backgroundColor === 'rgb(246, 195, 67)')), [true, true]);
      assert.equal(await text(page, '#onboarding-title'), '오늘 함께하는 것이 있나요?');
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#onboarding-answers [data-equipment] > span:first-child')].map(e => e.textContent)), ['없음', '유모차', '보행 보조기', '지팡이', '무거운 짐', '기타']);
      const eq = sel => page.getAttribute(`[data-equipment="${sel}"]`, 'aria-checked');
      assert.equal(await eq('none'), 'false', `${tag} 아직 선택하지 않음과 명시적 없음은 달라요`);
      await page.click('[data-equipment="stroller"]'); await page.click('[data-equipment="cane"]');
      assert.deepEqual([await eq('stroller'), await eq('cane'), await eq('none')], ['true', 'true', 'false'], `${tag} 장비는 복수 선택`);
      await page.click('[data-equipment="none"]');
      assert.deepEqual([await eq('stroller'), await eq('cane'), await eq('none')], ['false', 'false', 'true'], `${tag} 없음은 배타`);
      await page.click('[data-equipment="walker"]'); assert.equal(await eq('none'), 'false');
      await page.locator('[data-equipment="other"]').scrollIntoViewIfNeeded(); await assertInViewport(page, '[data-equipment="other"]', tag, '설문 2단계 마지막 선택지(스크롤해서 도달)'); await assertInViewport(page, '#onboarding-next', tag, '2단계 시작하기');
      await assertNoOverflow(page, tag, '설문');
      ok(`E ${tag} 설문 2단계: 문구·복수 선택·없음 배타·미선택≠없음`);
      await page.context().close();

      // ---- C. 결과: 같은 후보(예시 길)는 한 행, 서로 다른 후보는 두 행+점선 대안.
      page = await newPage(browser, w, h, errors, DONE);
      await page.goto(BASE + '#home'); await homeReady(page);
      await page.click('[data-trip="demo"]'); await resultReady(page, '예시 길'); await wait(600);
      assert(await page.evaluate(() => state.same), '예시 길은 두 후보가 같은 길(시험 전제)');
      assert(await visible(page, '#card-jjuk')); assert(!(await visible(page, '#card-short')), `${tag} 같은 후보인데 두 번째 행이 보여요`);
      assert.match(await text(page, '#card-jjuk'), /\d+분/); assert.doesNotMatch(await text(page, '#card-jjuk'), /\+\d+분/, `${tag} 같은 후보에 거짓 추가 시간`);
      assert.equal(await page.evaluate(() => map.getSource('rs')._data.features.length), 0, `${tag} 같은 후보에 점선 대안이 그려져요`);
      assert.equal(await text(page, '#result-pace'), '내 걸음 · 아직 측정 전');
      assert(await visible(page, '#calc-basis')); assert.match(await text(page, '#calc-basis'), /^자세히 비교/);
      assert.equal(await page.getAttribute('#calc-basis', 'aria-expanded'), 'false'); assert(!(await visible(page, '#result-options')));
      assert.equal(await text(page, '#compare-line'), '비슷한 시간 안에 더 편한 길이 없어서 빠른 길을 안내해요', `${tag} 대안 없음 문구`);
      assert.equal(await text(page, '#card-jjuk .name'), '빠른 길', `${tag} 대안이 없으면 빠른 길 한 행`);
      const metricText = await text(page, '#route-metrics');
      for (const w of ['걷는 시간', '신호 횡단', '계단', '오르막', '급경사']) assert(metricText.includes(w), `${tag} 원시 지표 ${w}`);
      assert(await page.evaluate(() => document.getElementById('route-metrics').classList.contains('one')), `${tag} 대안 없으면 한 열`);
      assert(!(await visible(page, '#unknown-xings')), `${tag} 비교판에서는 미확인 횡단 행을 숨김`);
      assert.equal(await text(page, '#adjust-conditions'), '조건 조정'); assert.equal(await text(page, '#start-walk'), '이 길로 걷기');
      assert.equal(await text(page, '#route-headline'), '가장 빨리 가는 길'); assert.equal(await text(page, '#route-sub'), '비슷한 시간 안에 더 편한 길이 없어요'); assert(!(await visible(page, '#route-badge')), `${tag} 대안 없으면 배지 없음`);
      assert.equal(await text(page, '#result-note'), '예상 도보 시간 · 신호 대기는 따로 표시'); await assertInViewport(page, '#result-note', tag, '도보 시간 안내');
      await assertInViewport(page, '#adjust-conditions', tag, '조건 조정'); await assertInViewport(page, '#start-walk', tag, '걷기 시작');
      const vis = await page.evaluate(() => document.querySelector('#s-result').innerText); assert.doesNotMatch(vis, /뛰세요|안전|건널 수|건너도|한 번에|여유|~\s*12/, `${tag} 결과에 금지 문구(횡단 판단·안전·여유)`); assert.doesNotMatch(vis, /보장(?!하지)/);
      await mapDraw(helper, page, '#sheet-result', tag, '결과(같은 후보)');
      await page.click('#calc-basis'); await wait(300);   // 계산 기준 열기/닫기
      assert.equal(await page.getAttribute('#calc-basis', 'aria-expanded'), 'true'); assert(await visible(page, '#result-options'));
      assert.match(await text(page, '#result-options'), /걷는 시간만/); assert.match(await text(page, '#result-options'), /실시간/);
      await assertInViewport(page, '#start-walk', tag, '계산 기준을 연 뒤 걷기 시작');
      await page.click('#calc-basis'); await wait(200); assert(!(await visible(page, '#result-options')));
      await assertNoOverflow(page, tag, '결과');
      await page.click('#adjust-conditions'); await page.waitForSelector('#s-settings:not([hidden])');   // 조건 조정 → 설정 → 취소하면 결과로 복귀
      await page.click('#settings-back'); await page.waitForSelector('#s-result:not([hidden])');
      ok(`C ${tag} 대안 없음: 빠른 길 한 행·점선 없음·원시 지표·계산 기준·조건 조정→설정→복귀`);

      await openLL(page, [37.5551, 126.9368], [37.5571, 126.9245]);   // 신촌역 → 홍대입구역(QA에서 쭉고 길이 나온 길, 서울숲처럼 큰 공원 때문에 지도 검사가 흔들리지 않는 곳)
      assert(!(await page.evaluate(() => state.same)), '신촌역→홍대입구역은 쭉고 길이 있는 길(시험 전제)');
      assert(await visible(page, '#card-jjuk')); assert(await visible(page, '#card-short'));
      const rows = await page.evaluate(() => ['jjuk', 'short'].map(k => { const c = document.getElementById('card-' + k), r = c.getBoundingClientRect(), n = c.querySelector('.mins').getBoundingClientRect(); return { name: c.querySelector('.name').textContent, t: c.querySelector('.mins').textContent, pressed: c.getAttribute('aria-pressed'), w: r.width, h: r.height, base: n.bottom - r.top }; }));
      assert.equal(rows[0].name, '쭉고 길'); assert.equal(rows[1].name, '빠른 길');
      assert(Math.abs(rows[0].w - rows[1].w) < 1 && Math.abs(rows[0].h - rows[1].h) < 1, `${tag} 두 탭 크기 50:50 ${JSON.stringify(rows)}`); assert(Math.abs(rows[0].base - rows[1].base) < 1.5, `${tag} 두 시간 글자 기준선 ${JSON.stringify(rows)}`);
      assert.match(await text(page, '#route-headline'), /(피하는|줄이는) 길$/); assert(await visible(page, '#route-badge')); assert.match(await text(page, '#route-sub'), /^약 .+ 추가/);
      assert(/\d+분/.test(rows[0].t) && /\d+분/.test(rows[1].t)); assert.deepEqual(rows.map(r => r.pressed), ['true', 'false']);
      assert.match(await text(page, '#compare-line'), /^\+.+(줄일|피할) 수 있어요$/, `${tag} 한 줄 설명`);
      assert(!(await page.evaluate(() => document.getElementById('route-metrics').classList.contains('one'))), `${tag} 두 열 비교`);
      const ex = await page.evaluate(() => { const R = state.routes; return { ok: R.alt, extra: R.jjuk.m.walk - R.short.m.walk }; });
      assert(ex.ok && ex.extra > 10 && ex.extra <= 180, `${tag} 쭉고 길 추가 시간 10초 초과 3분 이하 ${JSON.stringify(ex)}`);
      const feat = () => page.evaluate(() => ({ sel: map.getSource('rj')._data.features[0].geometry.coordinates.length, alt: map.getSource('rs')._data.features[0].geometry.coordinates.length, want: state.routes[state.focus].coords.length, other: state.routes[state.focus === 'jjuk' ? 'short' : 'jjuk'].coords.length }));
      let f = await feat(); assert.equal(f.sel, f.want, `${tag} 선택 후보와 강조 경로가 달라요`); assert.equal(f.alt, f.other, `${tag} 점선 대안이 다른 후보가 아니에요`);
      assert.equal(await page.evaluate(() => map.getStyle().layers.find(l => l.id === 'route-short').paint['line-color']), '#959EAC', `${tag} 빠른 길은 회색 실선`);
      await assertInViewport(page, '#card-short', tag, '두 번째 경로 행'); await assertInViewport(page, '#start-walk', tag, '걷기 시작'); await assertInViewport(page, '#adjust-conditions', tag, '조건 조정');
      await page.click('#card-short'); await wait(500);
      assert.deepEqual(await page.evaluate(() => ['jjuk', 'short'].map(k => document.getElementById('card-' + k).getAttribute('aria-pressed'))), ['false', 'true']);
      f = await feat(); assert.equal(f.sel, f.want, `${tag} 선택을 바꾼 뒤 강조 경로`); assert.equal(f.alt, f.other);
      await mapDraw(helper, page, '#sheet-result', tag, '결과(두 후보)');
      const ov = await page.evaluate(() => { const sh = document.getElementById('sheet-result').getBoundingClientRect(); return [...document.querySelectorAll('#mapctl button')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect()).filter(r => r.bottom > sh.top + 0.5).length; });
      assert.equal(ov, 0, `${tag} 지도 조작 버튼이 결과 시트와 겹쳐요`);
      await page.click('#calc-basis'); await wait(300); assert(!(await visible(page, '#mapctl')) || (await page.evaluate(() => { const sh = document.getElementById('sheet-result').getBoundingClientRect(); return [...document.querySelectorAll('#mapctl button')].filter(b => b.offsetParent).every(b => b.getBoundingClientRect().bottom <= sh.top + 0.5); })), `${tag} 계산 기준을 열면 조작 버튼이 시트 위에 떠요`); await assertInViewport(page, '#start-walk', tag, '계산 기준 연 상태 걷기 시작'); await page.click('#calc-basis'); await wait(200);
      await assertNoOverflow(page, tag, '결과(두 후보)');
      // 예상 신호 대기 문구(신뢰된 패턴이 있을 때): 두 길의 대기 값을 고정해 화면 문구만 시험한다(계산은 check_walk_logic이 시험)
      await page.click('#card-jjuk'); await wait(300);
      await page.evaluate(() => { const R = state.routes; Object.assign(R.short.m, { wait: 130, waitKnown: 2, waitUnknown: 0, waitTotal: 2 }); Object.assign(R.jjuk.m, { wait: 80, waitKnown: 2, waitUnknown: 0, waitTotal: 2 }); DAYTYPE_NOW = 'wd'; renderResult(); });
      await wait(800);
      assert.equal(await text(page, '#route-headline'), '신호에서 약 50초 덜 기다릴 것으로 예상돼요', `${tag} 대기 감소 대표 문장`);
      assert(await visible(page, '#route-src')); assert.match(await text(page, '#route-src'), /신호 기록 기준 추정/, `${tag} 출처 표시`);
      assert.match(await text(page, '#route-sub'), /^약 .+ 추가/);
      await page.click('#calc-basis'); await wait(400);
      assert.match(await text(page, '#route-metrics'), /예상 신호 대기[\s\S]*1분 20초[\s\S]*2분 10초/, `${tag} 자세히 비교에 예상 신호 대기 행`);
      assert.match(await text(page, '#wait-note'), /신호 패턴이 확인된 곳만/, `${tag} 확인된 곳만 더했다는 안내`);
      assert.doesNotMatch(await page.evaluate(() => document.querySelector('#s-result').innerText), /건널 수|건너도|한 번에|여유|안전/, `${tag} 횡단 판단 문구 금지`);
      await page.click('#calc-basis'); await wait(200);
      ok(`C ${tag} 쭉고 길: 두 행·추가 시간·한 줄 설명·두 열 지표·점선 대안·선택 일치·버튼 화면 안`);
      await page.context().close();

      // ---- E3. 학습 부족 결과 / E5 직접 조절 / E6 초기화 확인
      page = await newPage(browser, w, h, errors, LEARNING);
      await page.goto(BASE + '#home'); await homeReady(page);
      assert.equal(await text(page, '#home-pace'), '내 걸음을 알아가는 중');
      await page.click('[data-trip="demo"]'); await resultReady(page, '예시 길'); await wait(500);
      assert.equal(await text(page, '#result-pace'), '내 걸음을 알아가는 중'); assert(await visible(page, '#route-headline'));
      assert.doesNotMatch(await page.evaluate(() => document.querySelector('#s-result').innerText), /\d+\s*초/);
      await assertInViewport(page, '#start-walk', tag, '학습 부족 결과의 걷기 시작');
      ok(`E ${tag} 학습 부족 결과: 내 걸음을 알아가는 중 · 원시 지표`);
      await page.evaluate(() => go('settings')); await page.waitForSelector('#s-settings:not([hidden])');
      assert.equal(await text(page, '#settings-pace-state'), '내 걸음을 알아가는 중');
      assert(!(await page.evaluate(() => document.getElementById('settings-manual').open)), `${tag} 직접 정하기는 접혀 있어야 해요`);
      await page.click('#settings-manual summary'); await wait(200); assert(await page.evaluate(() => document.getElementById('settings-manual').open)); await assertInViewport(page, '#manual-speed', tag, '직접 정하기 슬라이더');
      const rg = await page.evaluate(() => { const r = document.getElementById('manual-speed'); return { min: +r.min, max: +r.max, lo: PACE.MIN * 3.6, hi: PACE.MAX * 3.6, out: document.getElementById('manual-speed-value').textContent, lab: !!document.querySelector('label[for="manual-speed"]') }; });
      assert(Math.abs(rg.min - rg.lo) < 1e-9 && Math.abs(rg.max - rg.hi) < 1e-9 && rg.lab && /km\/h$/.test(rg.out), `${tag} 직접 조절 범위·단위 ${JSON.stringify(rg)}`);
      await page.fill('#manual-speed', '2.5'); assert.equal(await text(page, '#manual-speed-value'), '2.5 km/h');
      ok(`E ${tag} 직접 조절: 접힘→펼침, 범위·단위가 학습 모듈과 일치`);
      await page.click('#settings-manual summary');
      await page.evaluate(() => { const p = readProfile(); p.learned = { speed: 0.9, seconds: 400, windows: 8 }; writeProfile(p); renderSettings(); });
      await page.click('#reset-learning'); await wait(200);   // 초기화 확인: 범위 설명 + 취소 가능
      assert(await visible(page, '#reset-confirm')); assert.match(await text(page, '#reset-confirm'), /속도 요약만/); assert.match(await text(page, '#reset-confirm'), /설문 답|최근 장소/);
      await assertInViewport(page, '#reset-confirm-yes', tag, '초기화 확인 버튼'); await assertInViewport(page, '#reset-confirm-no', tag, '초기화 취소 버튼');
      await page.click('#reset-confirm-no'); await wait(200); assert(!(await visible(page, '#reset-confirm')));
      assert.equal(await page.evaluate(() => readProfile().learned.speed), 0.9, `${tag} 취소했는데 학습값이 지워졌어요`);
      await page.click('#reset-learning'); await page.click('#reset-confirm-yes'); await wait(300);
      assert.deepEqual(await page.evaluate(() => { const p = readProfile(); return [p.learned.speed, p.learned.seconds, p.paceHint, p.onboarded]; }), [null, 0, 'similar', true], `${tag} 초기화는 속도 요약만 지워야 해요`);
      assert.equal(await text(page, '#settings-pace-state'), '아직 측정 전'); assert(!(await visible(page, '#reset-confirm')));
      ok(`E ${tag} 초기화 확인: 범위 설명·취소 보존·확인 시 속도 요약만 삭제`);
      await page.context().close();

      // ---- E2/E4. 위치 권한 거부(홈·걷기)와 측정 중지·다시 연결
      page = await newPage(browser, w, h, errors, DONE, { permissions: [] });
      await page.goto(BASE + '#home'); await homeReady(page);
      await page.click('[data-locate]'); await untilTrue(page, () => /위치를 연결하지 못했어요/.test(document.getElementById('location-status').textContent), null, '홈 권한 거부 문구');
      assert.match(await text(page, '#location-status'), /지도에서/, `${tag} 홈 거부 문구에 다음 행동`);
      assert(await visible(page, '#home-actions [data-search="from"]'), `${tag} 지도에서 출발 선택 버튼`); assert(await visible(page, '#home-actions [data-locate]'), `${tag} 다시 시도 버튼`);
      await assertInViewport(page, '#location-status', tag, '홈 위치 상태'); await assertInViewport(page, '#home-actions [data-locate]', tag, '홈 주 행동');
      ok(`E ${tag} 위치 권한 거부(홈): 위치를 연결하지 못했어요 + 다시 시도/지도에서 선택`);
      await page.click('[data-trip="demo"]'); await resultReady(page, '예시 길'); await wait(500);
      await page.click('#start-walk'); await untilTrue(page, () => /위치를 연결하지 못했어요/.test(document.getElementById('walk-location').textContent), null, '걷기 권한 거부 문구');
      assert(await visible(page, '[data-gps-retry]')); assert(await visible(page, '#walk-end'));
      await assertInViewport(page, '[data-gps-retry]', tag, '위치 다시 연결'); await assertInViewport(page, '#walk-done', tag, '걷기 끝내기'); await assertInViewport(page, '#walk-end', tag, '그만 걷기');
      await mapDraw(helper, page, '#sheet-walk', tag, '걷기', 0.9);   // 낮은 지도 띠는 넓은 녹지가 한 색일 수 있어 느슨하게(빈 지도는 100%)
      await assertNoOverflow(page, tag, '걷기');
      ok(`E ${tag} 위치 권한 거부(걷기): 문구·다시 연결·종료 버튼`);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });   // 측정 중지
      await wait(200); assert.match(await text(page, '#walk-location'), /위치가 끊겨 측정을 잠시 멈췄어요/); assert(await visible(page, '[data-gps-retry]'));
      await page.evaluate(() => { delete document.hidden; });
      ok(`E ${tag} 측정 중지: 위치가 끊겨 측정을 잠시 멈췄어요 + 다시 연결`);
      await page.context().close();
    }
  } finally { await browser.close(); if (server) server.kill(); }
  assert.deepEqual(errors, [], '페이지·콘솔 오류: ' + errors.join(' | '));
  console.log('PASS screens:\n  ' + results.join('\n  '));
})().catch(e => { console.error('FAIL screens:', e.message); process.exit(1); });
