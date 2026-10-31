// 대중교통 실시간 API 공통. 키는 Vercel 환경변수에만 있다(이름이 정해지지 않아 흔한 이름을 차례로 본다). 키는 응답·오류에 절대 넣지 않는다.
const SUBWAY_KEYS = ['SEOUL_OPENAPI_KEY', 'SEOUL_SUBWAY_API_KEY', 'SUBWAY_API_KEY', 'SEOUL_API_KEY', 'SEOUL_OPEN_API_KEY', 'SEOUL_DATA_KEY'];
const BUS_KEYS = ['DATA_GO_KR_KEY', 'DATA_GO_KR_SERVICE_KEY', 'DATA_GO_KR_API_KEY', 'SEOUL_BUS_API_KEY', 'BUS_API_KEY', 'PUBLIC_DATA_KEY', 'PUBLIC_DATA_API_KEY', 'SERVICE_KEY'];
const pick = names => { for (const n of names) { const v = (process.env[n] || '').trim(); if (v) return { name: n, value: v }; } return null; };
const subwayKey = () => pick(SUBWAY_KEYS);
const busKey = () => pick(BUS_KEYS);
// 공공데이터포털 키는 '인코딩 키'(%가 들어 있음)와 '디코딩 키' 두 가지다. 어느 쪽을 넣어도 한 번만 인코딩되게 한다.
const serviceKeyParam = v => (/%[0-9A-Fa-f]{2}/.test(v) ? v : encodeURIComponent(v));
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}
function send(res, status, body, maxAge = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', maxAge ? `public, s-maxage=${maxAge}, max-age=0` : 'no-store');
  res.end(JSON.stringify(body));
}
// 아주 단순한 XML 읽기(공공데이터포털 응답은 평평한 itemList 구조)
function xmlItems(xml, tag = 'itemList') {
  const out = [];
  for (const m of xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))) {
    const o = {};
    for (const f of m[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) o[f[1]] = f[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    out.push(o);
  }
  return out;
}
const xmlField = (xml, tag) => (xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1]?.trim() ?? null;
module.exports = { subwayKey, busKey, serviceKeyParam, cached, send, xmlItems, xmlField, SUBWAY_KEYS, BUS_KEYS };
