// 익명 사용 기록 받기. 정해진 이벤트와 칸만 받고 나머지는 버린다(좌표·장소 이름·IP·기기 식별자를 저장하지 않는다).
// 저장: 날짜별 목록 events:YYYY-MM-DD 에 한 줄씩 쌓는다(90일 뒤 만료).
//   1) REDIS_URL(Vercel Redis 연결 시 생김)이 있으면 Node Redis 클라이언트로. 연결은 함수 인스턴스 안에서 재사용한다.
//   2) 없으면 REST(KV_REST_API_URL / KV_REST_API_TOKEN 또는 UPSTASH_REDIS_REST_URL / _TOKEN).
//   3) 둘 다 없거나 실패하면 받기만 하고 저장하지 않는다(응답 202, stored:false). 앱 기능에는 영향 없음.
const FACTORS = new Set(['sig', 'stairs', 'steep', 'gain', 'wait']);
const OUTCOMES = new Set(['ok', 'too_far', 'too_near', 'network', 'snap', 'no_route', 'outside', 'error']);
const DIST = new Set(['<0.5km', '0.5-1km', '1-2km', '2-5km', '5km+']);
const ROUTE = new Set(['fast', 'jjukgo']);
const trip = v => typeof v === 'string' && /^[a-z0-9]{4,12}$/.test(v) ? v : null;
const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null;

function clean(b) {
  if (!b || typeof b !== 'object') return null;
  const base = { e: b.e, trip: trip(b.trip) };
  if (b.e === 'route_search') {
    if (!OUTCOMES.has(b.outcome)) return null;
    return { ...base, outcome: b.outcome, dist: DIST.has(b.dist) ? b.dist : null, alternative_available: b.alternative_available === true,
      time_delta: num(b.time_delta, 0, 600), improved_factors: Array.isArray(b.improved_factors) ? b.improved_factors.filter(f => FACTORS.has(f)).slice(0, 5) : [],
      compute_ms: num(b.compute_ms, 0, 600000) };
  }
  if (b.e === 'selected_route' || b.e === 'walking_started') {
    if (!ROUTE.has(b.route)) return null;
    return { ...base, route: b.route, ...(b.e === 'selected_route' ? { alternative_available: b.alternative_available === true } : {}) };
  }
  return null;
}

const TTL_S = 90 * 86400, REDIS_TIMEOUT_MS = 3000;
let redisFactory = url => require('redis').createClient({ url, socket: { connectTimeout: REDIS_TIMEOUT_MS, reconnectStrategy: false } });
let redisPromise = null;   // 서버리스 인스턴스가 살아 있는 동안 연결 하나를 같이 쓴다

function withTimeout(promise) {
  let t; return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error('redis timeout')), REDIS_TIMEOUT_MS); })]).finally(() => clearTimeout(t));
}
async function redisClient(url) {
  if (redisPromise) {
    const c = await redisPromise.catch(() => null);
    if (c && c.isReady) return c;
    redisPromise = null;
    if (c) c.destroy?.();
  }
  const c = redisFactory(url);
  c.on('error', () => {});   // 끊김은 다음 요청에서 새로 연결한다(처리 안 된 오류로 함수가 죽지 않게)
  redisPromise = withTimeout(c.connect().then(() => c));
  redisPromise.catch(() => { redisPromise = null; c.destroy?.(); });
  return redisPromise;
}

async function store(row) {
  const key = 'events:' + row.day, line = JSON.stringify(row);
  if (process.env.REDIS_URL) {
    try {
      const c = await redisClient(process.env.REDIS_URL);
      await withTimeout(c.multi().rPush(key, line).expire(key, TTL_S).exec());
      return true;
    } catch {
      redisPromise = null;
      return false;
    }
  }
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  const r = await fetch(url.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify([['RPUSH', key, line], ['EXPIRE', key, String(TTL_S)]]), signal: AbortSignal.timeout(3000) });
  return r.ok;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'POST only' })); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (Buffer.isBuffer(body)) { try { body = JSON.parse(body.toString('utf8')); } catch { body = null; } }
  const row = clean(body);
  if (!row) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'unknown event' })); }
  // 시각은 시간 단위로만(분·초로 사람을 추적하지 않게)
  const now = new Date(Date.now() + 9 * 3600e3);
  row.day = now.toISOString().slice(0, 10); row.hour = now.getUTCHours();
  let stored = false;
  try { stored = await store(row); } catch { stored = false; }
  res.statusCode = 202; res.end(JSON.stringify({ ok: true, stored }));
};
module.exports.clean = clean;
module.exports._setRedisFactory = f => { redisFactory = f; redisPromise = null; };   // 시험용
