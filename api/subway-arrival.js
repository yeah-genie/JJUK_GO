// 서울 열린데이터광장 '실시간 지하철 도착정보'(realtimeStationArrival). 역 이름으로 조회한다.
const { subwayKey, cached, send } = require('./_lib/transit');
const LINES = { 1001: '1호선', 1002: '2호선', 1003: '3호선', 1004: '4호선', 1005: '5호선', 1006: '6호선', 1007: '7호선', 1008: '8호선', 1009: '9호선', 1061: '중앙선', 1063: '경의중앙선', 1065: '공항철도', 1067: '경춘선', 1075: '수인분당선', 1077: '신분당선', 1092: '우이신설선', 1093: '서해선', 1081: '경강선', 1032: 'GTX-A' };
const COLORS = { 1001: '#0052A4', 1002: '#00A84D', 1003: '#EF7C1C', 1004: '#00A5DE', 1005: '#996CAC', 1006: '#CD7C2F', 1007: '#747F00', 1008: '#E6186C', 1009: '#BDB092', 1063: '#77C4A3', 1065: '#0090D2', 1067: '#0C8E72', 1075: '#F5A200', 1077: '#D4003B', 1092: '#B0CE18', 1093: '#81A914', 1081: '#0054A6', 1032: '#9A6292' };
// 역 이름 정리: '서울숲역' → '서울숲', '서울역'은 그대로, 괄호 설명 제거
const cleanStation = s => { let n = String(s || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim(); if (n.length > 2 && n.endsWith('역')) n = n.slice(0, -1); return n; };
// '3분 20초 후 (성수)' / '[5]번째 전역 (왕십리)' / '전역 도착' 같은 문구에서 남은 초를 읽는다(못 읽으면 null)
function secondsFrom(r) {
  const b = Number(r.barvlDt);
  if (Number.isFinite(b) && b > 0) return b;
  const m = String(r.arvlMsg2 || '').match(/(?:(\d+)분)?\s*(?:(\d+)초)?\s*후/);
  if (m && (m[1] || m[2])) return (Number(m[1] || 0) * 60) + Number(m[2] || 0);
  if (/도착|진입/.test(r.arvlMsg2 || '') || ['0', '1'].includes(String(r.arvlCd))) return 0;
  return null;
}
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
  const key = subwayKey();
  if (!key) return send(res, 200, { enabled: false, arrivals: [] });
  const station = cleanStation(req.query?.station);
  if (!station || station.length > 20) return send(res, 400, { error: '역 이름을 확인해 주세요.' });
  try {
    const body = await cached('sub:' + station, 15000, async () => {
      const url = `http://swopenapi.seoul.go.kr/api/subway/${encodeURIComponent(key.value)}/json/realtimeStationArrival/0/30/${encodeURIComponent(station)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw Object.assign(new Error('upstream ' + r.status), { status: r.status });
      const j = await r.json();
      const status = j.errorMessage || j.RESULT || {};
      const code = String(status.code || status.CODE || '');
      if (code && code !== 'INFO-000') {
        if (code === 'INFO-200') return { enabled: true, station, arrivals: [], note: '이 역의 도착 정보가 없어요' };
        throw Object.assign(new Error(code), { code });
      }
      const rows = Array.isArray(j.realtimeArrivalList) ? j.realtimeArrivalList : [];
      const arrivals = rows.map(r => ({
        line: LINES[r.subwayId] || r.subwayId || '', color: COLORS[r.subwayId] || '#6B7480', updown: r.updnLine || '',
        heading: String(r.trainLineNm || '').slice(0, 60), message: String(r.arvlMsg2 || '').slice(0, 60), position: String(r.arvlMsg3 || '').slice(0, 30),
        seconds: secondsFrom(r), received: r.recptnDt || null, last: r.lstcarAt === '1', express: /급행/.test(r.btrainSttus || '')
      })).filter(a => a.line);
      return { enabled: true, station, arrivals, source: '서울 열린데이터광장 실시간 지하철 도착정보' };
    });
    return send(res, 200, body, 10);
  } catch (e) {
    const msg = /INFO-100|ERROR-3|401|403/.test(String(e.code || e.status || e.message)) ? '지하철 실시간 키를 확인해야 해요.' : /ERROR-337|429/.test(String(e.code || e.status)) ? '지하철 실시간 조회 한도에 도달했어요.' : '지하철 실시간 정보에 연결하지 못했어요.';
    return send(res, 503, { enabled: true, error: msg, arrivals: [] });
  }
};
module.exports.cleanStation = cleanStation; module.exports.secondsFrom = secondsFrom;
