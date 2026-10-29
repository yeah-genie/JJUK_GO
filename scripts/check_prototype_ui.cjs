// Run with Playwright installed: node scripts/check_prototype_ui.cjs
// Isolated UI checks; the untracked Seoul map data is not needed.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.UI_BROWSER ? { channel: process.env.UI_BROWSER } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const root = path.resolve(__dirname, '../docs/prototype');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
    await page.route('**/*', route => route.fulfill({ status: 200, body: '' }));
    await page.goto('http://jjukgo.test');
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
    await page.addScriptTag({ content: 'const maplibregl = { addProtocol() {} };' });
    await page.addScriptTag({ content: app.replace(/boot\(\);\s*$/, '') });
    await page.evaluate(() => {
      $('s-home').hidden = false;
      $('sheet-home').classList.add('full');
      $('sheet-home').style.setProperty('--h', '300px');
      setDeadline(9 * 3600 + 59 * 60);
    });
    await page.getByRole('button', { name: '1분 늦게', exact: true }).click();
    assert.equal(await page.evaluate(() => state.deadline), 36000);
    await page.getByRole('button', { name: '마감 없음', exact: true }).click();
    assert.equal(await page.locator('#deadline-hour').isDisabled(), true);
    await page.getByRole('button', { name: '마감 없음', exact: true }).click();
    assert.equal(await page.evaluate(() => state.deadline), 36000);
    await page.locator('#deadline-hour').fill('25');
    await page.locator('#deadline-hour').press('Tab');
    assert.equal(await page.evaluate(() => state.deadline), 36000);
    await page.evaluate(() => setDeadline(86340));
    await page.getByRole('button', { name: '1분 늦게', exact: true }).click();
    assert.equal(await page.evaluate(() => state.deadline), 86340);
    await page.evaluate(() => setDeadline(0));
    await page.getByRole('button', { name: '1분 일찍', exact: true }).click();
    assert.equal(await page.evaluate(() => state.deadline), 0);
    for (const bad of [null, 'broken', -1, 86400, 1.5]) {
      await page.evaluate(value => setDeadline(value), bad);
      assert.equal(await page.evaluate(() => state.deadline), bad === null ? null : 33000);
    }
    await page.evaluate(() => setDeadline(33000));
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => {
        const row = document.querySelector('.deadline-row');
        return row.scrollWidth <= row.clientWidth;
      }), true, `time picker fits ${width}px`);
    }
    if (process.env.UI_SHOTS) {
      fs.mkdirSync(process.env.UI_SHOTS, { recursive: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(process.env.UI_SHOTS, 'time-picker.png') });
    }
    await page.evaluate(() => {
      $('s-home').hidden = true;
      $('s-result').hidden = false;
      $('sheet-result').classList.add('full');
      $('sheet-result').style.setProperty('--h', '65%');
      $('result-options').open = true;
      $('from-name').textContent = '서대문역';
      $('to-name').textContent = '청계광장';
      state.sims = {jjuk:{knownN:2,unknownN:5,total:600,wait:20},short:{knownN:2,unknownN:5,total:600,wait:20}};
      state.focus='jjuk';state.same=false;
      renderGoCard();
      $('departure-options').open=true;
    });
    const card = await page.locator('#go-card').innerText();
    assert.match(card,/출발 기준/);
    assert.doesNotMatch(card,/초 뒤 출발/);
    assert.match(await page.locator('#go-foot').innerText(),/미확인 5곳은 45초씩/);
    if (process.env.UI_SHOTS) await page.screenshot({ path: path.join(process.env.UI_SHOTS, 'result-card.png') });
    // 팀 보고서(Sally 발견 1·5·6, Winston 결함 7): 터치 타깃 44px, 보조 글씨 12.5px, 버튼 줄 구조, 접근성 속성
    const css = html.slice(html.indexOf('/* 레이아웃:'), html.indexOf('</style>'));   // MapLibre 기본 CSS는 제외
    const tiny = [];
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const [, px] of body.matchAll(/font(?:-size)?:\s*(?:[0-9]+\s+)?(\d+(?:\.\d+)?)px/g)) {
        if (+px < 12.5 && !/\.badge|\.map-attrib|\.m-sig/.test(sel)) tiny.push(sel.trim().slice(0, 40) + ' ' + px);
      }
    }
    assert.deepEqual(tiny, [], '12.5px 미만 글씨: ' + tiny.join(', '));
    const targets = await page.evaluate(() => {
      const bad = [];
      const size = (sel, prop, min) => document.querySelectorAll(sel).forEach(e => { const v = parseFloat(getComputedStyle(e)[prop]); if (!(v >= min)) bad.push(sel + ' ' + prop + '=' + v); });
      size('.icon-btn', 'width', 44); size('.icon-btn', 'height', 44);
      for (const sel of ['.chip', '.link-btn', '.trip-pt', '[data-time-step]', '.time-unit input', '.gc-row .use']) size(sel, 'minHeight', 44);
      size('.time-unit button', 'width', 44);
      return { bad, role: $('pace-chips').getAttribute('role'), label: $('pace-chips').getAttribute('aria-label'),
        homeFooter: !!$('home-actions').closest('.sheet-footer'), walkFooter: !!$('walk-done').closest('.sheet-footer'), demoHidden: $('walk-demo').hidden };
    });
    assert.deepEqual(targets.bad, []);
    assert.equal(targets.role, 'group'); assert.equal(targets.label, '길찾기에 쓸 속도');
    assert.equal(targets.homeFooter, true); assert.equal(targets.walkFooter, true); assert.equal(targets.demoHidden, true);
    console.log('PASS: time controls, validation, restore, day bounds, responsive layout, optional departure summary, touch targets, small text, footer buttons');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
