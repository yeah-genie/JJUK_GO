// 어떤 실시간 대중교통 키가 연결됐는지만 알려 준다(키 값·이름 일부도 내보내지 않는다).
const { subwayKey, busKey, send } = require('./_lib/transit');
module.exports = async function handler(req, res) {
  send(res, 200, { subway: !!subwayKey(), bus: !!busKey() });
};
