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
  await redisChecks();
})().catch(e => { console.error(e); process.exitCode = 1; });

// REDIS_URL(Vercel Redis): 가짜 클라이언트로 연결 재사용·실패 처리를, 진짜 redis-server가 있으면 실제 저장까지 본다.
async function redisChecks() {
  delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
  process.env.REDIS_URL = 'redis://fake';
  let made = 0; const lists = {}, ttl = {};
  handler._setRedisFactory(() => { made++; const c = { isReady: false, on() {}, destroy() { c.isReady = false; },
    async connect() { c.isReady = true; },
    multi() { const ops = []; const m = { rPush(k, v) { ops.push(() => (lists[k] ||= []).push(v)); return m; }, expire(k, s) { ops.push(() => { ttl[k] = s; }); return m; }, async exec() { ops.forEach(f => f()); } }; return m; } }; return c; });
  for (let i = 0; i < 3; i++) assert.equal((await run('POST', { e: 'selected_route', trip: 'zz12', route: 'jjukgo', alternative_available: false })).body.stored, true);
  assert.equal(made, 1, '연결 하나를 재사용한다');
  const [key] = Object.keys(lists);
  assert.match(key, /^events:\d{4}-\d{2}-\d{2}$/); assert.equal(lists[key].length, 3); assert.equal(ttl[key], 90 * 86400);
  handler._setRedisFactory(() => ({ on() {}, destroy() {}, connect: () => Promise.reject(new Error('down')) }));
  const r = await run('POST', { e: 'walking_started', route: 'fast' });
  assert.equal(r.statusCode, 202); assert.equal(r.body.stored, false, 'Redis가 안 되면 stored:false, 응답은 정상');
  let real = null;
  try { require.resolve('redis'); real = require('node:child_process').spawnSync('redis-server', ['--version']).status === 0; } catch { real = false; }
  if (!real) { console.log('SKIP real redis: redis 패키지나 redis-server 없음'); return; }
  const { spawn } = require('node:child_process'), port = 6391;
  const srv = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  try {
    await new Promise(r => setTimeout(r, 400));
    process.env.REDIS_URL = 'redis://127.0.0.1:' + port;
    handler._setRedisFactory(url => require('redis').createClient({ url, socket: { connectTimeout: 3000, reconnectStrategy: false } }));
    for (const route of ['fast', 'jjukgo']) assert.equal((await run('POST', { e: 'walking_started', trip: 'real01', route })).body.stored, true);
    const c = require('redis').createClient({ url: process.env.REDIS_URL }); await c.connect();
    const keys = await c.keys('events:*'), rows = (await c.lRange(keys[0], 0, -1)).map(JSON.parse), t = await c.ttl(keys[0]);
    const clients = (await c.clientList()).length; await c.quit();
    assert.equal(keys.length, 1); assert.deepEqual(rows.map(x => x.route), ['fast', 'jjukgo']);
    assert(t > 90 * 86400 - 60 && t <= 90 * 86400, 'TTL 90일');
    assert.equal(clients, 2, '함수 쪽 연결은 하나(+확인용 연결 하나)');
    console.log('PASS real redis: events:YYYY-MM-DD RPUSH, 90-day TTL, one reused connection');
  } finally { srv.kill(); handler._setRedisFactory(url => require('redis').createClient({ url })); }
  process.exit(process.exitCode || 0);   // 열린 Redis 연결이 프로세스를 붙잡지 않게
}
