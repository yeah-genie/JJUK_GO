// 실시간 보행 신호 조회: GET /api/signal-live?ids=2217,1537 (최대 5곳, config/live_signals.json에서 검증된 곳만)
// - 브라우저 요청은 Redis 공유 캐시를 읽는다. 외부(T Data) 호출은 '필요할 때 한 번'만: 키 전체 lease + 하루 예산(api/_lib/live-signals.js).
// - 서버리스라 요청이 끝난 뒤 도는 타이머는 없다. 수집 주체 = 이 함수를 부르는 사용자 요청(보는 사람이 있을 때만).
// - 키(TDATA_LIVE_API_KEY)와 주소(TDATA_LIVE_URL)는 Vercel 환경변수에만 둔다. 응답·로그에 넣지 않는다.
// - 시험용 가짜 상태(SIGNAL_LIVE_MOCK=1)는 응답에 mock:true를 붙이고, 앱은 '시험 데이터'로 표시한다. production에서는 켜지 않는다.
const fs = require('node:fs'), path = require('node:path');
const L = require('./_lib/live-signals.js');
const CONFIG = path.join(__dirname, '..', 'config', 'live_signals.json');
let redisFactory = url => require('redis').createClient({ url, socket: { connectTimeout: 3000, reconnectStrategy: false } });
let redisPromise = null, fetchUpstream = defaultUpstream, readConfig = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

async function redisClient() {
  if (!process.env.REDIS_URL) return null;
  if (redisPromise) { const c = await redisPromise.catch(() => null); if (c && c.isReady) return c; redisPromise = null; }
  const c = redisFactory(process.env.REDIS_URL); c.on('error', () => {});
  redisPromise = c.connect().then(() => c); redisPromise.catch(() => { redisPromise = null; });
  return redisPromise;
}

async function defaultUpstream(id) {
  const base = process.env.TDATA_LIVE_URL, key = process.env.TDATA_LIVE_API_KEY;
  if (process.env.SIGNAL_LIVE_MOCK === '1') return mockRecords(id);
  if (!base || !key) { const e = new Error('not configured'); e.code = 'NOT_CONFIGURED'; throw e; }
  const url = new URL(base); url.search = new URLSearchParams({ apikey: key, apiKey: key, itstId: id, type: 'json', pageNo: '1', numOfRows: process.env.TDATA_LIVE_ROWS || '2200' }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const text = await r.text();
  if (r.status === 429 || /REPEAT_CALL/.test(text)) { const e = new Error('rate limited'); e.code = 'RATE_LIMITED'; throw e; }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const found = []; (function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if ('itstId' in x) found.push(x); else Object.values(x).forEach(walk); } })(JSON.parse(text));
  return found;
}
// 시험 전용: 받은 시각마다 상태를 돌리는 가짜 응답(실제 신호가 아님)
function mockRecords(id) {
  const t = Date.now(), ph = Math.floor(t / 20000) % 3;
  return [{ itstId: id, trsmUtcTime: t - 2000, etPdsgStatNm: ['protected-Movement-Allowed', 'permissive-Movement-Allowed', 'stop-And-Remain'][ph], stPdsgStatNm: 'stop-And-Remain', wtPdsgStatNm: null, ntPdsgStatNm: 'dark' }];
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=2, stale-while-revalidate=4');   // 같은 순간의 요청을 CDN에서 묶는다
  const now = Date.now(), cfg = readConfig(), mock = process.env.SIGNAL_LIVE_MOCK === '1';
  const verified = new Map(cfg.crosswalks.filter(c => c.verified).map(c => [String(c.id) + ':' + c.leg, c]));
  // 지도에 놓을 횡단보도 목록(검증된 것만). 시험 모드면 시험용 위치를 준다.
  if (req.query?.config) return res.end(JSON.stringify({ server_now: now, enabled: !!cfg.enabled || mock, mock, poll_hint_s: cfg.poll_hint_s,
    crosswalks: (mock ? cfg.mock_crosswalks || [] : cfg.crosswalks.filter(c => c.verified)).map(({ id, leg, ll, name }) => ({ id: String(id), leg, ll, name })) }));
  const ids = String(req.query?.ids || '').split(',').filter(x => /^\d{1,6}$/.test(x)).slice(0, 5);
  const base = { server_now: now, enabled: !!cfg.enabled, mock, poll_hint_s: cfg.poll_hint_s, max_source_age_s: cfg.max_source_age_s };
  if (!cfg.enabled && !mock) return res.end(JSON.stringify({ ...base, items: [], reason: 'not_enabled' }));
  let redis = null;
  try { redis = await redisClient(); } catch { redis = null; }
  if (!redis) return res.end(JSON.stringify({ ...base, items: ids.map(id => ({ id, status: 'unavailable', reason: 'cache_unavailable' })) }));
  const read = async id => { const v = await redis.get('sig:live:' + id); return v ? JSON.parse(v) : null; };
  let entries = await Promise.all(ids.map(read)), refreshed = null;
  // 가장 오래된(또는 없는) 교차로 하나만 새로 받아 본다(키당 호출 간격 제한 때문에 한 번에 하나)
  const order = ids.map((id, i) => [id, entries[i]?.src_ts ?? 0]).sort((a, b) => a[1] - b[1]);
  if (order.length && (cfg.max_source_age_s == null || (now - order[0][1]) / 1000 > cfg.max_source_age_s)) {
    refreshed = { id: order[0][0], result: await L.refresh(redis, fetchUpstream, order[0][0], cfg, now).catch(() => 'cache_error') };
    if (refreshed.result === 'fetched') entries = await Promise.all(ids.map(read));
  }
  const items = ids.map((id, i) => {
    const e = entries[i], f = L.freshness(e, now, mock ? 60 : cfg.max_source_age_s);
    const legs = {};
    for (const [leg, v] of Object.entries(e?.legs || {})) {
      const ok = mock || verified.has(id + ':' + leg);
      // 색을 줄 수 있는 경우: 검증된 횡단보도 + 신선함(live) + 상태가 walk/stop. 그 밖에는 이유와 함께 중립.
      legs[leg] = ok && f.status === 'live' && (v.state === 'walk' || v.state === 'stop') ? { state: v.state } : { state: 'neutral', reason: !ok ? 'direction_unverified' : f.status !== 'live' ? f.status : v.state };
    }
    return { id, status: e ? f.status : 'unavailable', src_ts: e?.src_ts ?? null, fetched_at: e?.fetched_at ?? null, age_s: f.age_s == null ? null : Math.round(f.age_s), legs };
  });
  res.end(JSON.stringify({ ...base, items, refreshed }));
};
module.exports._test = { setRedisFactory: f => { redisFactory = f; redisPromise = null; }, setUpstream: f => { fetchUpstream = f; }, setConfig: f => { readConfig = f; }, mockRecords };
