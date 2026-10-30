// 사람 없이 '걷기'를 시험한다: Playwright로 가짜 GPS 위치를 경로를 따라 25m씩 옮기며 앱 반응을 본다.
//   node scripts/preview.cjs &  →  node scripts/qa_walk_sim.cjs [출력 폴더]
// 확인: ① 남은 거리가 줄어든다 ② 경로에서 120m 벗어나면 '내 위치에서 다시 찾기'가 나오고 돌아오면 사라진다
//       ③ 도착 근처에서 '도착 · 기록 보기' ④ 위치 갱신이 30초 넘게 없으면 측정 중지 안내 ⑤ 끝내면 GPS 기록 카드
// 앱의 이동 검사(plausibleProgress)는 한 번에 60m까지 허용하므로 25m 간격·0.6초마다 옮긴다(실제 걷는 속도보다 빠르다).
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const out = process.argv[2] || path.join(__dirname, '../reports/qa/walk-sim-latest');
fs.mkdirSync(out, { recursive: true });
const TRIPS = [
  { id: 'naksan', fn: '혜화역', tn: '낙산공원', from: [37.5822, 127.0018], to: [37.5806, 127.0074] },
  { id: 'seongsu', fn: '성수역', tn: '서울숲', from: [37.5446, 127.0559], to: [37.5444, 127.0374] },
];
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const report = [];
  for (const t of TRIPS) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul', permissions: ['geolocation'], geolocation: { latitude: t.from[0], longitude: t.from[1], accuracy: 8 } });
    const p = await c.newPage(), errs = [], checks = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.addInitScript(() => { localStorage.setItem('jjukgo:profile', JSON.stringify({ version: 2, onboarded: true })); localStorage.setItem('jjukgo:seenSplash', 'true'); window.JJUKGO_NO_LOG = true; });
    await p.goto(`http://127.0.0.1:8771/?from=${t.from.join(',')}&to=${t.to.join(',')}&fn=${encodeURIComponent(t.fn)}&tn=${encodeURIComponent(t.tn)}`);
    await p.waitForFunction(() => typeof current !== 'undefined' && current === 'result' && state.sims, null, { timeout: 90000 });
    const route = await p.evaluate(() => { const k = state.same ? 'jjuk' : state.focus; return { k, coords: state.routes[k].coords, cum: state.routes[k].cum, length: state.routes[k].length }; });
    // 경로를 25m 간격 점으로
    const pts = []; for (let d = 0; d <= route.length; d += 25) pts.push(await p.evaluate(d => pointAt(state.routes[state.same ? 'jjuk' : state.focus], d), d));
    pts.push(route.coords[route.coords.length - 1]);
    await p.click('#start-walk'); await p.waitForFunction(() => current === 'walk', null, { timeout: 10000 });
    const left = () => p.evaluate(() => document.getElementById('w-left').textContent);
    const toM = s => s.endsWith('km') ? parseFloat(s) * 1000 : parseFloat(s);
    const seen = [];
    for (let i = 0; i < pts.length; i++) {
      await c.setGeolocation({ longitude: pts[i][0], latitude: pts[i][1], accuracy: 8 }); await wait(600);
      seen.push(toM(await left()));
      if (i === Math.floor(pts.length / 2)) {   // 중간에 경로에서 120m 벗어났다가 돌아오기
        // 동서남북 중 경로(구부러진 다른 부분 포함)에서 60m 넘게 떨어지는 방향을 고른다
        const off = await p.evaluate(([ll]) => { const r = state.routes[state.same ? 'jjuk' : state.focus], kx = 111320 * Math.cos(ll[1] * Math.PI / 180);
          for (const [dx, dy] of [[120, 0], [-120, 0], [0, 120], [0, -120], [200, 0], [-200, 0]]) { const q = [ll[0] + dx / kx, ll[1] + dy / 110540]; if (projectOnRoute(r, q).offset > 60) return q; } return null; }, [pts[i]]);
        if (!off) { checks.push(['이탈 시험 지점 없음(경로가 촘촘함)', true]); continue; }
        await c.setGeolocation({ longitude: off[0], latitude: off[1], accuracy: 8 }); await wait(800);
        checks.push(['이탈하면 다시 찾기 버튼', await p.evaluate(() => !document.getElementById('walk-reroute').hidden)]);
        await c.setGeolocation({ longitude: pts[i][0], latitude: pts[i][1], accuracy: 8 }); await wait(800);
        checks.push(['돌아오면 다시 찾기 버튼 사라짐', await p.evaluate(() => document.getElementById('walk-reroute').hidden)]);
      }
    }
    const nums = seen.filter(Number.isFinite), drops = nums.slice(1).filter((v, i) => v > nums[i] + 15).length;
    checks.push([`남은 거리가 줄어듦(${nums[0]}m → ${nums[nums.length - 1]}m, 거꾸로 늘어난 횟수 ${drops})`, nums.length > 3 && nums[nums.length - 1] < nums[0] && drops === 0]);
    // 도착: 끝점에서 위치를 두 번 더 보내 '도착 근처 2번 연속' 조건을 채운다
    for (let k = 0; k < 2; k++) { await c.setGeolocation({ longitude: pts[pts.length - 1][0] + k * 1e-6, latitude: pts[pts.length - 1][1], accuracy: 8 }); await wait(700); }
    checks.push(['도착 표시', /도착/.test(await p.evaluate(() => document.getElementById('walk-done').textContent))]);
    await p.screenshot({ path: path.join(out, t.id + '-arrive.png') });
    if (t.id === 'naksan') {   // 위치 갱신이 30초 넘게 없으면(지하·실내) 측정 중지 안내
      await wait(36000);
      checks.push(['30초 넘게 위치가 없으면 측정 중지 안내', /30초 넘게 갱신이 없어요/.test(await p.evaluate(() => document.getElementById('walk-location').textContent))]);
    }
    await p.click('#walk-done'); await p.waitForFunction(() => current === 'done', null, { timeout: 10000 });
    checks.push(['기록 카드는 실제 GPS 이동 구간', /GPS로 기록한 이동 구간/.test(await p.evaluate(() => document.getElementById('share-card').innerHTML))]);
    await p.screenshot({ path: path.join(out, t.id + '-done.png') });
    checks.push(['페이지 오류 없음', errs.length === 0]);
    report.push({ id: t.id, route: route.k, length_m: Math.round(route.length), steps: pts.length, checks: checks.map(([n, ok]) => ({ n, ok })), errors: errs });
    for (const [n, ok] of checks) console.log(t.id, ok ? 'PASS' : 'FAIL', n);
    await c.close();
  }
  fs.writeFileSync(path.join(out, 'walk-sim.json'), JSON.stringify(report, null, 1));
  await b.close();
  process.exitCode = report.some(r => r.checks.some(x => !x.ok)) ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
