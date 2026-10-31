// Only the browser-public Maps identifier is exposed; never return a Client Secret.
module.exports = (_req, res) => {
  const value = (process.env.NAVER_MAP_CLIENT_ID || '').trim();
  const clientId = /^[A-Za-z0-9_-]{5,128}$/.test(value) ? value : '';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  res.end(JSON.stringify({naverClientId: clientId}));
};
