// 쭉고 프로토타입. 지도·보행 그래프·검색 데이터는 서울 OpenStreetMap 추출본(© OpenStreetMap contributors, ODbL)에서
// scripts/build_seoul_map.py가 만들어 seoul/ 아래에 둔다. 신호 위치는 서울 C-ITS 교차로 + OSM 신호 표시.
const $ = id => document.getElementById(id);
const DATA = new URL("seoul/", document.baseURI).href;
let SPEED = 1.2;                    // 걷는 속도 m/s. 내 걸음 설정(applyPace)으로 바뀐다
let BASE = 8 * 3600 + 40 * 60;      // 기준 출발 08:40
const UNKNOWN_SIG_COST = 45;                        // 패턴을 모르는 신호를 지날 때 쭉고가 치는 비용(초): 평균 대기 근사
const STOP_COST = 15;                               // 멈춤 한 번에 더하는 비용(초): 같은 대기라도 덜 멈추는 길을 고른다
// 지도 초기 중심·검색 정렬 기준이다. 사용자 GPS 위치로 표시하지 않는다.
const ME = { name: "서울광장", sub: "지도 기준점", ll: [126.97799, 37.56562] };
const DEMO_FROM = { name: "서대문역", sub: "", ll: [126.96664, 37.5658] };
const DEMO_TO = { name: "청계광장", sub: "명소", ll: [126.9776, 37.56922] };
// 예시 길. 앞의 둘은 패턴을 아는 신호를 지나는 길(광화문 일대), 뒤는 서울 다른 동네(신호 개수만 비교)
const EXAMPLES = [{ from: "서대문역", to: "청계광장" }, { from: "독립문역", to: "서울광장" }, { from: "시청역", to: "경복궁" }, { from: "홍대입구역", to: "연남동" }, { from: "잠실역", to: "석촌호수" }];
const DEADLINE_KEY = "deadline";
let IDX = null, SIGS = null, GMETA = null, SEARCH = null, TERRAIN = null;
const SIGMETA = new Map();

async function getJSON(p) { const r = await fetch(DATA + p); if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }
const store = {
  get(k, d) { try { const v = localStorage.getItem("jjukgo:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("jjukgo:" + k, JSON.stringify(v)); return true; } catch { return false; } },
};

/*WALKING_PROFILE*/
// ---------- 익명 사용 기록 ----------
// 제품 검증에 필요한 것만 보낸다: 대안 유무, 추가 시간, 줄어든 요소, 고른 길(빠른 길/쭉고 길), 걷기 시작.
// 좌표·장소 이름·이동 궤적·기기 식별자는 보내지 않는다. trip은 길 찾기 1번마다 새로 만드는 임의 값(저장하지 않음)이라
// 같은 검색 안의 기록끼리만 이어진다. 설정에서 끌 수 있고, 브라우저의 추적 거부(GPC/DNT)도 따른다.
const LOG_EVENTS = ["route_search", "selected_route", "walking_started"];
const logOff = () => !!(window.JJUKGO_NO_LOG || store.get("nolog", false) || navigator.globalPrivacyControl || navigator.doNotTrack === "1");
const newTripId = () => Math.random().toString(36).slice(2, 10);
const distBand = m => m < 500 ? "<0.5km" : m < 1000 ? "0.5-1km" : m < 2000 ? "1-2km" : m < 5000 ? "2-5km" : "5km+";
function logEvent(name, props = {}) {
  if (!LOG_EVENTS.includes(name) || logOff()) return false;
  const body = JSON.stringify({ e: name, v: 1, ...props });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon("/api/event", new Blob([body], { type: "application/json" }))) return true;
    fetch("/api/event", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
    return true;
  } catch { return false; }
}
// 길 찾기 결과 1번에 기록 1번(같은 결과를 다시 그릴 때는 보내지 않는다)
function logRouteSearch() {
  if (state.loggedTrip === state.tripKey) return;
  state.loggedTrip = state.tripKey; state.tripId = newTripId();
  const d = state.from && state.to ? distBand(distLL(state.from.ll, state.to.ll)) : null;
  if (state.error) return logEvent("route_search", { trip: state.tripId, outcome: state.error.kind || "error", dist: d });
  const R = state.routes, alt = !!R.alt;
  logEvent("route_search", { trip: state.tripId, outcome: "ok", dist: d, alternative_available: alt,
    time_delta: alt ? Math.round((R.jjuk.m.walk - R.short.m.walk) / 5) * 5 : 0,
    improved_factors: alt ? altGains(R.jjuk, R.short) : [], compute_ms: Math.round((state.lastRouteMs || 0) / 50) * 50 });
}
const DEMO_MODE = false; // 공개 UI에서는 가짜 이동을 재생하지 않는다.

// ---------- 좌표 ----------
const Q = 1e5, LON0 = 126.58, LAT0 = 37.35;
const fromQ = (x, y) => [LON0 + x / Q, LAT0 + y / Q];
const toQ = ([lon, lat]) => [(lon - LON0) * Q, (lat - LAT0) * Q];
const KXQ = 111320 * Math.cos(37.55 * Math.PI / 180) / Q, KYQ = 110540 / Q;
function distLL(a, b) { const kx = 111320 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180); return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110540); }
const km = m => m < 1000 ? Math.round(m / 10) * 10 + "m" : (m / 1000).toFixed(1) + "km";

function terrainHeight(lon, lat) {
  if (!TERRAIN) return null;
  const n = 2 ** TERRAIN.zoom, size = TERRAIN.size;
  const px = (lon + 180) / 360 * n * size;
  const py = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n * size;
  const x = Math.floor(px), y = Math.floor(py), fx = px - x, fy = py - y;
  const sample = (a, b) => TERRAIN.tiles[Math.floor(a / size) + "_" + Math.floor(b / size)]?.[(b % size) * size + a % size];
  const a = sample(x, y), b = sample(x + 1, y), c = sample(x, y + 1), d = sample(x + 1, y + 1);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}
function edgeRise(e, u, v) {
  if (e.cls === 4) return null; // 지형 높이로 육교·지하도 높이를 대신하지 않는다.
  const a = G.node.get(u), b = G.node.get(v);
  if (!Number.isFinite(a.h) || !Number.isFinite(b.h)) return null;
  return Math.max(0, b.h - a.h);
}

// ---------- 신호 ----------
// 수집 데이터로 찾은 실제 신호 패턴(scripts/export_signal_plans.py가 확신 기준을 넘은 곳만 채운다). 여기 없는 신호는 '모름'이다(예시 값을 쓰지 않는다).
let REAL = /*REAL_SIGNALS*/{"signals":{},"date":null,"source_dates":[]}/*END_REAL*/;
function signalPlan(id, t = BASE, dir) {
  const bands = REAL.signals[id]?.bands || [];
  const local = ((t % 86400) + 86400) % 86400;
  const band = bands.find(b => local >= b.start && local < b.end);
  if (!band || dir === null) return null;
  // 평일 패턴(legs)과 주말 패턴(legsWe)을 따로 둔다. 오늘의 요일 종류에 맞는 쪽을 쓴다.
  const legs = dayTypeNow() === "we" ? (band.legsWe || {}) : (band.legs || {});
  return dir ? legs[dir] || null : Object.values(legs)[0] || null;
}
async function loadSignalPlans(hours = [8, 9, 10]) {
  const index = await getJSON("signal-plans.json");
  hours = [...new Set(hours.map(h => (h + 24) % 24))];
  const shards = await Promise.all(hours.map(h => getJSON(`signal-hours/${String(h).padStart(2, "0")}.json`).catch(() => ({}))));
  index.signals = {};
  for (const shard of shards) for (const [id, bands] of Object.entries(shard)) {
    (index.signals[id] ??= {bands:[]}).bands.push(...bands);
  }
  return index;
}
const known = (id, t = BASE, dir) => !!signalPlan(id, t, dir);
// ---------- 예상 신호 대기(경로 비교용) ----------
// 건널 수 있는지는 판단하지 않는다. '고정 초록(건너기 시작 가능) 시작까지 얼마나 기다리나'만 과거 신호 기록으로 추정한다.
// 아래 조건을 모두 만족하는 신호 패턴만 숫자에 쓴다(하나라도 아니면 '신호 시간 정보 없음'):
//  1) 방향 매칭 확인: 패턴이 어느 다리를 건너는지 검증된 4방위 코드로 붙어 있음(대각 코드·모르는 코드는 패턴에서 빠져 있음)
//  2) 해당 시간대 기록이 충분: 관측 900초 이상, 별도 검증 표본 300개 이상
//  3) 날짜별 변동이 크지 않음: 같은 요일 종류(평일/주말)의 다른 날 1일 이상에 대본 일치율이 모두 0.9 이상(중앙값 0.95 이상). 기록이 쌓이면 날짜 수를 올린다
//  4) 패턴이 안정적으로 반복: 검증 일치율 0.95 이상, 불순도 0.02 이하(내보내기에서 이미 통과), 주기가 정수에 가까움
//  5) 지금 요일 종류(평일/주말)가 패턴이 만들어진 날과 같음
const TRUST = { minObs: 900, minTest: 300, xdPairs: 1, xdMedian: .95, xdMin: .9, holdout: .95, impurity: .02, cycleFrac: .06 };
const dayTypeOf = d => { const w = new Date(d + "T12:00:00+09:00").getDay(); return w === 0 || w === 6 ? "we" : "wd"; };
let DAYTYPE_NOW = null;                                             // 시험용으로 덮어쓸 수 있음
const dayTypeNow = () => DAYTYPE_NOW || (() => { const w = new Date(Date.now() + 9 * 3600e3).getUTCDay(); return w === 0 || w === 6 ? "we" : "wd"; })();
function planConfidence(r) {
  if (!r || !r.win || !r.win.length || !r.c) return 0;
  if ((r.observed_samples || 0) < TRUST.minObs || (r.test_samples || 0) < TRUST.minTest) return 0;
  if ((r.holdout_accuracy || 0) < TRUST.holdout || (r.impurity ?? 1) > TRUST.impurity) return 0;
  if (Math.abs(r.c - Math.round(r.c)) > TRUST.cycleFrac) return 0;
  const xd = r.xd;
  if (!xd || xd[0] < TRUST.xdPairs || xd[1] == null || xd[1] < TRUST.xdMedian || xd[2] < TRUST.xdMin) return 0;
  if (r.date && dayTypeOf(r.date) !== dayTypeNow()) return 0;
  return Math.min(r.holdout_accuracy, 1 - r.impurity, xd[1]);       // 내부 신뢰도(화면에는 숫자로 보이지 않는다)
}
function trustedPlan(id, t, dir) { const r = signalPlan(id, t, dir); return planConfidence(r) > 0 ? r : null; }
// 도착 시각 t에 이 신호가 고정 초록이 아니면 다음 고정 초록 시작까지의 초. 신뢰 조건을 못 채우면 null.
// need: 이 횡단보도를 건너는 데 필요한 초(길이 ÷ 걷는 속도 + 여유). 도착 때 초록이어도 남은 초록이 need보다 짧으면
// 이번 초록은 보내고 다음 초록 시작까지 기다리는 것으로 센다(2026-10-31: '초록이 짧아요'인데 대기 0초로 세던 문제).
function expectedWait(id, t, dir, need = 0) {
  const r = trustedPlan(id, t, dir);
  if (!r) return null;
  const ph = (((r.day0 + ((t % 86400) + 86400) % 86400 - r.ref) % r.c) + r.c) % r.c;
  let wait = Infinity;
  for (const [a, b] of r.win) {
    for (const shift of [0, r.c]) if (ph + shift >= a && ph + shift < b) {
      const rem = b - ph - shift;
      if (rem >= need) return 0;
      const next = expectedWait(id, t + rem + 0.01, dir, 0);   // 이번 초록이 끝난 직후부터 다음 초록 시작까지
      return next == null ? null : rem + 0.01 + next;
    }
    wait = Math.min(wait, ((a - ph) % r.c + r.c) % r.c);
  }
  return wait === Infinity ? null : wait;
}
// 한국 시각 기준 하루 중 초(지도 신호 아이콘의 '지금'). 기기 시간대가 달라도 서울 시각으로 계산한다.
const kstSec = (ms = Date.now()) => ((ms / 1000 + 9 * 3600) % 86400 + 86400) % 86400;
const planPeriodText = () => { const d = REAL.source_dates || []; if (!d.length) return "과거 신호 기록 기준 추정"; const f = s => `${+s.slice(4, 6)}/${+s.slice(6, 8)}`; return `${f(d[0])}~${f(d[d.length - 1])} 신호 기록 기준 추정`; };
const planNoteText = () => planPeriodText() + " · 패턴이 확인된 신호만 더했어요";
const MIN_GREEN = 8;
function sigState(id, t, dir) {
  const r = signalPlan(id, t, dir);
  if (!r) return { g: false, wait: UNKNOWN_SIG_COST, unknown: true };
  const ph = (((r.day0 + ((t % 86400) + 86400) % 86400 - r.ref) % r.c) + r.c) % r.c;
  let wait = Infinity;
  for (const [a, b] of r.win) {
    for (const shift of [0, r.c]) if (ph + shift >= a && ph + shift < b) return { g: true, rem: b - ph - shift };
    wait = Math.min(wait, ((a - ph) % r.c + r.c) % r.c);
  }
  return { g: false, wait: wait === Infinity ? UNKNOWN_SIG_COST : wait };
}
function sigWait(id, t, dir) {
  const s = sigState(id, t, dir);
  if (s.unknown) return null;
  if (!s.g) return s.wait;
  if (s.rem >= MIN_GREEN) return 0;
  const next = sigState(id, t + s.rem + .5, dir);
  return next.unknown ? null : s.rem + next.wait;
}
const DIR_KO = { n: "북쪽", e: "동쪽", s: "남쪽", w: "서쪽" };
const sigName = (id, dir) => { const m = SIGMETA.get(id); return (m && m.name ? m.name + " " : "") + (dir ? DIR_KO[dir] + " " : "") + "횡단보도"; };
const realCount = () => Object.keys(REAL.signals).length;

// ---------- 보행 그래프 (필요한 칸만 받는다) ----------
const G = { cells: new Map(), node: new Map(), adj: new Map(), seen: new Set() };
function cellsFor(a, b, margin = 700) {
  const mx = margin / 111320 / Math.cos(37.55 * Math.PI / 180), my = margin / 110540;
  const lo0 = Math.min(a[0], b[0]) - mx, lo1 = Math.max(a[0], b[0]) + mx, la0 = Math.min(a[1], b[1]) - my, la1 = Math.max(a[1], b[1]) + my;
  const out = [];
  for (let cx = Math.floor((lo0 - GMETA.lon0) / GMETA.cell_lon); cx <= Math.floor((lo1 - GMETA.lon0) / GMETA.cell_lon); cx++)
    for (let cy = Math.floor((la0 - GMETA.lat0) / GMETA.cell_lat); cy <= Math.floor((la1 - GMETA.lat0) / GMETA.cell_lat); cy++)
      if (GMETA.cells[cx + "_" + cy] !== undefined) out.push(cx + "_" + cy);
  return out;
}
function loadCell(k) {
  if (!G.cells.has(k)) G.cells.set(k, getJSON(`graph/c${k}.json`).then(c => {
    for (const [id, x, y, s] of c.n) G.node.set(id, { x, y, s: s ?? null, h: terrainHeight(...fromQ(x, y)) });
    const F = c.f || {};
    for (let i = 0; i < c.e.length; i++) {
      const [a, b, len, cls, geom, sig, dir, half] = c.e[i];
      const key = a + ":" + b + ":" + len;
      if (G.seen.has(key)) continue;
      G.seen.add(key);
      // sig: 이 횡단보도의 신호(큰길을 건널 때만), dir: 건너는 다리 방향, half: 일방통행 차로 하나만 건넘
      // f: 이동 마찰 원시값 [a→b 상승(0.1m), b→a 상승(0.1m), 8% 이상 경사 거리(m), 근처 횡단보도 수, 그중 보행등 있음] (scripts/build_friction_layer.py)
      const e = { a, b, len, cls, geom: geom || null, sig: sig || null, dir: dir || null, half: !!half, f: F[i] || null };
      if (!G.adj.has(a)) G.adj.set(a, []);
      if (!G.adj.has(b)) G.adj.set(b, []);
      G.adj.get(a).push(e); G.adj.get(b).push(e);
    }
  }).catch(err => { G.cells.delete(k); throw err; }));
  return G.cells.get(k);
}
let snapNodeId = -1;
// 검색·지도에서 고른 장소는 점이 건물·시장·캠퍼스 한가운데일 수 있어 가장 가까운 보행로까지 150m 안에서 잇는다(화면에 거리를 알린다).
// 내 위치(GPS)는 35m까지만.
const SNAP_GPS_M = 35, SNAP_PLACE_M = 150;
function snap(ll, maxD = SNAP_GPS_M, ok = null) {
  let nearest = null, best = Infinity;
  const seen = new Set();
  for (const edges of G.adj.values()) for (const edge of edges) {
    if (seen.has(edge) || edge.cls > 2 || edge.sig || !G.node.has(edge.a) || !G.node.has(edge.b) || (ok && !ok(edge))) continue;
    seen.add(edge);
    const pts = edgePts(edge, edge.a).map(p => fromQ(...p));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distLL(pts[i - 1], pts[i]));
    const projection = projectOnRoute({coords:pts,cum}, ll);
    if (projection.offset < best) { best = projection.offset; nearest = {edge,pts,cum,projection}; }
  }
  if (!nearest || best > maxD) return {id:null,d:best};
  const {edge,pts,cum,projection} = nearest;
  const at = projection.distance, length = cum[cum.length - 1];
  if (at < 1) return {id:edge.a,d:distLL(ll,pts[0])};
  if (length - at < 1) return {id:edge.b,d:distLL(ll,pts[pts.length - 1])};
  const point = pointAt({coords:pts,cum}, at), q = toQ(point);
  const id = snapNodeId--;
  G.node.set(id,{x:q[0],y:q[1],s:null,h:terrainHeight(...point)});
  const split = cum.findIndex(d => d >= at), qs = pts.map(toQ);
  const encode = points => points.slice(1,-1).flatMap((p,i)=>[p[0]-points[i][0],p[1]-points[i][1]]);
  const part = r => edge.f ? edge.f.map((v, i) => i < 3 ? v * r : v) : null;
  const parts = [{...edge,b:id,len:edge.len*at/length,geom:encode([...qs.slice(0,split),q]),f:part(at/length)}, {...edge,a:id,len:edge.len*(length-at)/length,geom:encode([q,...qs.slice(split)]),f:part((length-at)/length)}];
  G.adj.set(edge.a,G.adj.get(edge.a).filter(e=>e!==edge));
  G.adj.set(edge.b,G.adj.get(edge.b).filter(e=>e!==edge));
  G.adj.set(id,[]);
  for (const e of parts) { G.adj.get(e.a).push(e); G.adj.get(e.b).push(e); }
  return {id,d:distLL(ll,point)};
}
class Heap {
  constructor() { this.a = []; }
  push(c, v) { const a = this.a; a.push([c, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}
// 둘 다 "걷는 시간 + 신호 기다림"을 따진다(패턴 있는 신호는 도착 시각의 예상 대기, 모르는 신호는 평균 대기 45초).
// mode "short"(최단 시간): 그 합이 가장 작은 길. mode "jjuk"(쭉고): 거기에 멈출 때마다 비용을 더해 덜 멈추는 길.
function search(src, dst, mode, dep) {
  // 출발점이 신호 교차로 안이면 그 신호는 세지 않는다(어느 쪽으로 건널지 아직 정하지 않은 자리라서). buildRoute도 같다
  const D = G.node.get(dst), unit = 1 / SPEED;
  const hEst = n => Math.hypot((n.x - D.x) * KXQ, (n.y - D.y) * KYQ) * unit * 0.999;
  const entry = distLL(state.from.ll, fromQ(G.node.get(src).x, G.node.get(src).y)) / SPEED;
  const cost = new Map([[src, entry]]), time = new Map([[src, entry]]), prev = new Map(), done = new Set(), h = new Heap();
  h.push(entry + hEst(G.node.get(src)), src);
  while (h.size) {
    const u = h.pop()[1], c = cost.get(u);
    if (done.has(u)) continue;
    done.add(u);
    if (u === dst) break;
    const nu = G.node.get(u), tu = time.get(u);
    for (const e of G.adj.get(u) || []) {
      if (e.cls === 3 && readProfile().avoidSteps) continue;
      const v = e.a === u ? e.b : e.a, nv = G.node.get(v);
      if (!nv || done.has(v)) continue;
      let tv = tu + e.len / SPEED, cv = c + e.len / SPEED;
      if (mode !== "short") {
        const weight = mode === "gentle" ? 3 : 1;
        cv += weight * ((e.cls === 3 ? e.len * 2 : 0) + (edgeRise(e, u, v) ?? 0) * 8);
      }
      {
        // 횡단보도 신호는 건너기 전에 기다린다. 골목 교차로 신호(노드)는 들어설 때 센다
        const s = e.sig || (nv.s && nv.s !== nu.s ? nv.s : null), share = e.sig && e.half ? 0.5 : 1;
        const stop = mode !== "short" ? STOP_COST * share : 0;
        if (s) {
          const arrival = BASE + dep + (e.sig ? tu : tv), direction = e.sig ? e.dir : null;
          const w = sigWait(s, arrival, direction);
          if (w !== null) { tv += w; cv += w + (w > 2 ? stop : 0); }
          else { tv += UNKNOWN_SIG_COST * share; cv += UNKNOWN_SIG_COST * share + stop * 0.8; }
        }
      }
      if (cv < (cost.get(v) ?? Infinity)) { cost.set(v, cv); time.set(v, tv); prev.set(v, [u, e]); h.push(cv + hEst(nv), v); }
    }
  }
  if (!done.has(dst)) return null;
  const steps = []; let v = dst;
  while (v !== src) { const [u, e] = prev.get(v); steps.push([u, v, e]); v = u; }
  return steps.reverse();
}
function edgePts(e, from) {
  const A = G.node.get(e.a), B = G.node.get(e.b), pts = [[A.x, A.y]];
  let x = A.x, y = A.y; const g = e.geom || [];
  for (let i = 0; i < g.length; i += 2) { x += g[i]; y += g[i + 1]; pts.push([x, y]); }
  pts.push([B.x, B.y]);
  return from === e.a ? pts : pts.reverse();
}
// 경로 = 좌표, 누적 거리, 지나는 신호(처음 들어선 지점), 입체 보행(지하도·육교) 구간
function buildRoute(steps, src, fromLL, toLL) {
  const coords = [fromLL], cum = [0], x = [], under = [];
  const guides = [];
  let stairs = 0, stairMeters = 0, rise = 0, terrainMeters = 0, lastStairs = false;
  const add = (ll, u) => { const d = cum[cum.length - 1] + distLL(coords[coords.length - 1], ll); coords.push(ll); cum.push(d); if (u) under.push(coords.length - 1); };
  const s0 = G.node.get(src);
  add(fromQ(s0.x, s0.y));
  // 같은 신호를 60m 안에서 또 건너면(왕복 도로를 두 번에 나눠 건너기) 한 번으로 센다
  // len: 횡단보도 길이(그래프의 신호 횡단 간선 길이, '건널 수 있어요' 판단에 씀), mid: 지도 아이콘 위치(횡단보도 가운데)
  const push = (s, dir, d, at, len = null, mid = at, dirs = null) => { if (!x.some(z => z.s === s && d - z.d < 60)) x.push({ s, dir, d, at, len, mid, dirs }); };
  for (let si = 0; si < steps.length; si++) {
    const [u, v, e] = steps[si];
    if (e.cls === 3) { if (!lastStairs) { stairs++; guides.push({d:cum[cum.length-1],label:"계단 구간 · 발밑을 확인하세요"}); } stairMeters += e.len; }
    lastStairs = e.cls === 3;
    const up = edgeRise(e, u, v);
    if (up != null) { rise += up; terrainMeters += e.len; }
    const start = cum[cum.length - 1], startAt = coords[coords.length - 1];
    const pts = edgePts(e, u);
    for (let i = 1; i < pts.length; i++) add(fromQ(...pts[i]), e.cls === 4);
    const nu = G.node.get(u), nv = G.node.get(v);
    if (e.sig) push(e.sig, e.dir, start, startAt, e.len, fromQ(...pts[pts.length >> 1]));
    // 교차로 점에서 건너면 어느 쪽 횡단보도인지 비어 있었다(2026-10-30 발견). 건너는 도로의 양쪽 다리를 후보(dirs)로 둔다.
    else if (nv.s && nv.s !== nu.s) push(nv.s, null, cum[cum.length - 1], coords[coords.length - 1], null, coords[coords.length - 1], nodeCrossLegs(v, e, steps[si + 1]?.[2]));
  }
  add(toLL);
  return { coords, cum, length: cum[cum.length - 1], x, under, guides, stairs, stairMeters, rise, terrainMeters, key: steps.map(s => s[2].a + "-" + s[2].b).join(",") };
}
function routeFor(mode, dep) {
  const steps = search(state.src, state.dst, mode, dep);
  if (!steps) return null;
  const route = buildRoute(steps, state.src, state.from.ll, state.to.ll);
  return Number.isFinite(route.length) && route.coords.every(p => p.every(Number.isFinite)) ? route : null;
}

// 경로를 따라 걸으며 신호마다 도착 시각의 신호 위상으로 대기를 계산한다. 패턴 없는 신호는 대기를 모른다(null).
function simulate(route, dep) {
  let t = BASE + dep, prev = 0;
  const segs = [], xings = [];
  for (const x of route.x) {
    const walk = (x.d - prev) / SPEED;
    segs.push({ type: "walk", s: walk }); t += walk; prev = x.d;
    if (known(x.s, t, x.dir ?? null) && sigWait(x.s, t, x.dir ?? null) !== null) {
      const w = Math.round(sigWait(x.s, t, x.dir)), st = sigState(x.s, t, x.dir);
      // 놓치면: 초록일 때 이번 초록을 보내고 다음 초록까지 기다리는 시간
      const miss = st.g ? Math.round(st.rem + sigState(x.s, t + st.rem + 0.5, x.dir).wait) : 0;
      xings.push({ id: x.s, dir: x.dir, name: sigName(x.s, x.dir), known: true, arrive: t, wait: w, green: st.g, rem: st.g ? Math.round(st.rem) : 0, miss, d: x.d, at: x.at });
      if (w > 0) segs.push({ type: "wait", s: w });
      t += w;
    } else {
      xings.push({ id: x.s, name: sigName(x.s, x.dir), known: false, arrive: t, wait: null, d: x.d, at: x.at });
      segs.push({ type: "unk", s: UNKNOWN_SIG_COST });
      t += UNKNOWN_SIG_COST;
    }
  }
  const tail = (route.length - prev) / SPEED;
  segs.push({ type: "walk", s: tail }); t += tail;
  const kn = xings.filter(x => x.known), wait = kn.reduce((a, x) => a + x.wait, 0);
  return { segs, xings, wait, stops: kn.filter(x => x.wait > 2).length, knownN: kn.length, unknownN: xings.length - kn.length, assumedWait: (xings.length - kn.length) * UNKNOWN_SIG_COST,
           total: t - BASE - dep, walk: route.length / SPEED, meters: Math.round(route.length) };
}

const clock = s => { s = Math.round(s); const h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60; return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"); };
// 시간은 한 형식: 1시간 미만 '2분 01초', 1시간 이상 '1시간 05분'. 콜론 표기는 쓰지 않는다.
const dur = s => { s = Math.max(0, Math.round(s)); return s < 60 ? s + "초" : s < 3600 ? Math.floor(s / 60) + "분 " + String(s % 60).padStart(2, "0") + "초" : Math.floor(s / 3600) + "시간 " + String(Math.floor(s % 3600 / 60)).padStart(2, "0") + "분"; };
const durHTML = s => dur(s).replace(/(\d+)(시간|분|초)/g, "$1<small>$2</small>");
const mins = s => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? m + "분" : Math.floor(m / 60) + "시간 " + String(m % 60).padStart(2, "0") + "분"; };
function phrase(s) { s = Math.round(Math.abs(s)); const m = Math.floor(s / 60), r = s % 60; return (m ? m + "분 " : "") + (r ? r + "초" : (m ? "" : "0초")); }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- 지도 ----------
async function tileBundle(i) {
  if (!tileBundle.c) tileBundle.c = new Map();
  if (!tileBundle.c.has(i)) tileBundle.c.set(i, fetchB64("tiles/" + IDX.bundles[i]));
  return tileBundle.c.get(i);
}
// 웹앱 호스팅이 바이너리 파일을 받지 않아 타일·글자 파일은 base64 글자로 올려 두었다
async function fetchB64(p) {
  const r = await fetch(DATA + p);
  if (!r.ok) throw new Error(p + " " + r.status);
  const s = atob(await r.text()), a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a.buffer;
}
const gunzip = buf => new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
const GLYPH_RANGES = new Set(["0-255", "256-511", "8192-8447"]);
maplibregl.addProtocol("jj", async params => {
  const u = params.url.slice(5);
  if (u.startsWith("glyphs/")) {
    const range = u.split("/").pop();
    if (!GLYPH_RANGES.has(range)) return { data: new ArrayBuffer(0) };
    return { data: await fetchB64("glyphs/" + range + ".txt") };
  }
  const ent = IDX.tiles[u.slice(6)];
  if (!ent) return { data: new ArrayBuffer(0) };
  const buf = await tileBundle(ent[0]);
  return { data: await gunzip(buf.slice(ent[1], ent[1] + ent[2])) };
});

const lineFC = (coords, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
const EMPTY = { type: "FeatureCollection", features: [] };
function routeFC(route) {
  if (!route) return EMPTY;
  const fs = [lineFC(route.coords)];
  // 지하도·육교 구간은 따로 표시
  let run = [];
  const set = new Set(route.under);
  route.coords.forEach((c, i) => { if (set.has(i)) { if (!run.length && i > 0) run.push(route.coords[i - 1]); run.push(c); } else if (run.length) { fs.push(lineFC(run, { u: 1 })); run = []; } });
  if (run.length) fs.push(lineFC(run, { u: 1 }));
  return { type: "FeatureCollection", features: fs };
}
function corridor() {
  // 신호 패턴을 아는 구간: 실측 신호(REAL) 위치를 감싸는 사각형 + 약 250m 여유
  const pts = Object.keys(REAL.signals).map(id => SIGMETA.get(id)).filter(Boolean).map(m => m.ll);
  if (!pts.length) return { type: "FeatureCollection", features: [] };
  const mx = 250 / (111320 * Math.cos(37.55 * Math.PI / 180)), my = 250 / 110540;
  const x0 = Math.min(...pts.map(p => p[0])) - mx, x1 = Math.max(...pts.map(p => p[0])) + mx;
  const y0 = Math.min(...pts.map(p => p[1])) - my, y1 = Math.max(...pts.map(p => p[1])) + my;
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } };
}
// 횡단 시간 지도 (내 걸음 지도)
const XW = {
  lens: [], v: 1.0, on: true, cuts: [20, 35], colors: ["#8FA3B3", "#F6C343", "#FF6B4A"],
  colorExpr() { const v = this.v; return ["step", ["/", ["get", "len"], v], this.colors[0], this.cuts[0], this.colors[1], this.cuts[1], this.colors[2]]; },
  async load() {
    const d = await getJSON("crosswalks.json"), K = d.q, f = [], p = [];
    this.lens = [];
    for (const [x, y, dx, dy, l] of d.rows) {
      const a = [d.lon0 + x / K, d.lat0 + y / K], b = [d.lon0 + (x + dx) / K, d.lat0 + (y + dy) / K], len = l / 10;
      this.lens.push(len);
      f.push({ type: "Feature", properties: { len }, geometry: { type: "LineString", coordinates: [a, b] } });
      p.push({ type: "Feature", properties: { len }, geometry: { type: "Point", coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] } });
    }
    this.fc = [f, p]; this.apply(); this.paint();
  },
  apply() {
    if (!this.fc || !map || !mapReady) return;
    map.getSource("xwl").setData({ type: "FeatureCollection", features: this.fc[0] }); map.getSource("xwp").setData({ type: "FeatureCollection", features: this.fc[1] });
    this.paint(); this.sync();
  },
  share(sec) { const n = this.lens.length; return n ? this.lens.filter(l => l / this.v >= sec).length / n : 0; },
  paint() {
    if (map && mapReady) for (const id of ["xw-dot", "xw-line"]) map.setPaintProperty(id, id === "xw-dot" ? "circle-color" : "line-color", this.colorExpr());
    const kmh = this.v * 3.6, out = $("xw-value"), sl = $("xw-speed");
    if (!out) return;
    out.textContent = `시속 ${kmh.toFixed(1)}km`;
    if (sl && Number(sl.value) !== Math.round(kmh * 10) / 10) sl.value = kmh.toFixed(1);
    const n = this.lens.length;
    $("xw-stat").textContent = n ? `35초 넘는 횡단 ${Math.round(this.share(35) * 100)}%` : "횡단 길이 불러오는 중…";
    $("xw-sub").textContent = n ? `서울 횡단 ${n.toLocaleString("ko-KR")}곳 · 길이÷속도` : "";
  },
  setSpeed(mps) { this.v = Math.min(1.7, Math.max(0.35, mps)); this.paint(); },
  // 횡단 시간 칠하기는 홈 지도에서만 보이고, 켜짐 토글이 꺼져 있으면 숨긴다.
  // 횡단 시간 지도는 따로 켜는 모드(기본 꺼짐). 홈의 중심은 목적지 검색
  sync() { if (!map) return; const vis = current === "home" && this.userOn === true; this.on = vis; $("xw-panel").hidden = !vis; ready(() => { for (const id of ["xw-dot", "xw-line"]) map.setLayoutProperty(id, "visibility", vis ? "visible" : "none"); }); },
  show(on) { this.userOn = on; this.sync(); },
};
function mapStyle() {
  const W = pairs => ["interpolate", ["exponential", 1.5], ["zoom"], ...pairs.flat()];
  const kinds = arr => ["in", ["get", "kind"], ["literal", arr]];
  const surface = ["!=", ["get", "tunnel"], true];
  const FONT = ["Noto Sans Regular"];
  const st = (id, filter, minzoom, paint, layout = {}) => ({ id, type: "line", source: "osm", "source-layer": "streets", minzoom, filter: ["all", surface, filter], layout: { "line-cap": "round", "line-join": "round", ...layout }, paint });
  const HW = ["motorway", "motorway_link", "trunk", "trunk_link"], MAJ = ["primary", "primary_link", "secondary", "secondary_link"];
  const MIN = ["tertiary", "tertiary_link", "residential", "unclassified", "living_street"], FOOT = ["footway", "path", "pedestrian", "cycleway", "track", "bridleway"];
  const label = (id, layer, filter, minzoom, size, color, extra = {}) => ({ id, type: "symbol", source: "osm", "source-layer": layer, minzoom, filter,
    layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": size, "text-max-width": 7, ...extra.layout },
    paint: { "text-color": color, "text-halo-color": "#343D43", "text-halo-width": 1.6, ...extra.paint } });
  return {
    version: 8,
    glyphs: "jj://glyphs/{fontstack}/{range}",
    sources: {
      osm: { type: "vector", tiles: ["jj://tiles/{z}/{x}/{y}"], minzoom: 0, maxzoom: 14, bounds: [126.58, 37.35, 127.31, 37.72] },
      cov: { type: "geojson", data: corridor() },
      rs: { type: "geojson", data: EMPTY }, rj: { type: "geojson", data: EMPTY },
      xwl: { type: "geojson", data: EMPTY }, xwp: { type: "geojson", data: EMPTY },
      sigall: { type: "geojson", data: { type: "FeatureCollection", features: SIGS.map(([id, x, y, , cits]) => ({ type: "Feature", properties: { id, c: cits, k: known(id) ? 1 : 0 }, geometry: { type: "Point", coordinates: fromQ(x, y) } })) } },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#343D43" } },
      { id: "green", type: "fill", source: "osm", "source-layer": "land", filter: kinds(["park", "garden", "grass", "meadow", "forest", "wood", "village_green", "recreation_ground", "golf_course", "cemetery", "playground", "heath", "scrub", "allotments", "orchard", "grave_yard", "nature_reserve"]),
        paint: { "fill-color": ["match", ["get", "kind"], ["forest", "wood", "nature_reserve"], "#435149", "#3D4A42"] } },
      { id: "sites", type: "fill", source: "osm", "source-layer": "sites", paint: { "fill-color": ["match", ["get", "kind"], ["parking"], "#3D454B", "#394248"] } },
      { id: "water", type: "fill", source: "osm", "source-layer": "water_polygons", paint: { "fill-color": "#354D5A" } },
      { id: "waterline", type: "line", source: "osm", "source-layer": "water_lines", filter: ["!=", ["get", "tunnel"], true], paint: { "line-color": "#354D5A", "line-width": W([[10, .6], [16, 4]]) } },
      { id: "cov", type: "fill", source: "cov", minzoom: 12, paint: { "fill-color": "#F6C343", "fill-opacity": .09 } },
      { id: "cov-line", type: "line", source: "cov", minzoom: 12, paint: { "line-color": "#C99A12", "line-width": 1.3, "line-dasharray": [3, 3] } },
      { id: "bld", type: "fill", source: "osm", "source-layer": "buildings", minzoom: 14, paint: { "fill-color": "#414A50", "fill-outline-color": "#4B565E", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, .3, 15.5, 1] } },
      st("foot-case", kinds(FOOT.concat("steps")), 15, { "line-color": "#6A7377", "line-width": W([[15, 2], [18, 5]]) }),
      st("foot", kinds(FOOT), 15, { "line-color": "#343D43", "line-width": W([[15, 1], [18, 3.5]]) }),
      st("steps", kinds(["steps"]), 15, { "line-color": "#343D43", "line-width": W([[15, 1], [18, 3.5]]), "line-dasharray": [.6, .4] }, { "line-cap": "butt" }),
      st("service", kinds(["service"]), 14, { "line-color": "#343D43", "line-width": W([[14, .8], [18, 6]]) }),
      st("rail", kinds(["rail", "light_rail"]), 10, { "line-color": "#BDB9B1", "line-width": W([[10, .6], [16, 2]]), "line-dasharray": [3, 2] }),
      st("minor-case", kinds(MIN), 13, { "line-color": "#D4D0C7", "line-width": W([[13, 1.6], [16, 7], [18, 17]]) }),
      st("major-case", kinds(MAJ), 9, { "line-color": "#C9C3B7", "line-width": W([[9, .9], [12, 3], [14, 6.5], [16, 14], [18, 30]]) }),
      st("hw-case", kinds(HW), 8, { "line-color": "#E3A64A", "line-width": W([[8, 1.2], [12, 3.4], [14, 7], [16, 15], [18, 32]]) }),
      st("minor", kinds(MIN), 13, { "line-color": "#343D43", "line-width": W([[13, .9], [16, 5.5], [18, 15]]) }),
      st("major", kinds(MAJ), 9, { "line-color": "#343D43", "line-width": W([[9, .5], [12, 2], [14, 5], [16, 12], [18, 27]]) }),
      st("hw", kinds(HW), 8, { "line-color": "#FFD58C", "line-width": W([[8, .7], [12, 2.4], [14, 5.6], [16, 13], [18, 29]]) }),
      // 경로
      { id: "route-short-case", type: "line", source: "rs", layout: { "line-cap": "round", "line-join": "round" }, filter: ["!", ["has", "u"]], paint: { "line-color": "#2A3140", "line-opacity": .55, "line-width": W([[12, 6], [18, 12]]) } },
      { id: "route-short", type: "line", source: "rs", layout: { "line-cap": "round", "line-join": "round" }, filter: ["!", ["has", "u"]], paint: { "line-color": "#959EAC", "line-width": W([[12, 3.5], [18, 7]]) } },
      { id: "route-jjuk-case", type: "line", source: "rj", filter: ["!", ["has", "u"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2A3140", "line-opacity": .55, "line-width": W([[12, 7], [18, 14]]) } },
      { id: "route-jjuk", type: "line", source: "rj", filter: ["!", ["has", "u"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#F6C343", "line-width": W([[12, 4.5], [18, 9]]) } },
      { id: "route-jjuk-under", type: "line", source: "rj", filter: ["has", "u"], paint: { "line-color": "#2A3140", "line-width": W([[12, 1.5], [18, 3]]), "line-dasharray": [1, 1.5] } },
      // 신호 교차로: 가까이서만 표시. 노란 테두리 = 패턴 수집 중
      // 횡단 시간 지도: 길이 ÷ 걷는 속도로 칠한다(신호와 무관). 색 기준은 XW.colorExpr()이 속도에 따라 바꾼다.
      { id: "xw-dot", type: "circle", source: "xwp", maxzoom: 15.5, paint: { "circle-color": XW.colorExpr(), "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.1, 13, 2.4, 15, 4], "circle-opacity": .92 } },
      { id: "xw-line", type: "line", source: "xwl", minzoom: 14.5, layout: { "line-cap": "round" }, paint: { "line-color": XW.colorExpr(), "line-width": ["interpolate", ["linear"], ["zoom"], 14.5, 2.2, 17, 6, 19, 11], "line-opacity": .96 } },
      { id: "sig-all", type: "circle", source: "sigall", minzoom: 15, layout: { visibility: "none" }, paint: {   // 2026-10-30: signal-view.js 아이콘으로 대체
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, ["case", ["==", ["get", "k"], 1], 5, 3], 18, ["case", ["==", ["get", "k"], 1], 9, 6]],
        "circle-color": ["case", ["==", ["get", "k"], 1], "#2A3140", ["==", ["get", "c"], 1], "#59617A", "#959CAB"],
        "circle-stroke-color": ["case", ["==", ["get", "k"], 1], "#F6C343", "#343D43"], "circle-stroke-width": ["case", ["==", ["get", "k"], 1], 2.5, 1.2] } },
      // 글자
      label("water-label", "water_polygons_labels", ["has", "name"], 13, 12, "#9EBCCA", { layout: { "text-font": FONT } }),
      label("street-label-minor", "street_labels", kinds(MIN.concat("service", "pedestrian")), 15.5, 11, "#CBD0D1", { layout: { "symbol-placement": "line", "text-max-angle": 30 } }),
      label("street-label-major", "street_labels", kinds(MAJ.concat(HW)), 12, ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 13.5], "#E4E5DE", { layout: { "symbol-placement": "line", "text-max-angle": 30 } }),
      label("poi", "pois", ["has", "name"], 15.5, 11, "#C9CBC5", { layout: { "symbol-sort-key": 10 } }),
      label("place", "place_labels", kinds(["suburb", "quarter", "neighbourhood", "borough", "city", "town", "village"]), 10,
        ["match", ["get", "kind"], ["city", "borough"], 15, ["suburb", "town"], 13.5, 12], "#E5E8DF", { paint: { "text-halo-width": 2 } }),
      { id: "station", type: "circle", source: "osm", "source-layer": "public_transport", minzoom: 12.5, filter: kinds(["station", "halt"]), paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.5, 3, 16, 6], "circle-color": "#2FA84F", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } },
      label("station-label", "public_transport", kinds(["station", "halt"]), 13, ["interpolate", ["linear"], ["zoom"], 13, 11, 16, 13], "#9CD1A5",
        { layout: { "text-anchor": "top", "text-offset": [0, .7], "text-padding": 40, "text-field": ["case", ["in", "역", ["get", "name"]], ["get", "name"], ["concat", ["get", "name"], "역"]] }, paint: { "text-halo-width": 2 } }),
    ],
  };
}

let map = null, mapReady = false, dynMarkers = [], walker = null, pickMarker = null;
const ready = fn => mapReady ? fn() : map.once("load", fn);
const mapEl = Object.assign(document.createElement("div"), { id: "mapbox" });
function el(cls, html) { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; return d; }
function ensureMap() {
  if (map) return map;
  map = new maplibregl.Map({ container: mapEl, style: mapStyle(), center: ME.ll, zoom: 14.9, attributionControl: false,
    localIdeographFontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'Noto Sans CJK KR', sans-serif",
    pitchWithRotate: false, maxBounds: [[126.62, 37.38], [127.27, 37.70]], minZoom: 10, maxZoom: 19 });
  map.once("load", () => { mapReady = true; XW.apply(); });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 70, unit: "metric" }), "bottom-right");
  map.on("rotate", () => { $("ctl-north").hidden = Math.abs(map.getBearing()) < 1; });
  map.on("click", onMapClick);
  map.on("moveend", () => { if (typeof LIVE !== "undefined") LIVE.sync(); if (typeof SIG !== "undefined") { SIG.loadView(); SIG.tick(); if (current === "result") SIG.showCallout(); } });   // 지도가 맞춰진 뒤 말풍선 방향을 다시 정한다
  for (const l of ["sig-all"]) { map.on("mouseenter", l, () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", l, () => map.getCanvas().style.cursor = ""); }
  return map;
}
function mountMap(containerId) {
  $(containerId).appendChild(mapEl);
  ensureMap();
  map.resize();
  $("mapctl").hidden = false; $("map-attrib").hidden = false;
}
function clearDyn() { dynMarkers.forEach(m => m.remove()); dynMarkers = []; if (walker) { walker.remove(); walker = null; } }
function addDyn(elm, ll, opts = {}) { const m = new maplibregl.Marker({ element: elm, ...opts }).setLngLat(ll).addTo(map); dynMarkers.push(m); return m; }
function setRoutes(rj, rs) { ready(() => { map.getSource("rj").setData(routeFC(rj)); map.getSource("rs").setData(routeFC(rs)); }); }
function fit(coordsList, extra = {}) {
  const all = coordsList.flat(); const b = new maplibregl.LngLatBounds(all[0], all[0]); all.forEach(c => b.extend(c));
  const phoneRect=$("phone").getBoundingClientRect(),panel=document.getElementById("sheet-"+current)?.getBoundingClientRect();
  const sidePanel=panel&&panel.width<phoneRect.width*.8&&panel.left>phoneRect.left+phoneRect.width*.3;
  // 홈·결과의 지도 컨테이너는 시트 위까지만 차지하므로 시트 높이를 빼지 않는다. 걷기 화면은 지도가 시트 밑까지 이어진다.
  const bounded = current === "result" || current === "home";
  const pad = { top: bounded ? 36 : 90, bottom: sidePanel ? 40 : bounded ? 30 : sheetH() + 30, left: 34, right: sidePanel ? panel.width + 48 : 120, ...extra };   // 오른쪽 지도 버튼(약 56px)+도착지 이름표
  ready(() => { map.resize(); map.fitBounds(b, { padding: pad, duration: 0, maxZoom: 17 }); });
}
function markTrip(sims, focus, forecasts = false) {
  clearDyn();
  addDyn(el(state.from.me ? "m-me" : "m-start", state.from.me ? "<i></i>" : ""), state.from.ll);
  addDyn(el("m-dest", `<i></i><span>${esc(state.to.name)}</span>`), state.to.ll, { anchor: "left", offset: [-11, 0] });
  if (!sims) return;
  const seen = new Set();
  for (const k of [focus, focus === "jjuk" ? "short" : "jjuk"]) {
    if (!sims[k]) continue;
    for (const x of sims[k].xings) {
      if (seen.has(x.id)) continue; seen.add(x.id);
      const cls = !forecasts || !x.known ? "unk" : x.wait > 2 ? "stop" : "go", label = forecasts && x.known && x.wait > 2 && k === focus ? `<b>${x.wait}초</b>` : "";
      const m = el(`m-sig ${cls}${k === focus ? "" : " dim"}`, `<span>${!forecasts || !x.known ? "" : x.wait > 2 ? "Ⅱ" : "✓"}</span>${label}`);
      m.dataset.sig = x.id; m.title = x.name;
      addDyn(m, x.at);
    }
  }
}
document.addEventListener("click", e => {
  if (!map) return;
  if (e.target.closest("#ctl-in")) map.zoomIn();
  if (e.target.closest("#ctl-out")) map.zoomOut();
  if (e.target.closest("#ctl-north")) map.resetNorth();
  if (e.target.closest("#ctl-loc")) {
    if (current === "walk") {
      if (walker && gpsFix && Date.now() - gpsFix.timestamp < 30000) map.easeTo({ center: walker.getLngLat(), zoom: 16.5 });
      else renderWalk();
    } else locate(false);
  }
});

// 지도 누르기: 홈에서는 그 위치를 도착지 후보로, 신호 점을 누르면 신호 상세로
function onMapClick(ev) {
  const box = [[ev.point.x - 8, ev.point.y - 8], [ev.point.x + 8, ev.point.y + 8]];
  const xw = XW.on && map.queryRenderedFeatures(box, { layers: ["xw-line", "xw-dot"] })[0];
  if (xw && !map.queryRenderedFeatures(box, { layers: ["sig-all"] })[0]) {
    const len = xw.properties.len, sec = Math.round(len / XW.v);
    new maplibregl.Popup({ closeButton: false, offset: 10, className: "xw-pop" }).setLngLat(ev.lngLat).setHTML(`<b>${sec}초</b><span>길이 약 ${Math.round(len)}m · 시속 ${(XW.v * 3.6).toFixed(1)}km</span>`).addTo(map);
    return;
  }
  const sig = map.queryRenderedFeatures(box, { layers: ["sig-all"] })[0];
  if (sig) { state.sig = String(sig.properties.id); go("signal"); return; }
  if (current !== "home") return;
  const f = map.queryRenderedFeatures(box, { layers: ["station-label", "poi", "place", "station"] }).find(f => f.properties.name);
  const ll = f && f.geometry.type === "Point" ? f.geometry.coordinates : [ev.lngLat.lng, ev.lngLat.lat];
  const name = f ? f.properties.name + (f.layer.id.startsWith("station") && !f.properties.name.endsWith("역") ? "역" : "") : "지도에서 고른 위치";
  showPlace({ name, sub: "", ll });
  if (!f) ensureSearch().then(list => {
    // 이름 없는 곳은 가장 가까운 이름 있는 장소로 설명한다
    let best = null, bd = 150;
    for (const p of list) { const d = distLL(p.ll, ll); if (d < bd) { bd = d; best = p; } }
    if (best && state.picked && state.picked.ll === ll) { state.picked.name = `${best.name} 근처`; $("hp-name").textContent = state.picked.name; }
  });
}
function showPlace(p) {
  state.picked = p;
  if (pickMarker) pickMarker.remove();
  pickMarker = new maplibregl.Marker({ element: el("m-pick", ""), anchor: "bottom-left", offset: [-4, 4] }).setLngLat(p.ll).addTo(map);
  $("home-intro").hidden = true; $("home-place").hidden = false;
  $("hp-name").textContent = p.name;
  const d = state.from ? distLL(state.from.ll, p.ll) : 0;
  $("hp-sub").textContent = (p.sub ? p.sub + " · " : "") + (state.from ? `${state.from.name}에서 직선 ${km(d)}` : "출발지를 먼저 확인해 주세요");
  $("home-actions").innerHTML = `<button class="btn btn-ghost" id="hp-from">여기서 출발</button><button class="btn btn-primary" id="hp-to">여기까지 길찾기</button>`;
  setSheet("home", "mid");
}
// ---------- 끌 수 있는 아래 시트 ----------
const sheets = {};
const phoneH = () => $("phone").clientHeight;
function sheetH() { const s = sheets[current]; return s ? s.h : 0; }
function setSheet(name, pos, px) {
  const sh = $("sheet-" + name); if (!sh) return;
  const s = sheets[name] || (sheets[name] = { pos: "mid", h: 0 });
  const sn = snaps(name);
  s.pos = pos || s.pos;
  s.h = px ?? sn[s.pos];
  sh.style.setProperty("--h", s.h + "px");
  sh.classList.toggle("full", s.pos === "full");
  sh.classList.toggle("peek", s.pos === "peek");
  if (name === current) {
    $("phone").style.setProperty("--sheet-h", s.h + "px");
    $("mapctl").hidden = s.pos === "full";
    layoutMapCtl();
  }
}
// 지도 조작 버튼은 지도가 보이는 영역 안에만 둔다. 남는 높이가 모자라면(작은 화면) 확대·축소 묶음은 감추고(핀치로 확대) 내 위치만 남긴다.
function layoutMapCtl() {
  const ctl = $("mapctl"), name = current, sh = sheets[name];
  if (!sh || !["home", "result", "walk"].includes(name)) return;
  const small = phoneH() < 690, mapTop = name === "home" ? (small ? 138 : 148) : name === "result" ? 96 : 112, top = mapTop + 12;
  ctl.style.top = top + "px";
  $("ctl-in").parentElement.hidden = phoneH() - sh.h - top - 12 < 152;
}
function setPeek(name, html) { const el = $("sheet-" + name).querySelector("[data-peek]"); if (el) el.innerHTML = html; }
function initSheet(name) {
  const sh = $("sheet-" + name), grip = sh.querySelector(".grip-area");
  grip.setAttribute("role","button"); grip.tabIndex = 0;
  grip.setAttribute("aria-label","패널 높이 바꾸기");
  grip.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSheet(name,sheets[name].pos === "full" ? "mid" : "full"); } });
  let y0 = 0, h0 = 0, moved = false;
  grip.addEventListener("pointerdown", e => { y0 = e.clientY; h0 = sheets[name].h; moved = false; sh.classList.add("dragging"); grip.setPointerCapture(e.pointerId); });
  grip.addEventListener("pointermove", e => {
    if (!sh.classList.contains("dragging")) return;
    const dy = y0 - e.clientY; if (Math.abs(dy) > 4) moved = true;
    const sn = snaps(name), h = Math.max(sn.peek - 20, Math.min(sn.full + 20, h0 + dy));
    sheets[name].h = h; sh.style.setProperty("--h", h + "px"); $("phone").style.setProperty("--sheet-h", h + "px");
    sh.classList.toggle("peek", h < sn.peek + 40);
  });
  const end = () => {
    if (!sh.classList.contains("dragging")) return;
    sh.classList.remove("dragging");
    const sn = snaps(name), h = sheets[name].h;
    let pos;
    if (!moved) pos = sheets[name].pos === "full" ? "mid" : sheets[name].pos === "mid" ? "full" : "mid";
    else pos = Object.entries(sn).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0];
    setSheet(name, pos);
  };
  grip.addEventListener("pointerup", end); grip.addEventListener("pointercancel", end);
  // 글이 줄바꿈되거나 상태 줄이 생기면 시트 높이를 다시 맞춘다(버튼 줄이 잘리지 않게)
  if (name !== "result" && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => { if (name === current && !sh.classList.contains("dragging")) setSheet(name); });
    [...sh.querySelector(".sheet-body").children, sh.querySelector(".sheet-footer")].filter(Boolean).forEach(c => ro.observe(c));
  }
}

// ---------- 상태 ----------
const state = { deadline: 9 * 3600 + 600, budget: 120, from: null, to: null, mode: "actual", dep: 0, focus: "jjuk", routes: null, sims: null, src: null, dst: null, pick: "to", tripKey: null, error: null };
let current = null;
const setStatus = (title, text) => { if (current === "result") { $("result-status").hidden = false; $("result-status").innerHTML = `<b>${esc(title)}</b>${esc(text)}`; } };
const tripKeyNow = () => `${readProfile().avoidSteps}|${state.budget}|${state.mode}|${BASE}|${SPEED}|${state.from?.ll.join()}|${state.to?.ll.join()}`;
let tripRequest = 0, resultRequest = 0;
const nowSeconds = () => { const n = new Date(); return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds(); };
// ---------- 이동 마찰: 빠른 길 vs 쭉고 길 ----------
// 빠른 길 = 걷는 시간만으로 가장 빠른 길. 쭉고 길 = 아래 '의미 있는 대안' 조건을 만족하는 다른 길(없으면 보여 주지 않는다).
// 시간 비교는 걷는 시간만 쓴다(신호 대기 가정은 넣지 않는다). 가중치는 후보를 찾을 때만 쓰고 비교는 원시값으로 한다.
const fGain = (e, u) => e.f ? (u === e.a ? e.f[0] : e.f[1]) / 10 : 0;   // 오르는 높이(m)
const fSteep = e => e.f ? e.f[2] : 0;                                    // 8% 이상 경사 거리(m)
// [근처 횡단보도당 초, 보행등 횡단보도당 초, 상승 m당 초, 급경사 m당 초, 계단 m당 초] — 실험 v3와 같은 후보 탐색
// 여섯째 값은 예상 신호 대기(초)당 비용(신뢰되는 신호만).
const FRICTION_WEIGHTS = [[0,0,0,0,0,0], [0,20,0,0,0,0], [0,60,0,0,0,0], [0,150,0,0,0,0], [0,0,2,0,0,0], [0,0,6,0,0,0], [0,0,15,0,0,0],
  [0,0,0,0.3,0,0], [0,0,0,1,0,0], [0,0,0,3,0,0], [0,0,0,0,1,0], [0,0,0,0,3,0], [0,0,0,0,8,0], [20,20,2,0.3,1,0], [60,60,6,1,3,0], [150,150,15,3,8,0],
  [0,0,0,0,0,0.5], [0,0,0,0,0,1], [0,0,0,0,0,2], [0,20,0,0,0,1], [0,60,2,0,1,1], [20,20,2,0.3,1,1], [60,60,6,1,3,2]];
const ALT_GAIN = [["sig", 1], ["stairs", 1], ["steep", 100], ["gain", 10], ["wait", 30]];          // 이만큼 줄면 의미 있는 개선
const ALT_WORSE = { sig: 0, stairs: 0, big: 0, cross: 1, gain: 5, steep: 50, wait: 20 };        // 이만큼까지만 나빠져도 됨
const ALT_MAX_EXTRA = 180, SAME_OVERLAP = 0.9, SAME_EXTRA = 10;
// 추천 품질 기준: 억지 대안보다 '대안 없음'이 낫다.
//  - 너무 많이 돌아가는 길: 추가 시간이 max(60초, 빠른 길 걷는 시간의 25%)를 넘으면 버린다(짧은 길에서 +3분 같은 우회 방지).
//  - 사실상 같은 길: 빠른 길과 겹치지 않는 구간이 60m 미만이면 버린다.
//  - 개선량에 비해 추가 시간이 큰 길: 줄인 요소별로 허용하는 추가 시간(초) 중 가장 큰 값까지만.
//  - 다른 요소가 크게 나빠지는 길: ALT_WORSE.
const ALT_DETOUR_MIN = 60, ALT_DETOUR_FRAC = 0.25, SAME_UNIQUE_M = 60;
const ALT_WORTH = { sig: d => 60 * d, stairs: d => 180 * d, steep: d => 1.2 * d, gain: d => 9 * d, wait: d => d };
function searchFriction(src, dst, w) {
  const [wx, ws, wr, wst, wt, ww = 0] = w, D = G.node.get(dst);
  const hEst = n => Math.hypot((n.x - D.x) * KXQ, (n.y - D.y) * KYQ) / SPEED * 0.999;
  const cost = new Map([[src, 0]]), time = new Map([[src, 0]]), prev = new Map(), done = new Set(), h = new Heap(), avoid = readProfile().avoidSteps;
  h.push(hEst(G.node.get(src)), src);
  while (h.size) {
    const u = h.pop()[1], c = cost.get(u);
    if (done.has(u)) continue;
    done.add(u);
    if (u === dst) break;
    for (const e of G.adj.get(u) || []) {
      if (e.cls === 3 && avoid) continue;
      const v = e.a === u ? e.b : e.a, nv = G.node.get(v);
      if (!nv || done.has(v)) continue;
      const tu = time.get(u) ?? 0;
      let cv = c + e.len / SPEED, tv = tu + e.len / SPEED;
      if (e.f) cv += wx * e.f[3] + ws * e.f[4] + wr * fGain(e, u) + wst * e.f[2];
      if (wt && e.cls === 3) cv += wt * e.len;
      if (ww && e.sig) { const wt_ = expectedWait(e.sig, BASE + state.dep + tu, e.dir); if (wt_ != null) { cv += ww * wt_; tv += wt_; } }
      if (cv < (cost.get(v) ?? Infinity)) { cost.set(v, cv); time.set(v, tv); prev.set(v, [u, e]); h.push(cv + hEst(nv), v); }
    }
  }
  if (!done.has(dst)) return null;
  const steps = []; let v = dst;
  while (v !== src) { const [u, e] = prev.get(v); steps.push([u, v, e]); v = u; }
  return steps.reverse();
}
// 서울 횡단보도 표준 자료 점(보행등 유무). 신호 횡단을 셀 때만 쓴다.
let STD = null;
async function loadStd() {
  if (STD) return STD;
  const rows = await getJSON("crosswalks_std.json"), grid = new Map();
  for (const [x, y, s] of rows) { const ll = fromQ(x, y), k = Math.floor(ll[0] * 2000) + "," + Math.floor(ll[1] * 2000); (grid.get(k) || grid.set(k, []).get(k)).push([ll, s]); }
  return (STD = grid);
}
function stdNear(ll, R) {
  const out = [], k0 = Math.floor(ll[0] * 2000), k1 = Math.floor(ll[1] * 2000);
  if (!STD) return out;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of STD.get((k0 + a) + "," + (k1 + b)) || []) if (distLL(ll, p[0]) <= R) out.push(p);
  return out;
}
function rayBearing(e, at) {
  const pts = edgePts(e, at).map(p => fromQ(...p)), a = pts[0];
  let b = pts[pts.length - 1];
  for (const q of pts.slice(1)) if (distLL(a, q) > 3) { b = q; break; }
  return (Math.atan2((b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI + 360) % 360;
}
// 횡단: 경로가 지나는 노드에서, 경로가 쓰지 않은 차도 두 가지가 한 줄을 이루고 들어오는·나가는 방향이 그 줄의 서로 다른 쪽이면 1회.
// 또 지도(OSM)에 횡단보도로 그려진 간선(cls 5)을 지나면 횡단 1회. 25m 안에 이어진 횡단은 하나로 묶는다. 신호 횡단 = 그 지점 25m 안에 보행등 있는 횡단보도 점. 큰길 = 간선도로(cls 0).
// T자 골목 입구는 어느 쪽 보도인지 몰라 세지 않는다(적게 세는 쪽).
function routeCrossings(steps) {
  const ev = []; let cum = 0;
  for (let k = 0; k < steps.length - 1; k++) {
    const [u0, v, e] = steps[k], eNext = steps[k + 1][2];
    // 지도(OSM)에 횡단보도로 그려진 간선을 지나면 그 자체로 횡단 1회(차도와 노드를 공유하지 않는 경우가 많다)
    if (e.cls === 5) { const p = edgePts(e, u0), m = p[p.length >> 1]; ev.push({ d: cum + e.len / 2, at: fromQ(m[0], m[1]), big: !!e.sig }); }
    cum += e.len;
    const roads = (G.adj.get(v) || []).filter(x => x !== e && x !== eNext && x.cls <= 1).map(x => [rayBearing(x, v), x]);
    if (roads.length < 2) continue;
    const bIn = rayBearing(e, v), bOut = rayBearing(eNext, v), pairs = [], used = new Set(), cand = [];
    for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) cand.push([Math.abs(((roads[i][0] - roads[j][0] + 540) % 360) - 180), i, j]);
    cand.sort((p, q) => q[0] - p[0]);
    for (const [diff, i, j] of cand) { if (diff < 140 || used.has(i) || used.has(j)) continue; used.add(i); used.add(j); pairs.push([roads[i], roads[j]]); }
    const n = G.node.get(v);
    for (const [[ba, ea], [, eb]] of pairs) {
      const side = b => Math.sin((b - ba) * Math.PI / 180), si = side(bIn), so = side(bOut);
      if (si * so < 0 && Math.abs(si) > 0.17 && Math.abs(so) > 0.17) ev.push({ d: cum, at: fromQ(n.x, n.y), big: ea.cls === 0 || eb.cls === 0 });
    }
  }
  const last = steps[steps.length - 1];
  if (last && last[2].cls === 5) { const p = edgePts(last[2], last[0]), m = p[p.length >> 1]; ev.push({ d: cum + last[2].len / 2, at: fromQ(m[0], m[1]), big: !!last[2].sig }); }
  ev.sort((p, q) => p.d - q.d);
  const groups = [];
  for (const x of ev) { const g = groups[groups.length - 1]; if (g && x.d - g[g.length - 1].d <= 25) g.push(x); else groups.push([x]); }
  let sig = 0, big = 0; const xlist = [];
  for (const g of groups) {
    const s = g.some(x => stdNear(x.at, 25).some(p => p[1] === 1)), b = g.some(x => x.big);
    if (s) sig++; if (b) big++; xlist.push({ d: g[0].d, at: g[0].at, sig: s, big: b });
  }
  // xlist: 비교표의 '신호 횡단'과 횡단 상세 목록이 같은 기준을 쓰도록 같이 돌려준다
  return { cross: groups.length, sig, big, xlist };
}
// 교차로 점 v를 e로 들어와 eNext로 나갈 때 건너는 도로의 다리(n/e/s/w). routeCrossings와 같은 판정(마주 보는 두 차도, 들어온 쪽과 나간 쪽이 반대편).
// 남북으로 지나가며 동서 도로를 건너면 ['e','w'](동쪽 또는 서쪽 횡단보도). 건너지 않으면 [].
const legOf = b => ["n", "e", "s", "w"][Math.round((((b % 360) + 360) % 360) / 90) % 4];
function nodeCrossLegs(v, e, eNext) {
  if (!eNext) return [];
  const roads = (G.adj.get(v) || []).filter(x => x !== e && x !== eNext && x.cls <= 1).map(x => [rayBearing(x, v), x]);
  if (roads.length < 2) return [];
  const bIn = rayBearing(e, v), bOut = rayBearing(eNext, v), legs = new Set();
  for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) {
    if (Math.abs(((roads[i][0] - roads[j][0] + 540) % 360) - 180) < 140) continue;
    const side = b => Math.sin((b - roads[i][0]) * Math.PI / 180), si = side(bIn), so = side(bOut);
    if (si * so < 0 && Math.abs(si) > 0.17 && Math.abs(so) > 0.17) { legs.add(legOf(roads[i][0])); legs.add(legOf(roads[j][0])); }
  }
  return [...legs];
}
// 횡단 x의 t초 예상 대기: 방향이 정해졌으면 그 다리, 후보만 있으면 후보 다리 패턴이 모두 같은 답일 때만(다르면 모름)
function crossingWait(x, t) {
  // 길이를 아는 횡단보도는 내 속도로 건너는 시간 + 여유(SIG.MARGIN_S와 같은 3초)만큼 초록이 남아야 '기다림 없음'
  const need = x.len ? x.len / SPEED + 3 : 0;
  if (x.dir) return expectedWait(x.s, t, x.dir, need);
  const ws = (x.dirs || []).map(d => expectedWait(x.s, t, d, need)).filter(w => w != null);
  if (!ws.length || (ws.some(w => w === 0) && ws.some(w => w > 0))) return null;
  return Math.max(...ws);
}
// 경로의 신호 횡단별 예상 대기: 신뢰되는 패턴이 있는 곳만 더하고, 없는 곳은 '정보 없음'으로 센다(45초 같은 가정값은 쓰지 않는다).
function routeWaits(route) {
  let t = 0, wait = 0, known = 0, unknown = 0;
  for (const x of route.x || []) {
    if (!x.dir && x.dirs && !x.dirs.length) continue;   // 교차로 점을 지나기만 하고 도로를 건너지 않음
    const arrive = BASE + state.dep + x.d / SPEED + t, w = crossingWait(x, arrive);
    if (w == null) { unknown++; continue; }
    known++; wait += w; t += w;
  }
  return { wait, waitKnown: known, waitUnknown: unknown, waitTotal: known + unknown };
}
function routeMetrics(route, steps) {
  let gain = 0, steep = 0;
  for (const [u, , e] of steps) { gain += fGain(e, u); steep += fSteep(e); }
  return { walk: route.length / SPEED, meters: route.length, stairs: route.stairs, gain, steep, ...routeCrossings(steps), ...routeWaits(route) };
}
function routeOverlap(a, b) {
  const set = new Set(b.steps.map(s => s[2])); let shared = 0;
  for (const s of a.steps) if (set.has(s[2])) shared += s[2].len;
  return a.length ? shared / a.length : 1;
}
function altGains(alt, base) {
  return ALT_GAIN.filter(([k, thr]) => {
    // 대기 감소는 비교가 공정할 때만: 쭉고 길도 빠른 길만큼(이상) 신호 패턴이 확인돼 있어야 한다. 정보가 없어서 0초로 보이는 것을 '덜 기다림'으로 세지 않는다.
    if (k === "wait") return base.m.waitKnown > 0 && alt.m.waitKnown >= base.m.waitKnown && alt.m.waitUnknown <= base.m.waitUnknown && base.m.wait - alt.m.wait >= thr;
    return base.m[k] - alt.m[k] >= thr;
  }).map(([k]) => k);
}
// 대안이 아닌 이유(없으면 null). QA와 시험에서 왜 대안이 없는지 볼 수 있게 이름을 돌려준다.
function altRejectReason(c, base, limit) {
  const extra = c.m.walk - base.m.walk, overlap = routeOverlap(c, base);
  if (extra <= SAME_EXTRA || overlap >= SAME_OVERLAP || c.length * (1 - overlap) < SAME_UNIQUE_M) return "same";
  if (extra > limit) return "budget";
  if (extra > Math.max(ALT_DETOUR_MIN, base.m.walk * ALT_DETOUR_FRAC)) return "detour";
  if (Object.entries(ALT_WORSE).some(([k, lim]) => (k === "wait" ? (base.m.waitKnown > 0 && c.m.waitKnown >= base.m.waitKnown && c.m.waitUnknown <= base.m.waitUnknown ? c.m.wait - base.m.wait : 0) : c.m[k] - base.m[k]) > lim)) return "worse";
  const g = altGains(c, base);
  if (!g.length) return "no_gain";
  if (extra > Math.max(...g.map(k => ALT_WORTH[k](base.m[k] - c.m[k])))) return "small_gain";
  return null;
}
function pickAlternative(base, cands, limit) {
  let best = null; pickAlternative.rejected = {};
  for (const c of cands) {
    const extra = c.m.walk - base.m.walk;
    const why = altRejectReason(c, base, limit);
    if (why) { pickAlternative.rejected[why] = (pickAlternative.rejected[why] || 0) + 1; continue; }
    if (!best || extra < best.m.walk - base.m.walk) best = c;
  }
  return best;
}
// 한 줄 설명: "+25초로 신호 횡단 1개를 줄일 수 있어요"
function hasBatchim(word) {
  const ch = word.trim().slice(-1), code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/m$/.test(word)) return false;                        // 미터
  if (/[0-9]$/.test(word)) return "013678".includes(ch);    // 영, 일, 삼, 육, 칠, 팔
  return false;
}
const josa = (w, a, b) => w + (hasBatchim(w) ? a : b);
// 추정 시간은 1분이 넘으면 30초 단위로 반올림한다("약 2분 1초" → "약 2분"). 1분 안쪽은 초 그대로.
function roundedDur(s) { s = Math.max(0, Math.round(s)); if (s >= 60) s = Math.round(s / 30) * 30; const m = Math.floor(s / 60), r = s % 60; return m ? m + "분" + (r ? " " + r + "초" : "") : r + "초"; }
function extraText(s) { return "+" + roundedDur(s); }
// 문구의 숫자는 비교표에 보이는 값(반올림한 값)끼리의 차이로 만든다. 그래야 표와 문구가 항상 맞는다.
const shownValue = (k, m) => k === "steep" ? Math.round(m.steep / 10) * 10 : k === "gain" ? Math.round(m.gain) : m[k];
const shownDiff = (k, b, a) => shownValue(k, b) - shownValue(k, a);
function compareLine(base, alt) {
  const g = altGains(alt, base), parts = [], b = base.m, a = alt.m;
  let avoidAll = true;
  for (const k of g) {
    if (k === "sig") { parts.push(`신호 횡단 ${b.sig - a.sig}개`); avoidAll = avoidAll && a.sig === 0; }
    if (k === "stairs") { parts.push(`계단 ${b.stairs - a.stairs}구간`); avoidAll = avoidAll && a.stairs === 0; }
    if (k === "steep") { parts.push(`급경사 ${shownDiff("steep", b, a)}m`); avoidAll = avoidAll && shownValue("steep", a) === 0; }
    if (k === "gain") { parts.push(`오르막 ${shownDiff("gain", b, a)}m`); avoidAll = false; }
    if (k === "wait") { parts.push(`신호 대기 ${waitText(b.wait - a.wait)}`); avoidAll = false; }
  }
  const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).map((p, i) => i === parts.length - 2 ? josa(p, "과", "와") : p).join(", ") + " " + parts[parts.length - 1];
  const joined = parts.length <= 2 ? (parts.length === 2 ? josa(parts[0], "과", "와") + " " + parts[1] : parts[0]) : list;
  return `${josa(extraText(a.walk - b.walk), "으로", "로")} ${josa(joined, "을", "를")} ${avoidAll ? "피할" : "줄일"} 수 있어요`;
}
// 결과 시트 머리말: 배지·제목·부제(원시값으로만, 점수 없음)
function aboutText(s) { return "약 " + roundedDur(s); }
function waitText(sec) { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), r = sec % 60; return m ? m + "분" + (r ? " " + r + "초" : "") : r + "초"; }
// 결과 시트 머리말: 배지·제목·장단점 칩. "더 편한" 같은 단정 대신 무엇을 피하고 무엇이 늘어나는지 원시값으로 말한다(점수 없음).
// pros/cons는 비교표에 보이는 값끼리의 차이(shownDiff)로 만든다. 시간은 걷는 시간만(신호 대기 제외)이라 '빨리 도착'이라고 하지 않는다.
function tradeoffs(me, other) {
  const a = me.m, b = other.m, pros = [], cons = [];
  // 1분이 넘는 차이는 탭에 보이는 분(mins)끼리의 차이로 말한다(탭 15분·13분인데 '2분 30초'로 나오던 불일치)
  const dt = a.walk - b.walk, tabMin = s => Math.max(1, Math.round(s / 60)), dm = tabMin(a.walk) - tabMin(b.walk);
  const diffText = d => Math.abs(dt) < 60 || !dm ? aboutText(Math.abs(dt)) : `약 ${Math.abs(dm)}분`;
  if (dt <= -10) pros.push(`${diffText()} 덜 걸어요`); else if (dt >= 10) cons.push(`${diffText()} 더 걸어요`);
  const items = [["stairs", "확인된 계단", "구간", 1], ["sig", "신호 횡단", "곳", 1], ["steep", "급경사", "m", 10], ["gain", "오르막", "m", 5]];   // 비교표의 강조 기준과 같은 최소 차이
  for (const [k, name, unit, min] of items) {
    const d = shownDiff(k, other.m, me.m);   // 양수면 내가 적음
    if (d >= min) pros.push(`${name} ${d}${unit} 적어요`); else if (-d >= min) cons.push(`${name} ${-d}${unit} 많아요`);
  }
  if (a.waitKnown > 0 && b.waitKnown > 0 && a.waitUnknown <= b.waitUnknown && b.waitUnknown <= a.waitUnknown) {
    const w = b.wait - a.wait;
    if (w >= 30) pros.push(`예상 신호 대기 ${aboutText(w)} 짧아요`); else if (-w >= 30) cons.push(`예상 신호 대기 ${aboutText(-w)} 길어요`);
  }
  return { pros, cons };
}
function routeSummary(base, alt, focus) {
  if (!alt || alt === base) return { badge: "", headline: "걷는 시간이 가장 짧은 길", sub: "비슷한 시간 안에 계단·신호 횡단·경사를 줄이는 다른 길이 없어요", pros: [], cons: [], wait: false };
  const b = base.m, a = alt.m;
  if (focus === "short") {
    const t = tradeoffs(base, alt);
    return { badge: "", headline: "걷는 시간이 가장 짧은 길", sub: [...t.pros, ...t.cons].join(" · "), pros: t.pros, cons: t.cons, wait: false };
  }
  const g = altGains(alt, base), order = ["wait", "stairs", "sig", "steep", "gain"].filter(k => g.includes(k)), parts = [];
  let avoidAll = true;
  for (const k of order) {
    if (k === "stairs") { parts.push(`확인된 계단 ${b.stairs - a.stairs}구간`); avoidAll = avoidAll && a.stairs === 0; }
    if (k === "sig") { parts.push(`신호 횡단 ${b.sig - a.sig}곳`); avoidAll = avoidAll && a.sig === 0; }
    if (k === "steep") { parts.push(`급경사 ${shownDiff("steep", b, a)}m`); avoidAll = avoidAll && shownValue("steep", a) === 0; }
    if (k === "gain") { parts.push(`오르막 ${shownDiff("gain", b, a)}m`); avoidAll = false; }
  }
  const first = order[0], t = tradeoffs(alt, base);
  if (first === "wait") {
    // 예상 신호 대기가 줄어드는 길: 대표 문장은 대기시간. 건널 수 있는지는 말하지 않는다.
    return { badge: "신호 대기가 짧을 것으로 예상", kind: "wait", headline: `신호에서 ${aboutText(b.wait - a.wait)} 덜 기다릴 것으로 예상돼요`, sub: [...t.pros, ...t.cons].join(" · "), pros: t.pros, cons: t.cons, wait: true };
  }
  const joined = parts.length === 1 ? parts[0] : josa(parts[0], "과", "와") + " " + parts.slice(1).join(", ");
  const badge = { stairs: a.stairs === 0 ? "확인된 계단을 피해요" : "확인된 계단이 적어요", sig: "신호 횡단이 적어요", steep: "급경사 구간이 짧아요", gain: "오르막이 적어요" }[first];
  return { badge, kind: first, headline: `${josa(joined, "을", "를")} ${avoidAll ? "피하는" : "줄이는"} 길`, sub: [...t.pros, ...t.cons].join(" · "), pros: t.pros, cons: t.cons, wait: false };
}
async function computeTrip() {
  const request = ++tripRequest;
  const key = tripKeyNow();
  if (state.tripKey === key && state.routes) { refreshSims(); return; }
  state.tripKey = key; state.routes = null; state.error = null; state.snapNote = ""; state.tripStartedAt = performance.now();
  const d = distLL(state.from.ll, state.to.ll);
  if (d > 30000) { state.error = {kind:"too_far",title:"걷기 범위를 나눠 주세요",text:"직선30km를 넘는 구간은 중간 지점을 골라 나눠서 찾아 주세요."}; return; }
  if (d < 30) { state.error = { kind: "too_near", title: "출발지와 도착지가 거의 같아요", text: "다른 곳을 골라 주세요." }; return; }
  // 지원 지역: 보행 그래프 조각이 있는 곳(서울). 밖이면 엉뚱한 출입구 안내 대신 지역 밖이라고 말한다.
  const outside = [["출발지", state.from], ["도착지", state.to]].filter(([, p]) => !cellsFor(p.ll, p.ll, 60).length).map(([n]) => n);
  if (outside.length) { state.error = { kind: "outside", title: `${outside.join("·")}가 지원 지역 밖이에요`, text: "쭉고는 서울 안의 보행 도로망에서만 길을 찾아요. 서울 안에서 다시 골라 주세요.", pick: outside[0] === "출발지" ? "from" : "to" }; return; }
  const cells = cellsFor(state.from.ll, state.to.ll, Math.max(700, d * 0.25));
  if (cells.some(k => !G.cells.has(k))) setStatus("길 찾는 중…", `지도 조각 ${cells.length}개를 받고 있어요${d > 5000 ? " (먼 길이라 조금 걸려요)" : ""}.`);
  try {
    const firstHour = Math.floor(BASE / 3600), horizon = Math.min(23, Math.ceil(d * 2 / SPEED / 3600) + 1);
    const hours = Array.from({length:horizon + 1}, (_, i) => firstHour + i);
    const [, plans] = await Promise.all([Promise.all(cells.map(loadCell)), loadSignalPlans(hours).catch(() => ({signals:{},source_dates:[],date:null})), loadStd().catch(() => null)]);
    if (request !== tripRequest || key !== tripKeyNow()) return;
    REAL = plans;
  } catch (err) {
    if (request !== tripRequest || key !== tripKeyNow()) return;
    state.error = {kind:"network",title:"지도 연결이 끊겼어요",text:"연결을 확인하고 아래에서 다시 시도해 주세요."};
    return;
  }
  const lim = p => p.me ? SNAP_GPS_M : SNAP_PLACE_M;
  let a = snap(state.from.ll, lim(state.from)), b = snap(state.to.ll, lim(state.to));
  // 연결 실패인데 주변 500m에 보행로 점이 거의 없으면 지원 지역 밖(서울 경계 근처는 지도 조각만 있고 보행로 자료가 없다)
  const sparse = ll => { let n = 0; for (const v of G.node.values()) if (distLL(fromQ(v.x, v.y), ll) < 500 && ++n >= 20) return false; return true; };
  const far = [["출발지", state.from, a], ["도착지", state.to, b]].filter(([, p, s]) => (s.id == null || s.d > lim(p)) && sparse(p.ll)).map(([n]) => n);
  if (far.length) { state.error = { kind: "outside", title: `${far.join("·")}가 지원 지역 밖이에요`, text: "쭉고는 서울 안의 보행 도로망에서만 길을 찾아요. 서울 안에서 다시 골라 주세요.", pick: far[0] === "출발지" ? "from" : "to" }; return; }
  if (a.id == null || b.id == null || a.d > lim(state.from) || b.d > lim(state.to)) { const gps = (a.id == null || a.d > lim(state.from)) && state.from.me; state.error = { kind: "snap", title: "출입구 가까이에서 골라 주세요", text: `보행로와 ${gps ? SNAP_GPS_M : SNAP_PLACE_M}m 넘게 떨어져 있어 임의로 연결하지 않았어요. 지도의 실제 출입구나 보행로를 출발·도착으로 선택해 주세요.`, pick: gps || a.id == null || a.d > lim(state.from) ? "from" : "to" }; return; }
  // 서로 이어지지 않은 작은 보행로 조각(캠퍼스·단지 안 길 등)에 붙었으면, 반대쪽과 이어진 보행로로 다시 붙인다
  const reach = from => { const seen = new Set([from]), q = [from], avoid = readProfile().avoidSteps;
    while (q.length) { const u = q.pop(); for (const e of G.adj.get(u) || []) { if (e.cls === 3 && avoid) continue; const v = e.a === u ? e.b : e.a; if (!seen.has(v) && G.node.has(v)) { seen.add(v); q.push(v); } } }
    return seen; };
  const ra = reach(a.id);
  if (!ra.has(b.id)) {
    const rb = reach(b.id);
    if (ra.size >= rb.size) { const nb = snap(state.to.ll, lim(state.to), e => ra.has(e.a) && ra.has(e.b)); if (nb.id != null) b = nb; }
    else { const na = snap(state.from.ll, lim(state.from), e => rb.has(e.a) && rb.has(e.b)); if (na.id != null) a = na; }
  }
  state.src = a.id; state.dst = b.id;
  // 장소 점에서 보행로까지 40m 넘게 떨어졌으면 결과 화면에 알린다(그 구간은 직선으로 걷는 시간에 더한다. buildRoute)
  state.snapNote = [["출발지", a], ["도착지", b]].filter(([, s]) => s.d > 40).map(([n, s]) => `${n}에서 보행로까지 약 ${Math.round(s.d / 10) * 10}m는 직선으로 계산`).join(" · ");
  const t0 = performance.now();
  // 먼 길은 탐색 횟수를 줄인다(응답 시간)
  const weights = d > 5000 ? FRICTION_WEIGHTS.filter((_, i) => [0, 2, 5, 8, 11, 14, 17, 21].includes(i)) : FRICTION_WEIGHTS;
  const seen = new Set(), cands = [];
  for (const w of weights) {
    const steps = searchFriction(state.src, state.dst, w);
    if (!steps) continue;
    const key = steps.map(s => s[0] + "-" + s[1]).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const route = buildRoute(steps, state.src, state.from.ll, state.to.ll);
    if (!Number.isFinite(route.length) || !route.coords.every(p => p.every(Number.isFinite))) continue;
    route.steps = steps; route.m = routeMetrics(route, steps); cands.push(route);
  }
  const short = cands[0] || null;
  const alt = short ? pickAlternative(short, cands.slice(1), Math.min(state.budget ?? ALT_MAX_EXTRA, ALT_MAX_EXTRA)) : null;
  const jjuk = alt || short;
  // 계산 시간: lastRouteMs = 후보 탐색만, lastTripMs = 지도 조각·신호 패턴 받기까지 포함(사용자가 기다리는 시간)
  state.lastRouteMs = performance.now() - t0; state.lastTripMs = performance.now() - state.tripStartedAt; state.candidateCount = cands.length;
  if (!short || !jjuk) { state.error = { kind: "no_route", title: "길을 못 찾았어요", text: readProfile().avoidSteps ? "확인된 계단을 제외한 연결 경로를 찾지 못했어요. 이동 조건이나 출입구를 확인해 주세요." : "보행 도로망에서 두 곳의 연결을 찾지 못했어요. 다른 출입구를 골라 주세요." }; return; }
  state.routes = { short, jjuk, dep: state.dep, budget: state.budget, alt: !!alt };
  refreshSims();
}
function refreshSims() {
  if (!state.routes) { state.sims = null; return; }
  if (state.fixedRoute) { state.routes[state.fixedFocus] = state.fixedRoute; state.routes.dep = state.dep; state.routes.budget = state.budget; state.fixedRoute = null; }
  // 출발 시각이 바뀌면 신호 위상이 달라지므로 두 길을 다시 찾는다
  if (false) {   // 빠른 길 vs 쭉고 길 비교판에서는 출발 시각에 따라 길을 다시 고르지 않는다(신호 예측을 쓰지 않음)
    const cost = (r, s) => s.wait + s.assumedWait + s.stops * STOP_COST + r.stairMeters * 2 + r.rise * 8;
    const candidates = [routeFor("short", state.dep), routeFor("jjuk", state.dep), routeFor("gentle", state.dep)].filter(Boolean).map(r=>({r,s:simulate(r,state.dep)}));
    candidates.sort((a,b)=>a.s.total-b.s.total || a.r.length-b.r.length);
    state.routes.short = candidates[0].r;
    state.routes.jjuk = candidates.filter(c=>c.s.total<=candidates[0].s.total+state.budget)
      .sort((a,b)=>cost(a.r,a.s)-cost(b.r,b.s) || a.s.total-b.s.total)[0].r;
    state.routes.dep = state.dep; state.routes.budget = state.budget;
  }
  const R = state.routes;
  let sj = simulate(R.jjuk, state.dep), ss = simulate(R.short, state.dep);
  // shortcut: 세 가중치 후보의 비교이며 전역 최적·무장애 경로를 보장하지 않는다.
  state.same = R.jjuk.key === R.short.key;
  state.sims = { jjuk: sj, short: ss };
  if (state.same) state.focus = "jjuk";
}
const tripLabel = p => p.me ? `${p.name}` : p.name;

// 위치는 기기 메모리에만 둔다. 최근 검색·서버·공유 카드에는 GPS 좌표를 저장하지 않는다.
let gpsFix = null, gpsWatch = null, gpsStaleTimer = null, gpsRequest = 0, gpsPending = false;
function gpsStatus(text) {
  for (const [screen, id] of [["home","location-status"],["walk","walk-location"],["search","search-location"],["result","result-location"]]) {
    const t = current === screen ? text : "";
    setText(id, t); if ($(id).hidden !== !t) $(id).hidden = !t;
  }
}
function stopGPS() {
  if (gpsPending) { gpsPending = false; gpsStatus(""); }
  if (gpsWatch != null) navigator.geolocation?.clearWatch(gpsWatch);
  gpsWatch = null; clearInterval(gpsStaleTimer); gpsRequest++;
}
function readFix(p, maxAccuracy = 100) {
  const { longitude, latitude, accuracy } = p.coords;
  if (![longitude, latitude, accuracy, p.timestamp].every(Number.isFinite) || accuracy < 0) throw new Error("위치 정보를 확인하지 못했어요");
  if (Date.now() - p.timestamp > 30000 || p.timestamp > Date.now() + 5000) throw new Error("위치가 오래됐어요. 다시 연결해 주세요");
  if (longitude < 126.68 || longitude > 127.23 || latitude < 37.39 || latitude > 37.72) throw new Error("지금은 서울 지도 범위에서만 길을 찾을 수 있어요");
  if (accuracy > maxAccuracy) throw new Error(`위치 오차가 약 ${Math.round(accuracy)}m예요. 탁 트인 곳에서 다시 연결해 주세요`);
  return { ll: [longitude, latitude], accuracy, timestamp: p.timestamp };
}
function requestLocation(ok,fail) {
 const request=gpsRequest;
 const refine=(err,cached)=>{
   if(request!==gpsRequest)return;
   if(err?.code===1)return fail(err);
   gpsStatus('정확한 위치로 다시 연결하고 있어요…');
   navigator.geolocation.getCurrentPosition(ok,e=>cached&&cached.coords.accuracy<=1000?ok(cached):fail(e),{enableHighAccuracy:true,timeout:25000,maximumAge:0});
 };
 navigator.geolocation.getCurrentPosition(p=>p.coords.accuracy<=100?ok(p):refine(null,p),err=>refine(err),{enableHighAccuracy:false,timeout:8000,maximumAge:30000});
}
function gpsError(err) {
  gpsPending = false;
  const msg = err.code === 1 ? "위치를 연결하지 못했어요. 위치 권한이 차단됐어요. 브라우저의 사이트 권한과 기기의 위치 설정을 확인해 주세요." : err.code === 3 ? "위치를 연결하지 못했어요. 기기에서 위치를 받지 못했어요. 내장 브라우저라면 Chrome·Safari에서 열거나 직접 선택해 주세요." : (err.code===2 ? "위치를 연결하지 못했어요. 위치 제공을 사용할 수 없어요. 기기의 위치 서비스를 켜거나 외부 브라우저에서 열어 주세요." : err.message || "위치를 연결하지 못했어요. 위치를 찾지 못했어요. 지도에서 골라 주세요");
  if (current === "walk") {
    // 걷기 중에는 '출발지를 골라라'가 아니라 위치를 다시 잇는 방법만 말한다
    gpsStatus(err.code === 1 ? "위치를 연결하지 못했어요. 위치 권한이 꺼져 있어요. 브라우저의 이 사이트 위치 권한을 허용한 뒤 '위치 다시 연결'을 눌러 주세요."
      : err.code === 2 ? "위치를 연결하지 못했어요. 기기의 위치 서비스가 꺼져 있어요. 켠 뒤 '위치 다시 연결'을 눌러 주세요."
      : "위치를 연결하지 못했어요. 아직 위치를 받지 못했어요. 하늘이 트인 곳에서 '위치 다시 연결'을 눌러 주세요.");
    return;
  }
  gpsStatus(msg.includes("지도에서") ? msg : msg + " 지도에서 출발지를 골라도 돼요.");
}
function locate(useAsStart) {
  if (!navigator.geolocation || !window.isSecureContext) { gpsStatus("위치 연결은 HTTPS에서 사용할 수 있어요. 지도에서 출발지를 골라 주세요"); return; }
  const request = ++gpsRequest, screen = current;
  gpsPending = true; gpsStatus("내 위치를 찾고 있어요…");
  requestLocation(p => {
    if (request !== gpsRequest || current !== screen) return;
    try {
      gpsPending = false;
      gpsFix = readFix(p, 1000);
      if (gpsFix.accuracy > 100) {
        go("home");
        showPlace({name:"대략적인 내 위치",sub:`오차 약 ${Math.round(gpsFix.accuracy)}m · 출발 위치를 확인해 주세요`,ll:gpsFix.ll,me:true});
        gpsStatus("대략 위치만 찾았어요. 지도에서 실제 출발 지점을 확인해 주세요");
        map.easeTo({center:gpsFix.ll,zoom:15}); return;
      }
      gpsStatus(`내 위치 연결 · 오차 약 ${Math.round(gpsFix.accuracy)}m`);
      if (useAsStart) {
        state.from = { name: "내 위치", sub: "GPS", ll: gpsFix.ll, me: true };
        state.mode = "actual"; state.routes = null; state.tripKey = null; state.fixedRoute = null; state.dep = 0; state.homeView = true;
        if (current === "search") { if (!state.to) state.pick = "to"; go(state.to ? "result" : "search"); } else { state.pick="to"; go(state.to ? "result" : "search"); }
      } else if (map) {
        if (walker) walker.setLngLat(gpsFix.ll);
        else addDyn(el("m-me", "<i></i>"), gpsFix.ll);
        map.easeTo({ center: gpsFix.ll, zoom: 16.5 });
        // 출발지를 아직 안 정했으면 내 위치를 출발지로 둔다(목적지만 고르면 바로 길 비교)
        if (!state.from && current === "home") { state.from = { name: "내 위치", sub: "GPS", ll: [...gpsFix.ll], me: true }; setText("home-origin", "내 위치"); }
      }
    } catch (err) { gpsError(err); }
  }, err => { if (request === gpsRequest && current === screen) gpsError(err); });
}
function projectOnRoute(route, ll) {
  let best = { offset: Infinity, distance: 0 };
  const kx = 111320 * Math.cos(ll[1] * Math.PI / 180);
  for (let i = 1; i < route.coords.length; i++) {
    const a = route.coords[i - 1], b = route.coords[i];
    const ax = (a[0] - ll[0]) * kx, ay = (a[1] - ll[1]) * 110540;
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * 110540;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const offset = Math.hypot(ax + t * dx, ay + t * dy);
    if (offset < best.offset) best = { offset, distance: route.cum[i - 1] + t * (route.cum[i] - route.cum[i - 1]) };
  }
  return best;
}
function plausibleProgress(previous, fix, distance) {
  if (!previous) return true;
  const dt = (fix.timestamp - previous.timestamp) / 1000;
  const limit = Math.max(60, dt * 3 + previous.accuracy + fix.accuracy);
  return dt > 0 && distLL(previous.ll, fix.ll) <= limit && Math.abs(distance - previous.distance) <= limit;
}
// 페이지가 사라질 때 지금까지의 걷기를 저장한다(좌표 없는 요약만). 진행 중 기록을 따로 임시 저장하지는 않는다.
addEventListener("pagehide", () => { endWalk(); stopGPS(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { stopGPS(); if (current === "walk") gpsStatus("다른 화면에 있는 동안 위치 측정을 잠시 멈췄어요"); return; }
  if (current === "walk") renderWalk(false, true);   // 돌아오면 같은 걷기를 자동으로 이어 간다('위치 다시 연결'을 누르지 않아도 됨)
});

// ---------- 출발 시각 (쭉고의 중심) ----------
// 지금 보는 길 그대로, 지금(dep=0)부터 15분 사이 5초 간격으로 출발해 보며
// 가장 덜 멈추는 출발과 마감에 맞는 가장 늦은 출발을 찾는다. (출발마다 길을 바꾸면 비교가 흐려진다)
const fmtSlack = s => s >= 60 ? `${Math.floor(s / 60)}분` + (s % 60 >= 30 ? " 30초" : "") : `${Math.max(0, Math.round(s))}초`;
function comfortCopy(routes, sims, focus, same, budget) {
  if (same) return {title:"같은 길이에요",copy:budget ? `${budget/60}분 더 걸어도 덜 힘든 길이 없어요.` : "같은 시간 안에선 덜 힘든 길이 없어요."};
  if (focus === "short") return {title:"도착 시간을 우선한 길",copy:"비교한 후보 중 예상 시간이 짧은 길이에요."};
  const a=routes.short,b=routes.jjuk,as=sims.short,bs=sims.jjuk;
  const stairs=a.stairs-b.stairs,stairsComparable=!a.under?.length&&!b.under?.length;
  const terrainComparable=stairsComparable&&a.length>0&&b.length>0&&a.terrainMeters/a.length>=.8&&b.terrainMeters/b.length>=.8;
  const rise=terrainComparable?a.rise-b.rise:0;
  const signals=as.knownN+as.unknownN-bs.knownN-bs.unknownN;
  const title=stairs>0&&stairsComparable?"지도상 계단이 적은 후보":rise>=10?"오르막 추정이 적은 후보":signals>0?`지도상 신호가 ${signals}곳 적은 후보`:"비슷한 조건의 다른 경로";
  const extra=bs.total-as.total,parts=[Math.abs(extra)>2?`예상 ${phrase(extra)} ${extra>0?"더":"덜"} 걸려요`:"예상 시간은 거의 같아요"];
  if(stairs<0)parts.push(`검출 계단 ${-stairs}구간은 더 지나가요`);
  if(stairs>0&&stairsComparable)parts.push(`지도에 표시된 계단 ${stairs}구간이 적어요`);
  if(rise<=-10)parts.push(`지형상 상승량 추정은 약 ${Math.round(-rise/5)*5}m 더 있어요`);
  if(signals<0)parts.push(`신호는 ${-signals}곳 더 지나가요`);
  if(rise>=10)parts.push(`지형상 상승량 추정은 약 ${Math.round(rise/5)*5}m 적어요`);
  parts.push("계단·지형은 지도 자료의 추정이에요");
  return {title,copy:parts.join(". ")+"."};
}
// '이번 신호 놓쳐도 괜찮아?' 한 줄. 마감이 있으면 여유와 비교한다. 뛰라고 하지 않는다.
// ---------- 화면 ----------
function stripHTML(sim, scale, walkClass) {
  return sim.segs.map(seg => seg.type === "unk" ? `<i class="unk"></i>` : `<i class="${seg.type === "wait" && seg.s > 2 ? "wait" : walkClass}" style="width:${(seg.s / scale * 100).toFixed(2)}%"></i>`).join("");
}
function statLine(sim) {
  const parts = [];
  if (sim.knownN) parts.push(`멈춤 <strong>${sim.stops}번</strong> · 기다림 <strong>${dur(sim.wait)}</strong>`);
  if (sim.unknownN) parts.push(`${sim.knownN ? "패턴 없는 신호" : "신호"} <strong>${sim.unknownN}곳</strong>`);
  if (!sim.knownN && !sim.unknownN) parts.push(`신호 <strong>0곳</strong>`);
  return parts.join(" · ");
}
function pointAt(route, dist) {
  const c = route.coords, cum = route.cum;
  if (dist <= 0) return c[0];
  for (let i = 0; i < c.length - 1; i++) if (cum[i + 1] >= dist) {
    const t = (dist - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
    return [c[i][0] + t * (c[i + 1][0] - c[i][0]), c[i][1] + t * (c[i + 1][1] - c[i][1])];
  }
  return c[c.length - 1];
}
function routeGuidance(route, distance) {
  const hints = [...(route.guides || []), ...route.x.map(x=>({d:x.d,label:x.name}))].filter(h=>h.d>distance+3&&h.label);   // 이름 없는 안내('다음 안내 503m'만 있는 카드)는 만들지 않는다
  for (let i=1;i<route.cum.length-1;i++) {
    const at=route.cum[i];
    if(at<distance+12 || at>distance+120) continue;
    const a=pointAt(route,Math.max(0,at-12)),b=pointAt(route,at),c=pointAt(route,Math.min(route.length,at+12));
    const scale=Math.cos(b[1]*Math.PI/180),u=[(b[0]-a[0])*scale,b[1]-a[1]],v=[(c[0]-b[0])*scale,c[1]-b[1]];
    const turn=Math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1])*180/Math.PI;
    if(Math.abs(turn)>=50 && Math.abs(turn)<=160) hints.push({d:at,label:turn>0?"보행로를 따라 왼쪽으로":"보행로를 따라 오른쪽으로"});
  }
  return hints.sort((a,b)=>a.d-b.d)[0] || null;
}
let walkTimer = null, walkTrack = null, walkClock = null;
// 걷기 화면을 떠나거나 '걷기 끝내기'일 때만 기록을 마무리한다(위치 다시 연결은 마무리하지 않는다).
// 기록 저장이 어긋나도 끝내기는 막히지 않고, GPS는 항상 정리한다.
function endWalk() {
  clearInterval(walkClock); walkClock = null;
  if (!walkTrack) return;
  const tr = walkTrack; walkTrack = null;
  try {
    state.lastWalk = finishTrack(tr, tr.info || {});
    if (state.lastWalk) { state.saveFailed = !!state.lastWalk.unsaved; applyPace(); }
  } catch (err) {
    console.error(err); state.lastWalk = null;
  } finally { stopGPS(); }
}
function walkStats(update) {
  const tr = walkTrack;
  $("w-time").innerHTML = tr ? durHTML(trackElapsedS(tr)) : "—";
  $("w-pace").innerHTML = speedHTML(trackSpeed(tr));
  if (update) update();
}
const SAY_FIRST = "신호 안내는 과거 기록으로 예상한 상태예요. 실제 신호를 함께 확인하세요.", SAY_AFTER = "신호: 과거 기록 패턴 예상";
function renderWalk(demo = false, resume = false) {
  const free = !!state.freeWalk;
  if (!free && !state.sims) return go("result");
  const keep = resume && !demo && !!walkTrack;   // 위치 다시 연결: 같은 걷기를 이어간다
  if (keep) { clearInterval(walkClock); walkClock = null; resumeTrack(walkTrack); } else endWalk();
  stopGPS(); cancelAnimationFrame(walkTimer);
  $("walk-reroute").hidden = true;
  $("walk-demo").hidden = !DEMO_MODE;
  const session = ++gpsRequest;
  const k = state.same ? "jjuk" : state.focus, sim = free ? null : state.sims[k], route = free ? null : state.routes[k];
  mountMap("map-walk"); clearDyn();
  if (free) setRoutes(null, null); else { setRoutes(route, null); markTrip(null, k); }
  setSheet("walk", "mid");
  if (route) fit([route.coords], { top: 170 });
  $("walk-end").hidden = free;
  $("walk-done").textContent = "걷기 끝내고 기록 보기"; $("walk-done").classList.remove("arrived");
  // 신호 안내는 처음 5초만 눈에 띄게 보이고 이후엔 회색 한 줄로 줄인다
  const born = performance.now(), saySync = () => {
    const soft = performance.now() - born > 5000;
    setText("next-say", soft ? SAY_AFTER : SAY_FIRST); $("next-say").classList.toggle("soft", soft);
  };
  $("next-say").hidden = free;
  if (!free) { saySync(); setTimeout(() => { if (current === "walk" && session === gpsRequest) saySync(); }, 5200); }
  let markerAdded = false;
  const update = (dist, ll) => {
    if (current !== "walk" || session !== gpsRequest) return;
    if (ll) {
      if (!markerAdded) {
        walker = new maplibregl.Marker({ element: el("m-me", "<i></i>") }).setLngLat(ll).addTo(map); markerAdded = true;
        if (free) ready(() => map.jumpTo({ center: walker ? walker.getLngLat() : ll, zoom: 16.5 }));
      } else {
        walker.setLngLat(ll);
        if (free) map.easeTo({ center: ll, duration: 400 });
      }
    }
    // 위쪽 카드와 아래 숫자가 같은 거리를 두 번 보여 주지 않는다. 값이 바뀔 때만 쓴다(aria-live 반복 방지).
    if (free) {
      const walked = walkTrack ? trackMeters(walkTrack) : null;
      setText("next-label", "그냥 걷기");
      setText("next-dist", walked == null ? "위치 연결" : km(walked));
      setText("next-state", "멈춘 시간은 속도에서 빼요.");
      $("next-state").hidden = false; $("w-left-col").hidden = true;
      setPeek("walk", `<span>그냥 걷기 · ${$("w-time").textContent}</span><small>${speedText(trackSpeed(walkTrack))}</small>`);
      return;
    }
    const left = dist == null ? null : Math.max(0, route.length - dist);
    $("w-left").textContent = left == null ? "—" : km(left);
    const eta = left == null ? "—" : left < 10 ? "도착 근처" : "약 " + mins(left / (trackSpeed(walkTrack) || SPEED));
    setPeek("walk", `<span>${state.same || k === "short" ? "빠른 길" : "쭉고 길"} · 남은 ${$("w-left").textContent}</span><small>${eta}</small>`);
    // 다음 신호 횡단이 300m 안이면 그것을 먼저 안내한다(도착 시각의 예상 신호로)
    const nx = dist == null ? null : route.x.find(x => SIG.isCrossing(x) && x.d > dist + 3);
    if (typeof SIG !== "undefined") SIG.nextX = nx || null;
    if (nx && nx.d - dist <= 300) {
      const sp = trackSpeed(walkTrack) || SPEED, v = SIG.verdict(nx, SIG.now() + (nx.d - dist) / sp, sp);
      setText("next-label", `다음 횡단보도 · ${v.label}`); setText("next-dist", Math.round(nx.d - dist) + "m"); setText("next-state", v.text);
      $("next-state").hidden = false; $("w-left-col").hidden = false; $("sheet-walk").dataset.next = v.kind;
      saySync(); return;
    }
    const next = dist == null ? null : routeGuidance(route, dist);
    if (next) {
      setText("next-label", "다음 안내"); setText("next-dist", Math.round(next.d - dist) + "m"); setText("next-state", next.label);
      $("next-state").hidden = false; $("w-left-col").hidden = false;
    } else {   // 알 수 없는 방향 안내는 만들지 않는다. 남은 거리만 위에 크게 보여 준다
      if (left == null) { setText("next-label", "경로 거리 · 위치 확인 중"); setText("next-dist", km(route.length)); setText("next-state", "위치를 확인하면 남은 거리를 보여 줘요"); $("next-state").hidden = false; }
      else { setText("next-label", "남은 거리"); setText("next-dist", km(left)); setText("next-state", ""); $("next-state").hidden = true; }
      $("w-left-col").hidden = true;
    }
    saySync();
  };
  walkStats(); update(null);
  if (demo) {
    $("w-time").textContent = "시연"; $("w-pace").textContent = "—";
    gpsStatus("움직임 시연 · 실제 위치나 걷기 기록이 아니에요");
    if (free) return;
    const start = performance.now(), reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = now => {
      if (current !== "walk" || session !== gpsRequest) return;
      const f = reduce ? 0.32 : Math.min(1, (now - start) / 9000);
      update(f * route.length, pointAt(route, f * route.length));
      if (f < 1 && !reduce) walkTimer = requestAnimationFrame(step);
    };
    walkTimer = requestAnimationFrame(step); return;
  }
  if (!navigator.geolocation || !window.isSecureContext) { gpsStatus("걷기 위치 연결에는 HTTPS와 위치 권한이 필요해요. 출발지를 직접 골라 경로를 확인할 수 있어요"); return; }
  gpsStatus("GPS 연결 중 · 위치를 허용해 주세요");
  if (!keep) {
    walkTrack = newTrack(free ? "free" : "route");
    walkTrack.info = { to: free ? null : state.to?.name ?? null, trip: free ? null : state.tripKey, routeLength: route ? route.length : null };
  }
  walkClock = setInterval(() => { if (current === "walk" && session === gpsRequest) walkStats(free ? () => update(null) : null); }, 1000);
  let lastFix = null, previous = null, arrivalFixes = 0;
  const onFix = p => {
    if (current !== "walk" || session !== gpsRequest) return;
    try {
      gpsFix = readFix(p, 50); lastFix = gpsFix.timestamp;
      if (walkTrack) trackAdd(walkTrack, gpsFix);
      // 걷기 시작 = 이 길로 걷기를 누른 뒤 위치가 실제로 처음 잡힌 때(위치 값은 보내지 않는다)
      if (!free && state.walkLogPending) { logEvent("walking_started", { trip: state.tripId, route: state.walkLogPending }); state.walkLogPending = null; }
      walkStats();
      if (free) { update(null, gpsFix.ll); gpsStatus(gpsOk(gpsFix)); return; }
      const progress = projectOnRoute(route, gpsFix.ll);
      if (progress.offset > Math.max(40, gpsFix.accuracy * 2)) {
        update(null, gpsFix.ll);
        $("walk-reroute").hidden = false;
        gpsStatus(`경로에서 약 ${Math.round(progress.offset)}m 떨어져 있어요. 내 위치에서 다시 찾을 수 있어요`);
        return;
      }
      if (!plausibleProgress(previous, gpsFix, progress.distance)) {
        update(null, gpsFix.ll); gpsStatus("위치가 갑자기 바뀌었어요. 진행 판단을 멈췄어요. 위치를 다시 연결해 주세요"); return;
      }
      $("walk-reroute").hidden = true;
      previous = { ...gpsFix, distance: progress.distance };
      update(progress.distance, gpsFix.ll);
      const nearEnd = route.length-progress.distance < 20 && distLL(gpsFix.ll,route.coords[route.coords.length-1]) < 25 && gpsFix.accuracy <= 25;
      arrivalFixes = nearEnd && (!previous || gpsFix.timestamp > (state.arrivalTimestamp || 0)) ? arrivalFixes+1 : 0;
      state.arrivalTimestamp=gpsFix.timestamp;
      if (arrivalFixes>=2) { showArrival(); return; }
      gpsStatus(gpsOk(gpsFix));
    } catch (err) { update(null); gpsError(err); }
  };
  gpsWatch = navigator.geolocation.watchPosition(onFix, err => { if (current === "walk" && session === gpsRequest) { update(null); gpsError(err); } }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 });
  // 결과 화면까지 오며 방금(30초 안) 잡은 정확한 위치가 있으면 그것으로 바로 시작한다(위치를 다시 기다리지 않게). 이후는 watch가 이어 받는다.
  if (gpsFix && Date.now() - gpsFix.timestamp < 30000 && gpsFix.accuracy <= 50) onFix({ coords: { longitude: gpsFix.ll[0], latitude: gpsFix.ll[1], accuracy: gpsFix.accuracy }, timestamp: gpsFix.timestamp });
  gpsStaleTimer = setInterval(() => {
    if (lastFix && Date.now() - lastFix > 30000) { $("walk-reroute").hidden = true; update(null); gpsStatus("위치가 끊겨 측정을 잠시 멈췄어요. 30초 넘게 갱신이 없어요. 다시 연결해 주세요"); }
  }, 5000);
}
// 도착: 위쪽 카드를 도착으로 바꾸고, 끝내기 버튼을 기록 보기로 바꾼다(자동으로 화면을 넘기지 않는다)
function showArrival() {
  setText("next-label", "도착"); setText("next-dist", "도착지 근처예요"); setText("next-state", `${state.to?.name ?? "도착지"} 주변 출입구를 확인해 주세요`);
  $("next-state").hidden = false; $("w-left-col").hidden = true; $("walk-reroute").hidden = true;
  $("walk-done").textContent = "도착 · 기록 보기"; $("walk-done").classList.add("arrived");
  gpsStatus("도착지 근처예요. 걷기를 끝내면 오늘 걸음을 볼 수 있어요");
}
// 걷는 중 상태 문구는 5m 단위로만 바뀐다(스크린 리더가 매번 읽지 않게)
const gpsOk = fix => `GPS 연결 · 오차 약 ${Math.max(5, Math.round(fix.accuracy / 5) * 5)}m`;
function rerouteFromGPS() {
  if (!gpsFix || Date.now() - gpsFix.timestamp > 30000 || gpsFix.accuracy > 100) {
    gpsStatus("현재 위치가 불확실해요. 위치를 다시 연결한 뒤 시도해 주세요"); return;
  }
  state.from = {name:"내 위치",sub:"GPS 재탐색",ll:[...gpsFix.ll],me:true};
  state.mode = "actual"; state.routes = null; state.tripKey = null; state.fixedRoute = null; state.dep = 0;
  go("result");
}
// ---------- 검색 ----------
const norm = s => s.replace(/\s+/g, "").toLowerCase();
async function ensureSearch() {
  if (!SEARCH) SEARCH = getJSON("search.json").then(rows => rows.map(([name, x, y, kind], i) => ({ name, kind, ll: fromQ(x, y), n: norm(name), r: i }))).catch(err => { SEARCH = null; throw err; });
  return SEARCH;
}
const KIND_WORDS = ["카페", "역", "병원", "학교", "공원", "도서관", "시장", "우체국", "대학교"];
async function runSearch(q) {
  const list = await ensureSearch(), qn = norm(q);
  if (!qn) return [];
  const origin = (state.pick === "from" ? state.to?.ll : state.from?.ll) || ME.ll;
  const toks = q.trim().split(/\s+/);
  // "성수동 카페"처럼 [동네·역] + [종류]면 그 근처의 그 종류를 가까운 순으로
  if (toks.length > 1) {
    const last = toks[toks.length - 1], areaQ = norm(toks.slice(0, -1).join(""));
    const area = list.find(p => (p.kind === "동네" || p.kind === "역") && p.n.startsWith(areaQ)) || list.find(p => p.n.includes(areaQ));
    if (area) {
      const near = list.filter(p => p !== area && (p.kind === last || p.n.includes(norm(last))) && distLL(p.ll, area.ll) < 1500)
        .sort((a, b) => distLL(a.ll, area.ll) - distLL(b.ll, area.ll)).slice(0, 30);
      if (near.length) return near.map(p => ({ ...p, near: area.name }));
    }
  }
  if (KIND_WORDS.includes(q.trim()) && q.trim() !== "역") {
    return list.filter(p => p.kind === q.trim()).sort((a, b) => distLL(a.ll, origin) - distLL(b.ll, origin)).slice(0, 30);
  }
  const hits = [];
  for (const p of list) {
    const i = p.n.indexOf(qn);
    if (i < 0) continue;
    hits.push({ p, s: (i === 0 ? 0 : 1) * 1e6 + (p.n === qn ? -1e6 : 0) + p.r + Math.min(distLL(p.ll, origin), 30000) / 10 });
    if (hits.length > 4000) break;
  }
  return hits.sort((a, b) => a.s - b.s).slice(0, 40).map(h => h.p);
}
function hl(name, q) {
  const i = norm(name).indexOf(norm(q)); if (i < 0 || !q.trim()) return esc(name);
  // 공백을 무시한 위치를 원래 문자열 위치로 옮긴다
  let a = -1, b = -1, k = 0;
  for (let j = 0; j < name.length; j++) { if (/\s/.test(name[j])) continue; if (k === i) a = j; k++; if (k === i + norm(q).length) { b = j + 1; break; } }
  return a < 0 || b < 0 ? esc(name) : esc(name.slice(0, a)) + "<mark>" + esc(name.slice(a, b)) + "</mark>" + esc(name.slice(b));
}
let searchSeq = 0;
// 검색 목록의 거리 기준: 실제로 계산에 쓰는 점과 그 설명. 기준이 없으면 거리를 숨긴다(지도 기준점 서울광장으로 잰 거리는 보여 주지 않는다).
const gpsFresh = () => gpsFix && Date.now() - gpsFix.timestamp < 120000 && gpsFix.accuracy <= 100;
function searchRef() {
  const other = state.pick === "from" ? state.to : state.from;
  if (other) return { ll: other.ll, label: state.pick === "from" ? `거리: 도착지 ${other.name}까지 직선` : other.me ? "거리: 내 위치(GPS)에서 직선" : `거리: 출발지 ${other.name}에서 직선` };
  if (gpsFresh()) return { ll: gpsFix.ll, label: "거리: 현재 위치에서 직선" };
  return null;
}
// 검색 중에도 출발·도착 중 무엇을 고르는지, 이미 고른 곳이 무엇인지 함께 보여 준다(누르면 그쪽을 고른다)
function searchTripHTML() {
  const row = (k, label, p) => `<button class="st-row${state.pick === k ? " on" : ""}" data-pick-switch="${k}" aria-pressed="${state.pick === k}"><i class="pt-${k}"></i><span class="st-l">${label}</span><b>${p ? esc(tripLabel(p)) : state.pick === k ? "고르는 중" : "아직 안 정함"}</b></button>`;
  return `<div class="search-trip">${row("from", "출발", state.from)}${row("to", "도착", state.to)}</div>`;
}
async function renderSearchList() {
  const q = $("sq").value, seq = ++searchSeq, ref = searchRef(), origin = ref?.ll || ME.ll;
  const kmCell = p => ref ? `<span class="km">${km(distLL(p.ll, ref.ll))}</span>` : "";
  $("sq-clear").hidden = !q;
  if (!gpsPending) { setText("search-location", ""); $("search-location").hidden = true; }
  $("search-for").innerHTML = searchTripHTML() + (ref ? `<p class="search-basis">${esc(ref.label)}</p>` : "");
  $("sq").placeholder = state.pick === "from" ? "출발지: 역, 동네, 장소 이름" : "도착지: 역, 동네, 장소 이름";
  if (!q.trim()) {
    // 반대쪽에서 이미 고른 곳은 최근 목록에서 뺀다(도착지가 출발지 후보 맨 위에 0m로 나오던 문제)
    const otherName = (state.pick === "from" ? state.to : state.from)?.name;
    const recent = store.get("recent", []).map((p, i) => ({ ...p, i })).filter(p => p.name !== otherName);
    const sugg = ["강남역", "시청역", "홍대입구역", "잠실역", "여의도역", "성수동 카페"];
    let h = "";
    if (state.pick === "from") h += `<button class="res-item" data-res-me><b>내 위치</b><small>GPS로 현재 위치 연결</small></button>`;
    if (recent.length) h += `<p class="sec-title">최근</p>` + recent.map(p => `<button class="res-item" data-res-recent="${p.i}"><b>${esc(p.name)}</b><small>${esc(p.kind || "")}</small>${kmCell(p)}</button>`).join("");
    h += `<p class="sec-title">이렇게 찾아보세요</p>` + sugg.map(s => `<button class="res-item" data-res-sugg="${esc(s)}"><b>${esc(s)}</b><small>${s.includes(" ") ? "동네 + 종류로 근처 찾기" : "역 이름"}</small></button>`).join("");
    h += `<button class="res-item" data-map-pick><b>지도에서 직접 고르기</b><small>지도를 눌러 ${state.pick === "from" ? "출발지" : "도착지"}를 골라요</small></button>`;
    h += `<p class="note">검색 목록: OpenStreetMap에 이름이 있는 역·동네·대학·병원·명소·카페 등 약 1.7만 곳.</p>`;
    $("search-list").innerHTML = h;
    return;
  }
  $("search-list").innerHTML = `<p class="note">찾는 중…</p>`;
  let res;
  try { res = await runSearch(q); }
  catch (err) {
    if (seq !== searchSeq) return;
    $("search-list").results = [];
    $("search-list").innerHTML = `<div class="empty-state"><b>검색 목록을 불러오지 못했어요</b><p>인터넷 연결을 확인하고 다시 시도해 주세요. 지도를 눌러 도착지를 고를 수도 있어요.</p><button class="btn btn-secondary" data-search-retry>다시 시도</button></div>`;
    return;
  }
  if (seq !== searchSeq) return;
  $("search-list").results = res;
  $("search-list").innerHTML = res.length ? res.map((p, i) => {
    return `<button class="res-item" data-res="${i}"><b>${hl(p.name, q)}</b><small>${esc(p.kind)}${p.near ? ` · ${esc(p.near)} 근처` : ""}</small>${kmCell(p)}</button>`;
  }).join("") : `<div class="empty-state"><b>‘${esc(q.trim())}’에 맞는 곳이 없어요</b><p>역·동네 이름으로 찾거나, 아래 공개 검색으로 더 찾아볼 수 있어요.</p><button class="btn btn-ghost" data-map-pick>지도에서 직접 고르기</button></div>`;
  $("search-list").insertAdjacentHTML("beforeend",`<button class="btn btn-secondary" id="external-search">공개 지도에서 더 찾아보기</button><p class="note">누르면 검색어를 Photon에 보내요. 현재 GPS 위치는 보내지 않아요.</p>`);
}
function choosePlace(p) {
  $("result-location").hidden = true;
  const place = { name: p.name, sub: p.kind && p.kind !== "역" ? p.kind : "", ll: p.ll, kind: p.kind };
  if (!p.me) {
    const recent = store.get("recent", []).filter(r => r.name !== p.name);
    store.set("recent", [{ name: p.name, kind: p.kind, ll: p.ll }, ...recent].slice(0, 6));
  }
  if (state.pick === "from") state.from = p.me ? p : place; else state.to = place;
  state.mode = "actual"; state.routes = null; state.tripKey = null; state.fixedRoute = null;
  state.dep = 0; state.focus = "jjuk";
  resetHomeSheet();
  // 도착지를 먼저 골랐고 출발지가 없으면: 내 위치를 이미 알거나 위치 권한이 이미 허용돼 있으면 내 위치에서 바로 출발(네이버·카카오지도처럼).
  // 권한을 아직 묻지 않았으면 출발지 화면에서 '내 위치'를 맨 위에 두고 사용자가 고르게 한다(앱을 열자마자 권한을 묻지 않는다).
  if (state.pick === "to" && !state.from) {
    if (gpsFresh()) { state.from = { name: "내 위치", sub: "GPS", ll: [...gpsFix.ll], me: true }; go("result"); return; }
    state.pick = "from"; $("sq").value = "";
    if (state.geoGranted) { state.autoLocate = true; go("search"); return; }
    go("search"); return;
  }
  go("result");
}

async function exampleTrip(ex) {
  $("result-location").hidden = true;
  const list = await ensureSearch();
  const find = n => list.find(p => p.name === n) || list.find(p => p.name.startsWith(n));
  const a = find(ex.from), b = find(ex.to);
  if (!a || !b) return;
  state.from = { name: a.name, sub: "", ll: a.ll, kind: a.kind };
  state.to = { name: b.name, sub: b.kind === "역" ? "" : b.kind, ll: b.ll, kind: b.kind };
  state.mode = "example"; BASE = 31200; state.routes = null; state.tripKey = null; state.fixedRoute = null;
  state.dep = 0; state.focus = "jjuk";
  go("result");
}

// ---------- 화면 전환 ----------
const SCREENS = ["splash", "home", "search", "result", "detail", "walk", "done", "onboarding", "settings"];
const MAP_SCREENS = ["home", "result", "walk"];
let splashTimer = null, booted = false;
function show(name) {
  if (["me","signal","depart"].includes(name)) name = name === "me" ? "settings" : state.sims ? "detail" : "home";
  if (!SCREENS.includes(name)) name = "home";
  if (!booted && name !== "splash") { pendingScreen = name; name = "splash"; }
  if (name === "signal" || name === "depart") name = state.sims ? "detail" : "home";
  if (booted && name === "me") name = "settings";
  if (booted && !readProfile().onboarded && !["splash","onboarding"].includes(name)) { onboardingTarget=name; name="onboarding"; }
  const prevScreen = current; current = name;
  SCREENS.forEach(n => { $("s-" + n).hidden = n !== name; });
  if (map) XW.sync();
  if (typeof LIVE !== "undefined" && map) LIVE.sync();
  $("badge").hidden = true;  // 예시 표시는 숫자 옆(카드·신호 상세·공유 카드)에만 둔다
  $("mapctl").hidden = !MAP_SCREENS.includes(name); $("map-attrib").hidden = !MAP_SCREENS.includes(name);
  $("phone").style.setProperty("--sheet-h", (MAP_SCREENS.includes(name) && sheets[name] ? sheets[name].h : 0) + "px");
  clearTimeout(splashTimer);
  gpsRequest++;
  // 걷기 중 잠깐 보는 화면(횡단 목록·설정)으로 가면 위치만 멈추고 기록은 남겨 둔다. 돌아오면 같은 걷기를 잇는다.
  const peek = ["detail", "settings"].includes(name) && !!walkTrack;
  if (name !== "walk") { cancelAnimationFrame(walkTimer); stopGPS(); if (!peek) endWalk(); }
  gpsStatus("");
  if (name === "home") renderHome();
  if (name === "search") {
    renderSearchList();
    // 위치 권한이 이미 있으면 출발지 화면에서 바로 내 위치를 찾는다(키보드는 띄우지 않는다)
    if (state.autoLocate) { state.autoLocate = false; locate(true); } else setTimeout(() => $("sq").focus(), 50);
  }
  if (name === "result") renderResult();
  if (name === "detail") { state.detailReturn = prevScreen === "walk" ? "walk" : "result"; renderDetail(); }
  if (name === "walk") renderWalk(false, !!walkTrack);
  if (name === "done") renderDone();
  if (name === "onboarding") renderOnboarding();
  if (name === "settings") renderSettings();
}
let pendingScreen = null, clearTimer = null;
function go(name) { if (location.hash === "#" + name) show(name); else location.hash = name; }
document.addEventListener("click", e => {
  const t = e.target;
  const sg = t.closest("[data-sig]");
  if (sg) { state.sig = sg.dataset.sig; go("signal"); return; }
  if (t.closest("[data-back]")) { history.length > 1 ? history.back() : go("home"); return; }
  const dp = t.closest("[data-dep-pick]");
  if (dp) { state.dep = +dp.dataset.depPick; state.fixedRoute = state.routes[state.same ? "jjuk" : state.focus]; state.fixedFocus = state.focus; go("result"); return; }
  const sr = t.closest("[data-search]");
  if (sr) { state.pick = sr.dataset.search; $("sq").value = ""; go("search"); return; }
  const ch = t.closest("[data-chip]");
  if (ch) { const p = $("home-chips").chips[+ch.dataset.chip]; if (p.ll) { state.pick = "to"; choosePlace(p); } else exampleTrip(p); return; }
  const r = t.closest("[data-res]");
  if (r) { choosePlace($("search-list").results[+r.dataset.res]); return; }
  const rr = t.closest("[data-res-recent]");
  if (rr) { choosePlace(store.get("recent", [])[+rr.dataset.resRecent]); return; }
  if (t.closest("[data-res-me],[data-locate]")) { locate(true); return; }
  if (t.closest("[data-reroute]")) { rerouteFromGPS(); return; }
  if (t.closest("[data-route-retry]")) { state.routes = null; state.error = null; state.tripKey = null; state.fixedRoute = null; renderResult(); return; }
  if (t.closest("[data-gps-retry]")) { renderWalk(false, true); return; }
  if (t.closest("#start-walk")) {
    state.freeWalk = false;
    const route = state.same || state.focus === "short" ? "fast" : "jjukgo";
    logEvent("selected_route", { trip: state.tripId, route, alternative_available: !!state.routes?.alt });
    state.walkLogPending = route;
    go("walk"); return;
  }

  if (t.closest("#walk-end")) { go("result"); return; }
  if (t.closest("#walk-done")) { endWalk(); go("done"); return; }
  if (t.closest("[data-walk-demo]") && DEMO_MODE) { renderWalk(true); return; }
  const budget = t.closest("[data-budget]");
  if (budget) { state.budget = +budget.dataset.budget; renderResult(); return; }
  const rs = t.closest("[data-res-sugg]");
  if (rs) { $("sq").value = rs.dataset.resSugg; renderSearchList(); return; }
  if (t.closest("#hp-to")) { state.pick = "to"; choosePlace({ ...state.picked }); return; }
  if (t.closest("#hp-from")) { state.pick = "from"; choosePlace({ ...state.picked }); return; }
  if (t.closest("[data-trip='demo']")) { state.from = DEMO_FROM; state.to = DEMO_TO; state.mode = "example"; BASE = 31200; state.routes = null; state.tripKey = null; state.fixedRoute = null; state.dep = 0; go("result"); return; }
  if (t.closest("#swap")) { [state.from, state.to] = [state.to, state.from]; state.dep = 0; renderResult(); return; }
  if (t.closest("[data-search-retry]")) { renderSearchList(); return; }
  if (t.closest("[data-detail-back]")) { go(state.detailReturn || "result"); return; }   // 걷는 중에 연 횡단 목록이면 걷기로 돌아간다
  const ps = t.closest("[data-pick-switch]");
  if (ps) { state.pick = ps.dataset.pickSwitch; $("sq").value = ""; renderSearchList(); $("sq").focus(); return; }
  if (t.closest("[data-map-pick]")) { state.mapPick = state.pick; go("home"); gpsStatus(`지도를 눌러 ${state.pick === "from" ? "출발지" : "도착지"}를 골라 주세요`); return; }
  if (t.closest("[data-pick-again]")) { state.pick = t.closest("[data-pick-again]").dataset.pickAgain; $("sq").value = ""; go("search"); return; }
  if (t.closest("#sq-clear")) { $("sq").value = ""; renderSearchList(); $("sq").focus(); return; }
  const du = t.closest("[data-dep-use]");
  // 같은 길에서 출발 시각만 바꾼다(길을 다시 찾지 않음)
  if (du) { state.dep = +du.dataset.depUse; if (state.routes) state.routes.dep = state.dep; renderResult(); return; }
  const b = t.closest("[data-go],[data-dep],[data-route]");
  if (!b) return;
  if (b.dataset.dep !== undefined) { state.dep = +b.dataset.dep; renderResult(); return; }
  if (b.dataset.route) { state.focus = b.dataset.route; renderResult(); return; }
  go(b.dataset.go);
});
$("sq").addEventListener("input", () => renderSearchList());
$("xw-speed").addEventListener("input", e => XW.setSpeed(Number(e.target.value) / 3.6));
$("sq").addEventListener("keydown", e => { if (e.key === "Enter") { const r = $("search-list").results; if (r && r.length && $("sq").value.trim()) choosePlace(r[0]); } });
addEventListener("hashchange", () => show(location.hash.slice(1)));
addEventListener("resize", () => { for (const n of Object.keys(sheets)) setSheet(n); });

async function boot() {
  const splashStarted=Date.now();
  show("splash");
  try {
    [IDX, SIGS, GMETA, TERRAIN, REAL] = await Promise.all([getJSON("tiles/index.json"), getJSON("signals.json"), getJSON("graph/index.json"), getJSON("terrain.json").catch(() => null), loadSignalPlans((h => [h, (h + 1) % 24, 8, 9, 10])(Math.floor(kstSec() / 3600))).catch(() => ({signals:{},date:null,source_dates:[]}))]);
  } catch (err) {
    $("splash-foot").textContent = "지도 데이터를 못 불러왔어요. 새로고침해 주세요.";
    console.error(err);
    return;
  }
  for (const [id, x, y, name, cits, col] of SIGS) {
    SIGMETA.set(id, { name, cits, ll: fromQ(x, y) });
  }
  ["home", "result", "walk"].forEach(n => { sheets[n] = { pos: "mid", h: 0 }; initSheet(n); });
  state.deadline = null; state.budget = readProfile().budgetSeconds;
  applyPace();
  XW.v = Math.min(1.7, Math.max(0.35, SPEED)); XW.paint();
  XW.load().catch(err => console.warn("횡단 시간 지도 자료를 못 불러왔어요", err));
  booted = true;
  if (typeof LIVE !== "undefined") LIVE.init();
  if (typeof SIG !== "undefined") SIG.start();   // 지도 신호 아이콘 1초마다 갱신(패턴 예상)
  // 위치 권한이 이미 허용돼 있으면 묻지 않고 내 위치를 지도에 표시하고 출발지로 쓴다. 허용 전에는 앱을 열자마자 묻지 않는다.
  try {
    navigator.permissions?.query({ name: "geolocation" }).then(st => {
      const sync = () => { state.geoGranted = st.state === "granted"; if (state.geoGranted && current === "home" && !gpsFix) locate(false); };
      sync(); st.onchange = sync;
    }).catch(() => {});
  } catch {}
  $("splash-foot").textContent = "서울 걷기 · 공식 신호 이력 기반 비교";
  // 링크로 길을 바로 열기: ?from=위도,경도&to=위도,경도&fn=출발 이름&tn=도착 이름 (수동 QA·공유용)
  const qs = new URLSearchParams(location.search), pt = v => { const [la, lo] = (v || "").split(",").map(Number); return Number.isFinite(la) && Number.isFinite(lo) && la > 37.3 && la < 37.8 && lo > 126.6 && lo < 127.3 ? [lo, la] : null; };
  const qf = pt(qs.get("from")), qt = pt(qs.get("to"));
  if (qf && qt) {
    state.from = { name: qs.get("fn") || "출발", sub: "", ll: qf }; state.to = { name: qs.get("tn") || "도착", sub: "", ll: qt };
    state.mode = "actual"; state.routes = null; state.tripKey = null; state.dep = 0; state.focus = "jjuk"; pendingScreen = "result";
  }
  const target = pendingScreen || location.hash.slice(1);
  pendingScreen = target && target !== "splash" ? target : "home";
  // 시작 로고는 첫 방문에만 3.2초 보여 준다. 다시 열 때는 자료가 준비되면 바로 넘어간다.
  const seen = store.get("seenSplash", false); store.set("seenSplash", true);
  splashTimer=setTimeout(()=>go(pendingScreen),seen?0:Math.max(0,3200-(Date.now()-splashStarted)));
}
/*ASPHALT_UI*/
boot();
