// 실시간 보행 신호: 제공기관 응답 정규화 + 공유 캐시(Redis) + 외부 호출 제한. api/signal-live.js가 쓴다.
// 원칙: 시뮬레이션 금지(받은 상태만), 원천 시각(trsmUtcTime) 기준으로 오래된 정도를 판단, 오래되거나 모르면 색을 주지 않는다.
const LEG = { et: 'n', st: 'e', wt: 's', nt: 'w' };   // 2026-10-29 검증(보행·차량 동시 녹색 16/17, T자 교차로). 대각 코드는 미검증이라 쓰지 않는다
const STATE = { 'protected-Movement-Allowed': 'walk', 'stop-And-Remain': 'stop', 'permissive-Movement-Allowed': 'flash_unverified', dark: 'dark' };

// 원본 행 여러 개 → 가장 최근 원천 시각의 보행 신호만. 잔여 시간은 단위·기준 검증 전이라 원본 값만 보관하고 화면에는 쓰지 않는다.
function normalize(records, itstId) {
  const rows = (records || []).filter(r => String(r.itstId) === String(itstId) && Number.isFinite(Number(r.trsmUtcTime)));
  if (!rows.length) return null;
  const r = rows.reduce((a, b) => Number(b.trsmUtcTime) > Number(a.trsmUtcTime) ? b : a);
  const legs = {};
  for (const [code, leg] of Object.entries(LEG)) {
    const raw = r[code + 'PdsgStatNm'];
    legs[leg] = { state: raw == null || raw === '' ? 'unknown' : STATE[raw] || 'unknown', raw: raw ?? null, rem_raw: r[code + 'PdsgRmdrCs'] ?? null };
  }
  return { id: String(itstId), src_ts: Number(r.trsmUtcTime), legs };
}

// 원천 시각 기준 신선도. max_source_age_s가 정해지기 전(null)에는 'unmeasured'라서 색을 보여 주지 않는다.
function freshness(entry, now, maxAgeS) {
  if (!entry) return { status: 'unavailable', age_s: null };
  const age = (now - entry.src_ts) / 1000;
  if (maxAgeS == null) return { status: 'unmeasured', age_s: age };
  if (age < -5) return { status: 'clock_skew', age_s: age };
  return { status: age <= maxAgeS ? 'live' : 'stale', age_s: age };
}

// 더 최신 원천 시각일 때만 덮어쓴다(늦게 도착한 옛 응답이 최신 상태를 덮지 않게). Redis 쪽에서 원자적으로.
const PUT_IF_NEWER = `local cur = redis.call('GET', KEYS[1])
if cur then local t = cjson.decode(cur).src_ts if t and t >= tonumber(ARGV[2]) then return 0 end end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3]) return 1`;

function kstDay(now) { return new Date(now + 9 * 3600e3).toISOString().slice(0, 10); }

// 한 교차로를 '필요하면' 외부에서 새로 받는다. 제공기관의 호출 간격 제한(키당 300초, 2026-10-28 실측)은 교차로가 아니라 키 전체에 걸리므로
// lease도 키 하나에 하나(sig:lease:upstream)다. 여러 사용자·여러 교차로 요청이 겹쳐도 lease를 얻은 요청 하나만 부른다.
// 하루 예산(INCR)을 넘으면 부르지 않는다. 실패해도 예외를 밖으로 던지지 않고 이유만 돌려준다.
async function refresh(redis, fetchUpstream, id, cfg, now) {
  const leaseKey = 'sig:lease:upstream', budgetKey = 'sig:budget:' + kstDay(now);
  const got = await redis.set(leaseKey, String(now), { NX: true, PX: Math.round(cfg.min_upstream_interval_s * 1000) });
  if (!got) return 'leased';
  const used = await redis.incr(budgetKey);
  if (used === 1) await redis.expire(budgetKey, 2 * 86400);
  if (used > cfg.daily_upstream_budget) return 'budget_exceeded';
  let records;
  try { records = await fetchUpstream(id); } catch (e) { return e && e.code === 'RATE_LIMITED' ? 'rate_limited' : 'upstream_error'; }
  const entry = normalize(records, id);
  if (!entry) return 'no_data';
  entry.fetched_at = now;
  await redis.eval(PUT_IF_NEWER, { keys: ['sig:live:' + id], arguments: [JSON.stringify(entry), String(entry.src_ts), String(6 * 3600)] });
  return 'fetched';
}

module.exports = { LEG, STATE, normalize, freshness, refresh, kstDay, PUT_IF_NEWER };
