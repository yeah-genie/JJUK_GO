// 지도 설정: 네이버 지도 Client ID(ncpKeyId). 네이버 지도 키는 브라우저가 지도 스크립트를 부를 때 주소에 드러나는 '공개 키'이고,
// 네이버 클라우드 콘솔에 등록한 웹 서비스 URL(도메인)에서만 동작한다. 저장소에는 넣지 않고 Vercel 환경변수 NAVER_MAP_KEY_ID에 둔다.
module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  const id = process.env.NAVER_MAP_KEY_ID;
  res.end(JSON.stringify({ naver_key_id: id && /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : null }));
};
