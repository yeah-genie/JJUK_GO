// 서울 버스: 주변 정류소(getStationByPos)와 정류소 도착정보(getStationByUid). 둘 다 공공데이터포털 '서울특별시_정류소정보조회' 활용신청이 필요하다.
// (신청한 '버스도착정보조회'는 노선을 알아야 하는 기능이라, 정류소별 전체 도착은 이 서비스로 받는다. 승인 전이면 그 사실을 알려 준다.)
const { busKey, serviceKeyParam, cached, send, xmlItems, xmlField } = require('./_lib/transit');
const BASE = 'http://ws.bus.go.kr/api/rest/stationinfo/';
async function call(op, params, key) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const r = await fetch(`${BASE}${op}?serviceKey=${serviceKeyParam(key.value)}&${qs}`, { signal: AbortSignal.timeout(8000) });
  const text = await r.text();
  if (!r.ok || /SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ACCESS DENIED|NO_OPENAPI_SERVICE/i.test(text)) throw Object.assign(new Error('auth'), { kind: 'auth' });
  if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/i.test(text)) throw Object.assign(new Error('limit'), { kind: 'limit' });
  const cd = xmlField(text, 'headerCd');
  if (cd && !['0', '4'].includes(cd)) throw Object.assign(new Error('header ' + cd), { kind: cd === '7' || cd === '1' ? 'auth' : 'upstream' });
  return text;
}
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
  const key = busKey();
  if (!key) return send(res, 200, { enabled: false });
  const q = req.query || {};
  try {
    if (q.ars) {
      const ars = String(q.ars).replace(/\D/g, '').slice(0, 5);
      if (ars.length !== 5) return send(res, 400, { error: '정류소 번호를 확인해 주세요.' });
      const body = await cached('ars:' + ars, 15000, async () => {
        const items = xmlItems(await call('getStationByUid', { arsId: ars }, key));
        return { enabled: true, ars, stop: items[0]?.stNm || null, arrivals: items.map(i => ({
          route: i.rtNm || i.busRouteAbrv || '', routeType: i.routeType || '', heading: (i.adirection || '').slice(0, 40),
          message1: i.arrmsg1 || '', message2: i.arrmsg2 || '', seconds1: Number(i.traTime1 ?? i.exps1) || null, seconds2: Number(i.traTime2 ?? i.exps2) || null,
          interval: Number(i.term) || null, last: i.isLast1 === '1' })).filter(a => a.route), source: '서울 버스정보시스템(공공데이터포털)' };
      });
      return send(res, 200, body, 10);
    }
    const lat = Number(q.lat), lon = Number(q.lon);
    if (!(lat > 37.39 && lat < 37.72 && lon > 126.68 && lon < 127.23)) return send(res, 400, { error: '서울 안 좌표가 필요해요.' });
    // 좌표는 정류소 찾기에만 쓰고 저장하지 않는다. 약 50m 격자로 묶어 캐시한다.
    const gl = (v => Math.round(v * 2000) / 2000), radius = Math.min(500, Math.max(100, Number(q.radius) || 300));
    const body = await cached(`pos:${gl(lat)},${gl(lon)},${radius}`, 3600000, async () => {
      const items = xmlItems(await call('getStationByPos', { tmX: gl(lon), tmY: gl(lat), radius }, key));
      return { enabled: true, stops: items.map(i => ({ name: i.stationNm || '', ars: i.arsId || '', ll: [Number(i.gpsX), Number(i.gpsY)], dist: Number(i.dist) || null }))
        .filter(s => s.name && /^\d{5}$/.test(s.ars) && s.ll.every(Number.isFinite)).slice(0, 12) };
    });
    return send(res, 200, body, 300);
  } catch (e) {
    const msg = e.kind === 'auth' ? "버스 정류소 정보는 공공데이터포털 '서울특별시_정류소정보조회' 활용 승인이 필요해요." : e.kind === 'limit' ? '버스 정보 조회 한도에 도달했어요.' : '버스 실시간 정보에 연결하지 못했어요.';
    return send(res, 503, { enabled: true, error: msg, needs: e.kind === 'auth' ? 'stationinfo' : undefined });
  }
};
