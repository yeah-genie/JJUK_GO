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
  return dir ? band.legs[dir] || null : Object.values(band.legs)[0] || null;
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
    for (const [a, b, len, cls, geom, sig, dir, half] of c.e) {
      const key = a + ":" + b + ":" + len;
      if (G.seen.has(key)) continue;
      G.seen.add(key);
      // sig: 이 횡단보도의 신호(큰길을 건널 때만), dir: 건너는 다리 방향, half: 일방통행 차로 하나만 건넘
      const e = { a, b, len, cls, geom: geom || null, sig: sig || null, dir: dir || null, half: !!half };
      if (!G.adj.has(a)) G.adj.set(a, []);
      if (!G.adj.has(b)) G.adj.set(b, []);
      G.adj.get(a).push(e); G.adj.get(b).push(e);
    }
  }).catch(err => { G.cells.delete(k); throw err; }));
  return G.cells.get(k);
}
let snapNodeId = -1;
function snap(ll) {
  let nearest = null, best = Infinity;
  const seen = new Set();
  for (const edges of G.adj.values()) for (const edge of edges) {
    if (seen.has(edge) || edge.cls > 2 || edge.sig || !G.node.has(edge.a) || !G.node.has(edge.b)) continue;
    seen.add(edge);
    const pts = edgePts(edge, edge.a).map(p => fromQ(...p));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distLL(pts[i - 1], pts[i]));
    const projection = projectOnRoute({coords:pts,cum}, ll);
    if (projection.offset < best) { best = projection.offset; nearest = {edge,pts,cum,projection}; }
  }
  if (!nearest || best > 35) return {id:null,d:best};
  const {edge,pts,cum,projection} = nearest;
  const at = projection.distance, length = cum[cum.length - 1];
  if (at < 1) return {id:edge.a,d:distLL(ll,pts[0])};
  if (length - at < 1) return {id:edge.b,d:distLL(ll,pts[pts.length - 1])};
  const point = pointAt({coords:pts,cum}, at), q = toQ(point);
  const id = snapNodeId--;
  G.node.set(id,{x:q[0],y:q[1],s:null,h:terrainHeight(...point)});
  const split = cum.findIndex(d => d >= at), qs = pts.map(toQ);
  const encode = points => points.slice(1,-1).flatMap((p,i)=>[p[0]-points[i][0],p[1]-points[i][1]]);
  const parts = [{...edge,b:id,len:edge.len*at/length,geom:encode([...qs.slice(0,split),q])}, {...edge,a:id,len:edge.len*(length-at)/length,geom:encode([q,...qs.slice(split)])}];
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
  const push = (s, dir, d, at) => { if (!x.some(z => z.s === s && d - z.d < 60)) x.push({ s, dir, d, at }); };
  for (const [u, v, e] of steps) {
    if (e.cls === 3) { if (!lastStairs) { stairs++; guides.push({d:cum[cum.length-1],label:"계단 구간 · 발밑을 확인하세요"}); } stairMeters += e.len; }
    lastStairs = e.cls === 3;
    const up = edgeRise(e, u, v);
    if (up != null) { rise += up; terrainMeters += e.len; }
    const start = cum[cum.length - 1], startAt = coords[coords.length - 1];
    const pts = edgePts(e, u);
    for (let i = 1; i < pts.length; i++) add(fromQ(...pts[i]), e.cls === 4);
    const nu = G.node.get(u), nv = G.node.get(v);
    if (e.sig) push(e.sig, e.dir, start, startAt);
    else if (nv.s && nv.s !== nu.s) push(nv.s, null, cum[cum.length - 1], coords[coords.length - 1]);
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
      { id: "route-short", type: "line", source: "rs", layout: { "line-cap": "round", "line-join": "round" }, filter: ["!", ["has", "u"]], paint: { "line-color": "#6E7889", "line-width": W([[12, 3], [18, 7]]), "line-dasharray": [.6, 1.6] } },
      { id: "route-jjuk-case", type: "line", source: "rj", filter: ["!", ["has", "u"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2A3140", "line-opacity": .55, "line-width": W([[12, 7], [18, 14]]) } },
      { id: "route-jjuk", type: "line", source: "rj", filter: ["!", ["has", "u"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#F6C343", "line-width": W([[12, 4.5], [18, 9]]) } },
      { id: "route-jjuk-under", type: "line", source: "rj", filter: ["has", "u"], paint: { "line-color": "#2A3140", "line-width": W([[12, 1.5], [18, 3]]), "line-dasharray": [1, 1.5] } },
      // 신호 교차로: 가까이서만 표시. 노란 테두리 = 패턴 수집 중
      { id: "sig-all", type: "circle", source: "sigall", minzoom: 15, paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, ["case", ["==", ["get", "k"], 1], 5, 3], 18, ["case", ["==", ["get", "k"], 1], 9, 6]],
        "circle-color": ["case", ["==", ["get", "k"], 1], "#2A3140", ["==", ["get", "c"], 1], "#59617A", "#959CAB"],
        "circle-stroke-color": ["case", ["==", ["get", "k"], 1], "#F6C343", "#343D43"], "circle-stroke-width": ["case", ["==", ["get", "k"], 1], 2.5, 1.2] } },
      // 글자
      label("water-label", "water_polygons_labels", ["has", "name"], 13, 12, "#9EBCCA", { layout: { "text-font": FONT } }),
      label("street-label-minor", "street_labels", kinds(MIN.concat("service", "pedestrian")), 15.5, 11, "#CBD0D1", { layout: { "symbol-placement": "line", "text-max-angle": 30 } }),
      label("street-label-major", "street_labels", kinds(MAJ.concat(HW)), 12, ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 13.5], "#E4E5DE", { layout: { "symbol-placement": "line", "text-max-angle": 30 } }),
      label("poi", "pois", ["has", "name"], 16.5, 10.5, "#C9CBC5", { layout: { "symbol-sort-key": 10 } }),
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
  map = new maplibregl.Map({ container: mapEl, style: mapStyle(), center: ME.ll, zoom: 16, attributionControl: false,
    localIdeographFontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'Noto Sans CJK KR', sans-serif",
    pitchWithRotate: false, maxBounds: [[126.62, 37.38], [127.27, 37.70]], minZoom: 10, maxZoom: 19 });
  map.once("load", () => { mapReady = true; });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 70, unit: "metric" }), "bottom-right");
  map.on("rotate", () => { $("ctl-north").hidden = Math.abs(map.getBearing()) < 1; });
  map.on("click", onMapClick);
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
  const pad = { top: bounded ? 36 : 90, bottom: sidePanel ? 40 : bounded ? 30 : sheetH() + 30, left: 34, right: sidePanel ? panel.width + 48 : 64, ...extra };
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
async function computeTrip() {
  const request = ++tripRequest;
  const key = tripKeyNow();
  if (state.tripKey === key && state.routes) { refreshSims(); return; }
  state.tripKey = key; state.routes = null; state.error = null;
  const d = distLL(state.from.ll, state.to.ll);
  if (d > 30000) { state.error = {title:"걷기 범위를 나눠 주세요",text:"직선30km를 넘는 구간은 중간 지점을 골라 나눠서 찾아 주세요."}; return; }
  if (d < 30) { state.error = { title: "출발지와 도착지가 거의 같아요", text: "다른 곳을 골라 주세요." }; return; }
  const cells = cellsFor(state.from.ll, state.to.ll, Math.max(700, d * 0.25));
  if (cells.some(k => !G.cells.has(k))) setStatus("길 찾는 중…", `지도 조각 ${cells.length}개를 받고 있어요${d > 5000 ? " (먼 길이라 조금 걸려요)" : ""}.`);
  try {
    const firstHour = Math.floor(BASE / 3600), horizon = Math.min(23, Math.ceil(d * 2 / SPEED / 3600) + 1);
    const hours = Array.from({length:horizon + 1}, (_, i) => firstHour + i);
    const [, plans] = await Promise.all([Promise.all(cells.map(loadCell)), loadSignalPlans(hours).catch(() => ({signals:{},source_dates:[],date:null}))]);
    if (request !== tripRequest || key !== tripKeyNow()) return;
    REAL = plans;
  } catch (err) {
    if (request !== tripRequest || key !== tripKeyNow()) return;
    state.error = {title:"지도 연결이 끊겼어요",text:"연결을 확인하고 아래에서 다시 시도해 주세요."};
    return;
  }
  const a = snap(state.from.ll), b = snap(state.to.ll);
  if (a.id == null || b.id == null || a.d > 35 || b.d > 35) { state.error = { title: "출입구 가까이에서 골라 주세요", text: "보행로와 35m 넘게 떨어져 있어 임의로 연결하지 않았어요. 지도의 실제 출입구나 보행로를 출발·도착으로 선택해 주세요." }; return; }
  state.src = a.id; state.dst = b.id;
  const t0 = performance.now();
  const short = routeFor("short", state.dep), jjuk = routeFor("jjuk", state.dep);
  state.lastRouteMs = performance.now() - t0;
  if (!short || !jjuk) { state.error = { title: "길을 못 찾았어요", text: readProfile().avoidSteps ? "확인된 계단을 제외한 연결 경로를 찾지 못했어요. 이동 조건이나 출입구를 확인해 주세요." : "보행 도로망에서 두 곳의 연결을 찾지 못했어요. 다른 출입구를 골라 주세요." }; return; }
  state.routes = { short, jjuk, dep: state.dep, budget: null };
  refreshSims();
}
function refreshSims() {
  if (!state.routes) { state.sims = null; return; }
  if (state.fixedRoute) { state.routes[state.fixedFocus] = state.fixedRoute; state.routes.dep = state.dep; state.routes.budget = state.budget; state.fixedRoute = null; }
  // 출발 시각이 바뀌면 신호 위상이 달라지므로 두 길을 다시 찾는다
  if (state.routes.dep !== state.dep || state.routes.budget !== state.budget) {
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
function gpsError(err) {
  gpsPending = false;
  gpsStatus(err.code === 1 ? "위치를 연결하지 못했어요. 위치 권한이 꺼져 있어요. 다시 시도하거나 지도에서 출발지를 골라 주세요" : err.code === 3 ? "위치를 연결하지 못했어요. 연결이 늦어져요. 다시 시도하거나 지도에서 출발지를 골라 주세요" : err.message || "위치를 연결하지 못했어요. 다시 시도하거나 지도에서 출발지를 골라 주세요");
}
function locate(useAsStart) {
  if (!navigator.geolocation || !window.isSecureContext) { gpsStatus("위치 연결은 HTTPS에서 사용할 수 있어요. 지도에서 출발지를 골라 주세요"); return; }
  const request = ++gpsRequest, screen = current;
  gpsPending = true; gpsStatus("내 위치를 찾고 있어요…");
  navigator.geolocation.getCurrentPosition(p => {
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
      }
    } catch (err) { gpsError(err); }
  }, err => { if (request === gpsRequest && current === screen) gpsError(err); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
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
  if (document.hidden) { stopGPS(); if (current === "walk") gpsStatus("위치가 끊겨 측정을 잠시 멈췄어요. 화면으로 돌아와 다시 연결해 주세요"); }
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
const SAY_FIRST = "실시간 신호는 제공하지 않아요. 건널 때 실제 신호를 확인하세요.", SAY_AFTER = "실시간 신호 정보 없음";
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
  if (free) setRoutes(null, null); else { setRoutes(route, null); markTrip({ [k]: sim }, k, false); }
  setSheet("walk", "mid");
  if (route) fit([route.coords], { top: 170 });
  $("walk-end").hidden = free;
  $("walk-done").textContent = "걷기 끝내기";
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
    setPeek("walk", `<span>${demo ? "움직임 시연" : "GPS 걷기"} · 남은 ${$("w-left").textContent}</span><small>${eta}</small>`);
    const next = dist == null ? null : routeGuidance(route, dist);
    if (next) {
      setText("next-label", "다음 안내"); setText("next-dist", Math.round(next.d - dist) + "m"); setText("next-state", next.label);
      $("next-state").hidden = false; $("w-left-col").hidden = false;
    } else {   // 알 수 없는 방향 안내는 만들지 않는다. 남은 거리만 위에 크게 보여 준다
      setText("next-label", "남은 거리"); setText("next-dist", left == null ? "위치 연결" : km(left)); setText("next-state", "");
      $("next-state").hidden = true; $("w-left-col").hidden = true;
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
  gpsWatch = navigator.geolocation.watchPosition(p => {
    if (current !== "walk" || session !== gpsRequest) return;
    try {
      gpsFix = readFix(p, 50); lastFix = gpsFix.timestamp;
      if (walkTrack) trackAdd(walkTrack, gpsFix);
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
      if (arrivalFixes>=2) { gpsStatus("도착지 근처예요. 걷기를 끝내면 기록을 볼 수 있어요"); return; }
      gpsStatus(gpsOk(gpsFix));
    } catch (err) { update(null); gpsError(err); }
  }, err => { if (current === "walk" && session === gpsRequest) { update(null); gpsError(err); } }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  gpsStaleTimer = setInterval(() => {
    if (lastFix && Date.now() - lastFix > 30000) { $("walk-reroute").hidden = true; update(null); gpsStatus("위치가 끊겨 측정을 잠시 멈췄어요. 30초 넘게 갱신이 없어요. 다시 연결해 주세요"); }
  }, 5000);
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
  if (!SEARCH) SEARCH = getJSON("search.json").then(rows => rows.map(([name, x, y, kind], i) => ({ name, kind, ll: fromQ(x, y), n: norm(name), r: i })));
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
async function renderSearchList() {
  const q = $("sq").value, seq = ++searchSeq, origin = (state.pick === "from" ? state.to?.ll : state.from?.ll) || ME.ll;
  $("sq-clear").hidden = !q;
  $("search-for").textContent = state.pick === "from" ? "출발지를 골라요" : (state.from ? `도착지를 골라요 · 거리는 ${state.from.me ? "내 위치(GPS)" : state.from.name}에서 직선` : "도착지를 고른 다음 출발지를 확인해요");
  if (!q.trim()) {
    const recent = store.get("recent", []);
    const sugg = ["강남역", "시청역", "홍대입구역", "잠실역", "여의도역", "성수동 카페"];
    let h = "";
    if (state.pick === "from") h += `<button class="res-item" data-res-me><b>내 위치</b><small>GPS로 현재 위치 연결</small></button>`;
    if (recent.length) h += `<p class="sec-title">최근</p>` + recent.map((p, i) => `<button class="res-item" data-res-recent="${i}"><b>${esc(p.name)}</b><small>${esc(p.kind || "")}</small><span class="km">${km(distLL(p.ll, origin))}</span></button>`).join("");
    h += `<p class="sec-title">이렇게 찾아보세요</p>` + sugg.map(s => `<button class="res-item" data-res-sugg="${esc(s)}"><b>${esc(s)}</b><small>${s.includes(" ") ? "동네 + 종류로 근처 찾기" : "역 이름"}</small></button>`).join("");
    h += `<p class="note">지도를 직접 눌러 도착지를 고를 수도 있어요. 검색 목록: OpenStreetMap에 이름이 있는 역·동네·대학·병원·명소·카페 등 약 1.7만 곳.</p>`;
    $("search-list").innerHTML = h;
    return;
  }
  $("search-list").innerHTML = `<p class="note">찾는 중…</p>`;
  const res = await runSearch(q);
  if (seq !== searchSeq) return;
  $("search-list").results = res;
  $("search-list").innerHTML = res.length ? res.map((p, i) => {
    const d = distLL(p.ll, origin);
    return `<button class="res-item" data-res="${i}"><b>${hl(p.name, q)}</b><small>${esc(p.kind)}${p.near ? ` · ${esc(p.near)} 근처` : ""}</small><span class="km">${km(d)}</span></button>`;
  }).join("") : `<p class="note">"${esc(q)}"에 맞는 곳이 없어요. 역 이름이나 동네 이름으로 찾아보거나, 지도를 눌러 골라 주세요.</p>`;
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
  current = name;
  SCREENS.forEach(n => { $("s-" + n).hidden = n !== name; });
  $("badge").hidden = true;  // 예시 표시는 숫자 옆(카드·신호 상세·공유 카드)에만 둔다
  $("mapctl").hidden = !MAP_SCREENS.includes(name); $("map-attrib").hidden = !MAP_SCREENS.includes(name);
  $("phone").style.setProperty("--sheet-h", (MAP_SCREENS.includes(name) && sheets[name] ? sheets[name].h : 0) + "px");
  clearTimeout(splashTimer);
  if (name === "splash" && booted) splashTimer = setTimeout(() => go("home"), 1600);
  gpsRequest++;
  if (name !== "walk") { cancelAnimationFrame(walkTimer); stopGPS(); endWalk(); }
  gpsStatus("");
  if (name === "home") renderHome();
  if (name === "search") { renderSearchList(); setTimeout(() => $("sq").focus(), 50); }
  if (name === "result") renderResult();
  if (name === "detail") renderDetail();
  if (name === "walk") renderWalk();
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
  if (t.closest("#start-walk")) { state.freeWalk = false; go("walk"); return; }

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
$("sq").addEventListener("keydown", e => { if (e.key === "Enter") { const r = $("search-list").results; if (r && r.length && $("sq").value.trim()) choosePlace(r[0]); } });
addEventListener("hashchange", () => show(location.hash.slice(1)));
addEventListener("resize", () => { for (const n of Object.keys(sheets)) setSheet(n); });

async function boot() {
  show("splash");
  try {
    [IDX, SIGS, GMETA, TERRAIN, REAL] = await Promise.all([getJSON("tiles/index.json"), getJSON("signals.json"), getJSON("graph/index.json"), getJSON("terrain.json").catch(() => null), loadSignalPlans().catch(() => ({signals:{},date:null,source_dates:[]}))]);
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
  booted = true;
  $("splash-foot").textContent = "서울 걷기 · 공식 신호 이력 기반 비교";
  const target = pendingScreen || location.hash.slice(1);
  if (target && target !== "splash") go(target); else go("home");
}
/*ASPHALT_UI*/
boot();
