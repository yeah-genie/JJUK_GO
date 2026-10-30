// 실시간 보행 신호 구조 시험: node scripts/check_live.cjs
// 정규화·신선도는 항상, 공유 캐시(lease·예산·역순 방지)는 redis-server와 redis 패키지가 있을 때만(실제 Redis Lua로).
const assert = require('node:assert/strict');
const L = require('../api/_lib/live-signals.js');
const handler = require('../api/signal-live.js');
const call = async ids => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } }; await handler({ query: { ids } }, res); return res.body; };
(async () => {
  // 1) 정규화: 가장 최근 원천 시각 행, 검증된 4방위만, NULL은 unknown, 잔여 시간은 원본만 보관
  const now = Date.now();
  const rows = [{ itstId: '2217', trsmUtcTime: now - 5000, etPdsgStatNm: 'stop-And-Remain' },
    { itstId: '2217', trsmUtcTime: now - 1000, etPdsgStatNm: 'protected-Movement-Allowed', etPdsgRmdrCs: 123, stPdsgStatNm: null, nePdsgStatNm: 'stop-And-Remain', wtPdsgStatNm: 'permissive-Movement-Allowed' }];
  const e = L.normalize(rows, '2217');
  assert.equal(e.src_ts, now - 1000); assert.equal(e.legs.n.state, 'walk'); assert.equal(e.legs.e.state, 'unknown'); assert.equal(e.legs.s.state, 'flash_unverified');
  assert.equal(e.legs.n.rem_raw, 123); assert(!('ne' in e.legs) && Object.keys(e.legs).length === 4, '대각 코드는 쓰지 않는다');
  assert.equal(L.normalize([], '2217'), null);
  // 2) 신선도는 원천 시각 기준. 기준값이 측정 전(null)이면 색을 주지 않는다
  assert.equal(L.freshness(e, now, null).status, 'unmeasured');
  assert.equal(L.freshness(e, now, 30).status, 'live'); assert.equal(L.freshness({ src_ts: now - 120000 }, now, 30).status, 'stale');
  assert.equal(L.freshness(null, now, 30).status, 'unavailable');
  // 3) 꺼져 있으면(현재 기본값) 아무것도 보여 주지 않는다
  handler._test.setConfig(() => ({ enabled: false, crosswalks: [], max_source_age_s: null, min_upstream_interval_s: 305, daily_upstream_budget: 200, poll_hint_s: 15 }));
  assert.deepEqual((await call('2217')).items, []);
  console.log('PASS live signals: normalize latest row, verified legs only, freshness by source time, off by default');

  let ok = false; try { require.resolve('redis'); ok = require('node:child_process').spawnSync('redis-server', ['--version']).status === 0; } catch {}
  if (!ok) { console.log('SKIP live cache: redis 패키지나 redis-server 없음'); return; }
  const { spawn } = require('node:child_process'), port = 6392;
  const srv = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 400));
  process.env.REDIS_URL = 'redis://127.0.0.1:' + port;
  try {
    let cfg = { enabled: true, max_source_age_s: 30, min_upstream_interval_s: 0.3, daily_upstream_budget: 3, poll_hint_s: 15, crosswalks: [{ id: '2217', leg: 'n', verified: true }] };
    handler._test.setConfig(() => cfg);
    let calls = 0, srcAge = 1000;
    handler._test.setUpstream(async id => { calls++; await new Promise(r => setTimeout(r, 50)); return [{ itstId: id, trsmUtcTime: Date.now() - srcAge, etPdsgStatNm: 'protected-Movement-Allowed', stPdsgStatNm: 'stop-And-Remain' }]; });
    // 여러 사용자가 동시에 같은 교차로를 봐도 외부 호출은 한 번
    const many = await Promise.all(Array.from({ length: 6 }, () => call('2217')));
    assert.equal(calls, 1, '동시 요청 6개 → 외부 호출 1번');
    const last = await call('2217'), it = last.items[0];
    assert.equal(it.status, 'live'); assert.deepEqual(it.legs.n, { state: 'walk' });
    assert.deepEqual(it.legs.e, { state: 'neutral', reason: 'direction_unverified' }, '검증 안 된 방향은 색 없음');
    // 늦게 온 옛 응답은 최신을 덮지 않는다
    const c = require('redis').createClient({ url: process.env.REDIS_URL }); await c.connect();
    const before = JSON.parse(await c.get('sig:live:2217'));
    await new Promise(r => setTimeout(r, 350)); srcAge = 60000;
    await call('2217');
    assert.equal(JSON.parse(await c.get('sig:live:2217')).src_ts, before.src_ts, '역순 응답 무시');
    // 오래된 데이터는 이전 녹색을 계속 보여 주지 않는다
    cfg = { ...cfg, max_source_age_s: 0.001 };
    const stale = (await call('2217')).items[0];
    assert.equal(stale.status, 'stale'); assert.equal(stale.legs.n.state, 'neutral');
    // 하루 예산을 넘으면 더 부르지 않는다
    await new Promise(r => setTimeout(r, 350)); const r1 = (await call('2217')).refreshed;
    await new Promise(r => setTimeout(r, 350)); const r2 = (await call('2217')).refreshed;
    assert.equal(r2.result, 'budget_exceeded', JSON.stringify([r1, r2]));
    // 제공기관 호출 제한·오류여도 앱은 깨지지 않고 이유만
    await c.del('sig:budget:' + L.kstDay(Date.now())); await new Promise(r => setTimeout(r, 350));
    handler._test.setUpstream(async () => { const er = new Error('limit'); er.code = 'RATE_LIMITED'; throw er; });
    assert.equal((await call('2217')).refreshed.result, 'rate_limited');
    await c.quit();
    console.log('PASS live cache: one upstream call for concurrent viewers, out-of-order guard, stale→neutral, daily budget, rate limit');
  } finally { srv.kill(); }
  process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });
