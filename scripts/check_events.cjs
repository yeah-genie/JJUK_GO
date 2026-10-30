// 익명 사용 기록: 정해진 이벤트·칸만 남고 좌표·장소 이름은 버려지는지. node scripts/check_events.cjs
const assert = require('node:assert/strict');
const handler = require('../api/event.js');
const run = async (method, body) => { const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } }; await handler({ method, body }, res); return res; };
(async () => {
  const saved = [], original = global.fetch;
  process.env.KV_REST_API_URL = 'https://kv.test'; process.env.KV_REST_API_TOKEN = 't';
  global.fetch = async (url, opt) => { saved.push(JSON.parse(JSON.parse(opt.body)[0][2])); return { ok: true }; };
  try {
    assert.equal((await run('GET')).statusCode, 405);
    assert.equal((await run('POST', { e: 'page_view' })).statusCode, 400, '모르는 이벤트는 버린다');
    let r = await run('POST', JSON.stringify({ e: 'route_search', trip: 'ab12cd34', outcome: 'ok', dist: '1-2km', alternative_available: true, time_delta: 35, improved_factors: ['stairs', 'x'],
      compute_ms: 900, from: [126.97, 37.56], to_name: '우리 집', ll: [1, 2] }));
    assert.equal(r.statusCode, 202); assert.equal(r.body.stored, true);
    const row = saved[0];
    assert.deepEqual(Object.keys(row).sort(), ['alternative_available', 'compute_ms', 'day', 'dist', 'e', 'hour', 'improved_factors', 'outcome', 'time_delta', 'trip']);
    assert.deepEqual(row.improved_factors, ['stairs']);
    assert(!JSON.stringify(saved).includes('126.97') && !JSON.stringify(saved).includes('우리 집'), '좌표·장소 이름은 저장하지 않는다');
    await run('POST', { e: 'selected_route', trip: 'ab12cd34', route: 'jjukgo', alternative_available: true });
    await run('POST', { e: 'walking_started', trip: 'ab12cd34', route: 'fast', accuracy: 5 });
    assert.deepEqual(saved.slice(1).map(x => [x.e, x.route]), [['selected_route', 'jjukgo'], ['walking_started', 'fast']]);
    assert.equal((await run('POST', { e: 'walking_started', route: 'bus' })).statusCode, 400);
    delete process.env.KV_REST_API_URL;
    assert.equal((await run('POST', { e: 'walking_started', route: 'fast' })).body.stored, false, '저장소가 없으면 받기만 한다');
    console.log('PASS usage events: whitelist, no coordinates or place names, optional storage');
  } finally { global.fetch = original; }
})().catch(e => { console.error(e); process.exitCode = 1; });
