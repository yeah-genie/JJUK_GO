// 신호 예측 재평가(공식 일별 기록 28일치 무렵, 2026-11-10~15 예정). 앱의 신뢰 조건(app.js TRUST·planConfidence)을 그대로 써서 잰다.
//   node scripts/signal_readiness.cjs [QA 결과 results.json]
// 1) 전체 기록 일수   2) 방향 매칭 성공률(QA 경로의 신호 횡단 중 건너는 다리 방향이 정해진 비율)
// 3) 시간대별 패턴 생성 가능 비율(앱 신호 교차로 중, 그 시간대에 신뢰 조건을 통과한 다리가 1개 이상인 비율, 평일·주말)
// 4) QA 경로에서 예상 신호 대기가 표시되는 비율(신호 횡단 중 패턴이 확인된 곳, 경로 단위로 1곳 이상 확인된 비율)
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const ROOT = path.join(__dirname, '..'), SEOUL = path.join(ROOT, 'docs/prototype/seoul');
const el = () => ({ textContent: '', addEventListener() {}, querySelector() { return null; }, classList: { toggle() {}, add() {}, remove() {} } });
const ctx = vm.createContext({ console, Date, Math, Number, Map, Set, Error, URL, URLSearchParams, performance, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: { baseURI: 'https://x/', getElementById: el, createElement: () => ({}), addEventListener() {} }, window: {}, navigator: {}, maplibregl: { addProtocol() {} },
  addEventListener() {}, clearInterval() {}, setTimeout() { return 0; }, cancelAnimationFrame() {} });
const src = f => fs.readFileSync(path.join(ROOT, 'docs/prototype/src', f), 'utf8');
vm.runInContext(src('app.js').replace('/*WALKING_PROFILE*/', src('walking-profile.js')).replace('/*ASPHALT_UI*/', src('screens.js')).replace(/boot\(\);\s*$/, ''), ctx);

const metas = fs.readdirSync(path.join(ROOT, 'official-history')).filter(f => /^\d{8}\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'official-history', f), 'utf8')));
const official = metas.filter(m => m.source_kind !== 'realtime').map(m => m.date).sort(), realtime = metas.filter(m => m.source_kind === 'realtime').map(m => m.date).sort();
const index = JSON.parse(fs.readFileSync(path.join(SEOUL, 'signal-plans.json'), 'utf8'));
const appSignals = JSON.parse(fs.readFileSync(path.join(SEOUL, 'signals.json'), 'utf8')).filter(s => s[4]).map(s => s[0]);
const out = { measured_at: new Date().toISOString(), days: { official: official.length, first: official[0], last: official[official.length - 1], realtime_filled: realtime.length, used_by_app: (index.source_dates || []).length }, hourly: {} };

for (const dayType of ['wd', 'we']) {
  vm.runInContext(`DAYTYPE_NOW=${JSON.stringify(dayType)}`, ctx);
  const rows = [];
  for (let h = 0; h < 24; h++) {
    const shardPath = path.join(SEOUL, 'signal-hours', String(h).padStart(2, '0') + '.json');
    const shard = fs.existsSync(shardPath) ? JSON.parse(fs.readFileSync(shardPath, 'utf8')) : {};
    ctx.__shard = shard;
    const r = vm.runInContext(`(() => { let any = 0, trusted = 0; for (const [id, bands] of Object.entries(__shard)) { let a = false, t = false;
      for (const b of bands) for (const p of Object.values((DAYTYPE_NOW === 'we' ? b.legsWe : b.legs) || {})) { a = true; if (planConfidence(p) > 0) t = true; }
      any += a; trusted += t; } return { any, trusted }; })()`, ctx);
    rows.push({ hour: h, with_pattern: r.any, trusted: r.trusted, trusted_ratio: +(r.trusted / appSignals.length).toFixed(3) });
  }
  out.hourly[dayType] = { app_signal_intersections: appSignals.length, rows,
    daytime_7_22_mean_ratio: +(rows.filter(r => r.hour >= 7 && r.hour <= 22).reduce((s, r) => s + r.trusted_ratio, 0) / 16).toFixed(3) };
}
const qaPath = process.argv[2];
if (qaPath && fs.existsSync(qaPath)) {
  const rows = JSON.parse(fs.readFileSync(qaPath, 'utf8')).filter(r => r.fast);
  const sum = (f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
  const x = sum(r => r.fast_x?.sig_x), dir = sum(r => r.fast_x?.sig_dir), total = sum(r => r.fast.wait_total), known = sum(r => r.fast.wait_known);
  out.qa = { routes: rows.length, signal_crossings: x, direction_matched: dir, direction_match_ratio: x ? +(dir / x).toFixed(3) : null,
    wait_known: known, wait_total: total, crossing_coverage: total ? +(known / total).toFixed(3) : null,
    routes_with_any_wait_shown: rows.filter(r => r.fast.wait_known > 0).length, routes_with_signals: rows.filter(r => r.fast.wait_total > 0).length,
    note: 'QA 결과를 만든 시각의 요일 종류·시간대 기준(빠른 길)' };
}
console.log(JSON.stringify(out, null, 1));
