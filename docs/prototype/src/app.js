// 쭉고 프로토타입. 지도·보행 그래프·검색 데이터는 서울 OpenStreetMap 추출본(© OpenStreetMap contributors, ODbL)에서
// scripts/build_seoul_map.py가 만들어 seoul/ 아래에 둔다. 신호 위치는 서울 C-ITS 교차로 + OSM 신호 표시.
const $ = id => document.getElementById(id);
const DATA = new URL("seoul/", document.baseURI).href;
const SPEED = 1.2, BASE = 8 * 3600 + 40 * 60;      // 걷는 속도 m/s, 기준 출발 08:40
const UNKNOWN_SIG_COST = 45;                        // 패턴을 모르는 신호를 지날 때 쭉고가 치는 비용(초): 평균 대기 근사
const SLOW_OK = 30;                                 // 쭉고가 최단 시간보다 늦게 도착해도 되는 한계(초)
const STOP_COST = 15;                               // 멈춤 한 번에 더하는 비용(초): 같은 대기라도 덜 멈추는 길을 고른다
// '내 위치'는 아직 GPS를 쓰지 않는 예시 위치다. 신호 패턴을 아는 광화문 일대(서울광장)에 둔다.
const ME = { name: "내 위치", sub: "예시: 서울광장", ll: [126.97799, 37.56562], me: true };
const DEMO_FROM = { name: "서대문역", sub: "", ll: [126.96664, 37.5658] };
const DEMO_TO = { name: "청계광장", sub: "명소", ll: [126.9776, 37.56922] };
// 예시 길. 앞의 둘은 패턴을 아는 신호를 지나는 길(광화문 일대), 뒤는 서울 다른 동네(신호 개수만 비교)
const EXAMPLES = [{ from: "서대문역", to: "청계광장" }, { from: "독립문역", to: "서울광장" }, { from: "시청역", to: "경복궁" }, { from: "홍대입구역", to: "연남동" }, { from: "잠실역", to: "석촌호수" }];
const DEADLINE_KEY = "deadline";
let IDX = null, SIGS = null, GMETA = null, SEARCH = null;
const SIGMETA = new Map();

async function getJSON(p) { const r = await fetch(DATA + p); if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }
const store = {
  get(k, d) { try { const v = localStorage.getItem("jjukgo:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("jjukgo:" + k, JSON.stringify(v)); } catch {} },
};

// ---------- 좌표 ----------
const Q = 1e5, LON0 = 126.58, LAT0 = 37.35;
const fromQ = (x, y) => [LON0 + x / Q, LAT0 + y / Q];
const toQ = ([lon, lat]) => [(lon - LON0) * Q, (lat - LAT0) * Q];
const KXQ = 111320 * Math.cos(37.55 * Math.PI / 180) / Q, KYQ = 110540 / Q;
function distLL(a, b) { const kx = 111320 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180); return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110540); }
const km = m => m < 1000 ? Math.round(m / 10) * 10 + "m" : (m / 1000).toFixed(1) + "km";

// ---------- 신호 ----------
// 수집 데이터로 찾은 실제 신호 패턴(scripts/export_signal_plans.py가 확신 기준을 넘은 곳만 채운다). 여기 없는 신호는 '모름'이다(예시 값을 쓰지 않는다).
const REAL = /*REAL_SIGNALS*/{"day0": 1793113200.0, "date": "2026-10-28", "signals": {"2691": {"dir": "wt", "c": 140.01, "ref": 1793116819.232, "win": [[56.0, 89.0], [138.0, 140.0], [0.0, 31.0]], "day0": 1793113200.0, "impurity": 0.0006, "observed_min": 156.3, "from": "10/28 01:00", "to": "10/28 03:36", "legs": {"e": {"c": 140.01, "ref": 1793116819.232, "win": [[56.0, 84.0], [138.0, 140.0], [0.0, 26.0]], "code": "et"}, "w": {"c": 140.01, "ref": 1793116819.232, "win": [[56.0, 89.0], [138.0, 140.0], [0.0, 31.0]], "code": "wt"}}}, "1619": {"dir": "nw", "c": 140.015, "ref": 1793116819.086, "win": [[90.0, 133.0]], "day0": 1793113200.0, "impurity": 0.0008, "observed_min": 156.4, "from": "10/28 01:00", "to": "10/28 03:36", "legs": {"n": {"c": 140.015, "ref": 1793116819.086, "win": [[90.0, 133.0]], "code": "nw"}, "w": {"c": 140.015, "ref": 1793116819.086, "win": [[90.0, 133.0]], "code": "nw"}}}, "1537": {"dir": "nw", "c": 140.03, "ref": 1793124000.648, "win": [[51.0, 94.0]], "day0": 1793113200.0, "impurity": 0.0011, "observed_min": 36.6, "from": "10/28 03:00", "to": "10/28 03:36", "legs": {"n": {"c": 140.03, "ref": 1793124000.648, "win": [[10.0, 46.0], [102.0, 138.0]], "code": "ne"}, "e": {"c": 140.03, "ref": 1793124000.648, "win": [[10.0, 46.0], [102.0, 138.0]], "code": "ne"}, "w": {"c": 140.03, "ref": 1793124000.648, "win": [[51.0, 94.0]], "code": "nw"}, "s": {"c": 140.03, "ref": 1793124000.648, "win": [[51.0, 94.0]], "code": "se"}}}, "2910": {"dir": "st", "c": 130.045, "ref": 1793160022.657, "win": [[34.0, 66.0]], "day0": 1793113200.0, "impurity": 0.0006, "observed_min": 24.3, "from": "10/28 13:00", "to": "10/28 13:24", "legs": {"e": {"c": 130.035, "ref": 1793160022.657, "win": [[106.0, 130.0], [0.0, 6.0]], "code": "et"}, "s": {"c": 130.045, "ref": 1793160022.657, "win": [[34.0, 66.0]], "code": "st"}}}}}/*END_REAL*/;
const known = id => !!REAL.signals[id];
const MIN_GREEN = 8;  // 초록이 이보다 적게 남았으면 건너기 시작하지 않고 다음 초록을 기다리는 것으로 본다(서두르게 하지 않는다)
// 도착 시각 t(자정 기준 초)의 신호 상태: 초록이면 {g: true, rem: 남은 초}, 빨강이면 {g: false, wait: 다음 초록까지 초}
// dir: 건너는 다리(n/e/s/w). 그 다리의 보행신호 패턴이 있으면 쓰고, 없으면 교차로 기본 패턴을 쓴다.
function sigState(id, t, dir) {
  const base = REAL.signals[id], r = (dir && base.legs && base.legs[dir]) || base;
  const ph = ((((base.day0 ?? REAL.day0) + t - r.ref) % r.c) + r.c) % r.c;
  let wait = Infinity;
  for (const [a, b] of r.win) {
    for (const shift of [0, r.c]) { if (ph + shift >= a && ph + shift < b) return { g: true, rem: b - ph - shift }; }
    wait = Math.min(wait, ((a - ph) % r.c + r.c) % r.c);
  }
  return { g: false, wait: wait === Infinity ? 0 : wait };
}
// 건너기 전에 기다려야 하는 초. 초록이 곧 끝날 때(MIN_GREEN 미만)는 놓친 것으로 보고 다음 초록까지 센다.
function sigWait(id, t, dir) {
  const s = sigState(id, t, dir);
  if (!s.g) return s.wait;
  if (s.rem >= MIN_GREEN) return 0;
  return s.rem + sigState(id, t + s.rem + 0.5, dir).wait;
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
    for (const [id, x, y, s] of c.n) G.node.set(id, { x, y, s: s ?? null });
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
  }));
  return G.cells.get(k);
}
function snap(ll) {
  const [X, Y] = toQ(ll); let best = null, bd = Infinity, road = null, rd = Infinity;
  // 출발·도착은 지상 길에만 붙인다(역 좌표가 지하 통로 위에 있으면 이상하게 돌아간다)
  for (const [id, n] of G.node) {
    const es = G.adj.get(id);
    if (!es || !es.some(e => e.cls <= 2)) continue;  // 계단(3)·지하(4)만 이어진 점은 빼고
    const d = Math.hypot((n.x - X) * KXQ, (n.y - Y) * KYQ);
    if (d < bd) { bd = d; best = id; }
    if (d < rd && es.some(e => e.cls <= 1)) { rd = d; road = id; }
  }
  // 보행로만 이어진 점(광장·역 둘레)은 지하 통로로만 이어진 경우가 있어, 60m 안에 도로가 있으면 도로에 붙인다
  return rd <= 60 ? { id: road, d: rd } : { id: best, d: bd };
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
  const cost = new Map([[src, 0]]), time = new Map([[src, 0]]), prev = new Map(), done = new Set(), h = new Heap();
  h.push(hEst(G.node.get(src)), src);
  while (h.size) {
    const u = h.pop()[1], c = cost.get(u);
    if (done.has(u)) continue;
    done.add(u);
    if (u === dst) break;
    const nu = G.node.get(u), tu = time.get(u);
    for (const e of G.adj.get(u) || []) {
      const v = e.a === u ? e.b : e.a, nv = G.node.get(v);
      if (!nv || done.has(v)) continue;
      let tv = tu + e.len / SPEED, cv = c + e.len / SPEED;
      {
        // 횡단보도 신호는 건너기 전에 기다린다. 골목 교차로 신호(노드)는 들어설 때 센다
        const s = e.sig || (nv.s && nv.s !== nu.s ? nv.s : null), share = e.sig && e.half ? 0.5 : 1;
        const stop = mode === "jjuk" ? STOP_COST * share : 0;
        if (s) {
          if (known(s)) { const w = sigWait(s, BASE + dep + (e.sig ? tu : tv), e.sig ? e.dir : null); tv += w; cv += w + (w > 2 ? stop : 0); }
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
  const add = (ll, u) => { const d = cum[cum.length - 1] + distLL(coords[coords.length - 1], ll); coords.push(ll); cum.push(d); if (u) under.push(coords.length - 1); };
  const s0 = G.node.get(src);
  add(fromQ(s0.x, s0.y));
  // 같은 신호를 60m 안에서 또 건너면(왕복 도로를 두 번에 나눠 건너기) 한 번으로 센다
  const push = (s, dir, d, at) => { if (!x.some(z => z.s === s && d - z.d < 60)) x.push({ s, dir, d, at }); };
  for (const [u, v, e] of steps) {
    const start = cum[cum.length - 1], startAt = coords[coords.length - 1];
    const pts = edgePts(e, u);
    for (let i = 1; i < pts.length; i++) add(fromQ(...pts[i]), e.cls === 4);
    const nu = G.node.get(u), nv = G.node.get(v);
    if (e.sig) push(e.sig, e.dir, start, startAt);
    else if (nv.s && nv.s !== nu.s) push(nv.s, null, cum[cum.length - 1], coords[coords.length - 1]);
  }
  add(toLL);
  return { coords, cum, length: cum[cum.length - 1], x, under, key: steps.map(s => s[2].a + "-" + s[2].b).join(",") };
}
function routeFor(mode, dep) {
  const steps = search(state.src, state.dst, mode, dep);
  return steps && buildRoute(steps, state.src, state.from.ll, state.to.ll);
}

// 경로를 따라 걸으며 신호마다 도착 시각의 신호 위상으로 대기를 계산한다. 패턴 없는 신호는 대기를 모른다(null).
function simulate(route, dep) {
  let t = BASE + dep, prev = 0;
  const segs = [], xings = [];
  for (const x of route.x) {
    const walk = (x.d - prev) / SPEED;
    segs.push({ type: "walk", s: walk }); t += walk; prev = x.d;
    if (known(x.s)) {
      const w = Math.round(sigWait(x.s, t, x.dir)), st = sigState(x.s, t, x.dir);
      // 놓치면: 초록일 때 이번 초록을 보내고 다음 초록까지 기다리는 시간
      const miss = st.g ? Math.round(st.rem + sigState(x.s, t + st.rem + 0.5, x.dir).wait) : 0;
      xings.push({ id: x.s, dir: x.dir, name: sigName(x.s, x.dir), known: true, arrive: t, wait: w, green: st.g, rem: st.g ? Math.round(st.rem) : 0, miss, d: x.d, at: x.at });
      if (w > 0) segs.push({ type: "wait", s: w });
      t += w;
    } else {
      xings.push({ id: x.s, name: sigName(x.s, x.dir), known: false, arrive: t, wait: null, d: x.d, at: x.at });
      segs.push({ type: "unk", s: 0 });
    }
  }
  const tail = (route.length - prev) / SPEED;
  segs.push({ type: "walk", s: tail }); t += tail;
  const kn = xings.filter(x => x.known), wait = kn.reduce((a, x) => a + x.wait, 0);
  return { segs, xings, wait, stops: kn.filter(x => x.wait > 2).length, knownN: kn.length, unknownN: xings.length - kn.length,
           total: t - BASE - dep, walk: route.length / SPEED, meters: Math.round(route.length) };
}

const clock = s => { s = Math.round(s); const h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60; return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"); };
const mmss = s => { s = Math.round(s); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const mins = s => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? m + "분" : Math.floor(m / 60) + "시간" + (m % 60 ? " " + (m % 60) + "분" : ""); };
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
    paint: { "text-color": color, "text-halo-color": "#FFFFFF", "text-halo-width": 1.6, ...extra.paint } });
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
      { id: "bg", type: "background", paint: { "background-color": "#F4F3EF" } },
      { id: "green", type: "fill", source: "osm", "source-layer": "land", filter: kinds(["park", "garden", "grass", "meadow", "forest", "wood", "village_green", "recreation_ground", "golf_course", "cemetery", "playground", "heath", "scrub", "allotments", "orchard", "grave_yard", "nature_reserve"]),
        paint: { "fill-color": ["match", ["get", "kind"], ["forest", "wood", "nature_reserve"], "#CFE7C3", "#DDF0D4"] } },
      { id: "sites", type: "fill", source: "osm", "source-layer": "sites", paint: { "fill-color": ["match", ["get", "kind"], ["parking"], "#ECEBE6", "#EEEBE3"] } },
      { id: "water", type: "fill", source: "osm", "source-layer": "water_polygons", paint: { "fill-color": "#AED5F2" } },
      { id: "waterline", type: "line", source: "osm", "source-layer": "water_lines", filter: ["!=", ["get", "tunnel"], true], paint: { "line-color": "#AED5F2", "line-width": W([[10, .6], [16, 4]]) } },
      { id: "cov", type: "fill", source: "cov", minzoom: 12, paint: { "fill-color": "#F6C343", "fill-opacity": .09 } },
      { id: "cov-line", type: "line", source: "cov", minzoom: 12, paint: { "line-color": "#C99A12", "line-width": 1.3, "line-dasharray": [3, 3] } },
      { id: "bld", type: "fill", source: "osm", "source-layer": "buildings", minzoom: 14, paint: { "fill-color": "#E5E2DC", "fill-outline-color": "#D3CFC7", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, .3, 15.5, 1] } },
      st("foot-case", kinds(FOOT.concat("steps")), 15, { "line-color": "#DCD8D0", "line-width": W([[15, 2], [18, 5]]) }),
      st("foot", kinds(FOOT), 15, { "line-color": "#FFFFFF", "line-width": W([[15, 1], [18, 3.5]]) }),
      st("steps", kinds(["steps"]), 15, { "line-color": "#FFFFFF", "line-width": W([[15, 1], [18, 3.5]]), "line-dasharray": [.6, .4] }, { "line-cap": "butt" }),
      st("service", kinds(["service"]), 14, { "line-color": "#FFFFFF", "line-width": W([[14, .8], [18, 6]]) }),
      st("rail", kinds(["rail", "light_rail"]), 10, { "line-color": "#BDB9B1", "line-width": W([[10, .6], [16, 2]]), "line-dasharray": [3, 2] }),
      st("minor-case", kinds(MIN), 13, { "line-color": "#D4D0C7", "line-width": W([[13, 1.6], [16, 7], [18, 17]]) }),
      st("major-case", kinds(MAJ), 9, { "line-color": "#C9C3B7", "line-width": W([[9, .9], [12, 3], [14, 6.5], [16, 14], [18, 30]]) }),
      st("hw-case", kinds(HW), 8, { "line-color": "#E3A64A", "line-width": W([[8, 1.2], [12, 3.4], [14, 7], [16, 15], [18, 32]]) }),
      st("minor", kinds(MIN), 13, { "line-color": "#FFFFFF", "line-width": W([[13, .9], [16, 5.5], [18, 15]]) }),
      st("major", kinds(MAJ), 9, { "line-color": "#FFFFFF", "line-width": W([[9, .5], [12, 2], [14, 5], [16, 12], [18, 27]]) }),
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
        "circle-stroke-color": ["case", ["==", ["get", "k"], 1], "#F6C343", "#FFFFFF"], "circle-stroke-width": ["case", ["==", ["get", "k"], 1], 2.5, 1.2] } },
      // 글자
      label("water-label", "water_polygons_labels", ["has", "name"], 13, 12, "#4B86B8", { layout: { "text-font": FONT } }),
      label("street-label-minor", "street_labels", kinds(MIN.concat("service", "pedestrian")), 15.5, 11, "#77736B", { layout: { "symbol-placement": "line", "text-max-angle": 30 } }),
      label("street-label-major", "street_labels", kinds(MAJ.concat(HW)), 12, ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 13.5], "#4F4B44", { layout: { "symbol-placement": "line", "text-max-angle": 30 } }),
      label("poi", "pois", ["has", "name"], 16.5, 10.5, "#8A8478", { layout: { "symbol-sort-key": 10 } }),
      label("place", "place_labels", kinds(["suburb", "quarter", "neighbourhood", "borough", "city", "town", "village"]), 10,
        ["match", ["get", "kind"], ["city", "borough"], 15, ["suburb", "town"], 13.5, 12], "#3D3A35", { paint: { "text-halo-width": 2 } }),
      { id: "station", type: "circle", source: "osm", "source-layer": "public_transport", minzoom: 12.5, filter: kinds(["station", "halt"]), paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.5, 3, 16, 6], "circle-color": "#2FA84F", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } },
      label("station-label", "public_transport", kinds(["station", "halt"]), 13, ["interpolate", ["linear"], ["zoom"], 13, 11, 16, 13], "#23863D",
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
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 70, unit: "metric" }), "bottom-left");
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
  const pad = { top: current === "result" ? (phoneH() < 700 ? 80 : 120) : 90, bottom: sheetH() + 30, left: 34, right: 64, ...extra };
  ready(() => map.fitBounds(b, { padding: pad, duration: 0, maxZoom: 17 }));
}
function markTrip(sims, focus) {
  clearDyn();
  addDyn(el(state.from.me ? "m-me" : "m-start", state.from.me ? "<i></i>" : ""), state.from.ll);
  addDyn(el("m-dest", `<i></i><span>${esc(state.to.name)}</span>`), state.to.ll, { anchor: "left", offset: [-11, 0] });
  if (!sims) return;
  const seen = new Set();
  for (const k of [focus, focus === "jjuk" ? "short" : "jjuk"]) {
    if (!sims[k]) continue;
    for (const x of sims[k].xings) {
      if (seen.has(x.id)) continue; seen.add(x.id);
      const cls = !x.known ? "unk" : x.wait > 2 ? "stop" : "go", label = x.known && x.wait > 2 && k === focus ? `<b>${x.wait}초</b>` : "";
      const m = el(`m-sig ${cls}${k === focus ? "" : " dim"}`, `<span>${!x.known ? "" : x.wait > 2 ? "Ⅱ" : "✓"}</span>${label}`);
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
  if (e.target.closest("#ctl-loc")) map.easeTo({ center: walker ? walker.getLngLat() : state.from.ll, zoom: Math.max(map.getZoom(), 16.5) });
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
  const d = distLL(ME.ll, p.ll);
  $("hp-sub").textContent = (p.sub ? p.sub + " · " : "") + `내 위치(서울광장 예시)에서 직선 ${km(d)}`;
  $("home-actions").innerHTML = `<button class="btn btn-ghost" id="hp-from">여기서 출발</button><button class="btn btn-primary" id="hp-to">여기까지 길찾기</button>`;
  setSheet("home", "mid");
}
function resetHomeSheet() {
  state.picked = null;
  if (pickMarker) { pickMarker.remove(); pickMarker = null; }
  $("home-intro").hidden = false; $("home-place").hidden = true;
  $("home-actions").innerHTML = `<button class="btn btn-primary" data-trip="demo">서대문역 → 청계광장 예시 보기</button>`;
}

// ---------- 끌 수 있는 아래 시트 ----------
const sheets = {};
const phoneH = () => $("phone").clientHeight;
function sheetH() { const s = sheets[current]; return s ? s.h : 0; }
function snaps(name) {
  const sh = $("sheet-" + name), H = $("phone").clientHeight, body = sh.querySelector(".sheet-body");
  const wasPeek = sh.classList.contains("peek");
  sh.classList.remove("peek");  // 펼친 내용 높이로 재야 한다
  const grip = sh.querySelector(".grip-area").offsetHeight;
  const vis = c => !c.hidden && c.offsetHeight > 0;
  const mark = [...sh.querySelectorAll("[data-mid-end]")].find(vis) || [...body.children].filter(vis).pop() || body;
  const mid = Math.min(grip + mark.offsetTop + mark.offsetHeight - body.offsetTop + 12, Math.round(H * (H < 700 ? .5 : .6)));
  const peek = Math.min(grip + 54, mid);
  const full = Math.max(mid, Math.min(H - 100, grip + body.scrollHeight + 4));
  if (wasPeek) sh.classList.add("peek");
  return { peek, mid, full };
}
function setSheet(name, pos, px) {
  const sh = $("sheet-" + name); if (!sh) return;
  const s = sheets[name] || (sheets[name] = { pos: "mid", h: 0 });
  const sn = snaps(name);
  s.pos = pos || s.pos;
  s.h = px ?? sn[s.pos];
  sh.style.setProperty("--h", s.h + "px");
  sh.classList.toggle("full", s.pos === "full");
  sh.classList.toggle("peek", s.pos === "peek");
  if (name === current) $("phone").style.setProperty("--sheet-h", s.h + "px");
}
function setPeek(name, html) { const el = $("sheet-" + name).querySelector("[data-peek]"); if (el) el.innerHTML = html; }
function initSheet(name) {
  const sh = $("sheet-" + name), grip = sh.querySelector(".grip-area");
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
}

// ---------- 상태 ----------
const state = { deadline: 9 * 3600 + 600, from: DEMO_FROM, to: DEMO_TO, dep: 0, focus: "jjuk", routes: null, sims: null, src: null, dst: null, pick: "to", tripKey: null, error: null };
let current = null;
const setStatus = (title, text) => { if (current === "result") { $("result-status").hidden = false; $("result-status").innerHTML = `<b>${esc(title)}</b>${esc(text)}`; } };
const tripKeyNow = () => state.from.ll.join() + "|" + state.to.ll.join();
async function computeTrip() {
  const key = tripKeyNow();
  if (state.tripKey === key && (state.routes || state.error)) { refreshSims(); return; }
  state.tripKey = key; state.routes = null; state.error = null;
  const d = distLL(state.from.ll, state.to.ll);
  if (d < 30) { state.error = { title: "출발지와 도착지가 거의 같아요", text: "다른 곳을 골라 주세요." }; return; }
  const cells = cellsFor(state.from.ll, state.to.ll, Math.max(700, d * 0.25));
  if (cells.some(k => !G.cells.has(k))) setStatus("길 찾는 중…", `지도 조각 ${cells.length}개를 받고 있어요${d > 5000 ? " (먼 길이라 조금 걸려요)" : ""}.`);
  await Promise.all(cells.map(loadCell));
  const a = snap(state.from.ll), b = snap(state.to.ll);
  if (a.d > 300 || b.d > 300) { state.error = { title: "근처에 걸을 수 있는 길 정보가 없어요", text: "서울 안의 다른 곳을 골라 주세요." }; return; }
  state.src = a.id; state.dst = b.id;
  const t0 = performance.now();
  const short = routeFor("short", state.dep), jjuk = routeFor("jjuk", state.dep);
  state.lastRouteMs = performance.now() - t0;
  if (!short || !jjuk) { state.error = { title: "길을 못 찾았어요", text: "두 곳이 걸어서 이어지지 않아요(강·고속도로 등). 다른 곳을 골라 주세요." }; return; }
  state.routes = { short, jjuk, dep: state.dep };
  refreshSims();
}
function refreshSims() {
  if (!state.routes) { state.sims = null; return; }
  // 출발 시각이 바뀌면 신호 위상이 달라지므로 두 길을 다시 찾는다
  if (state.routes.dep !== state.dep) { state.routes.short = routeFor("short", state.dep); state.routes.jjuk = routeFor("jjuk", state.dep); state.routes.dep = state.dep; }
  const R = state.routes;
  let sj = simulate(R.jjuk, state.dep), ss = simulate(R.short, state.dep);
  // 쭉고 길은 "최단 시간"보다 나쁘면 안 된다: 멈춤·기다림·신호 수 중 어느 것도 늘지 않고 하나는 줄어야 하며,
  // 도착이 늦어지더라도 SLOW_OK초 이내일 때만 보여준다. 아니면 최단 시간 길이 곧 쭉고 길이다.
  const nSig = s => s.unknownN + s.knownN, extra = sj.total - ss.total;
  const savedStops = ss.stops - sj.stops, savedSig = nSig(ss) - nSig(sj), savedWait = ss.wait - sj.wait;
  const notWorse = savedStops >= 0 && savedWait >= -5 && savedSig >= 0;
  const improves = savedStops > 0 || savedWait > 5 || savedSig > 0;
  if (!(notWorse && improves && extra <= SLOW_OK) && R.jjuk.key !== R.short.key) { R.jjuk = R.short; sj = ss; }
  state.same = R.jjuk.key === R.short.key;
  state.sims = { jjuk: sj, short: ss };
  if (state.same) state.focus = "jjuk";
}
const tripLabel = p => p.me ? `${p.name}` : p.name;

// ---------- 출발 시각 (쭉고의 중심) ----------
// 지금 보는 길 그대로, 지금(dep=0)부터 15분 사이 5초 간격으로 출발해 보며
// 가장 덜 멈추는 출발과 마감에 맞는 가장 늦은 출발을 찾는다. (출발마다 길을 바꾸면 비교가 흐려진다)
function planDeparture() {
  const R = state.routes[state.same ? "jjuk" : state.focus], opts = [];
  for (let d = 0; d <= 900; d += 5) { const s = simulate(R, d); opts.push({ d, s, arr: BASE + d + s.total }); }
  if (!opts.length) return null;
  const dl = state.deadline, ok = o => dl == null || o.arr <= dl - 30;  // 마감 30초 전까지 도착
  // 마감에 맞는 출발이 5분 안에 하나도 없으면 마감은 빼고 덜 멈추는 출발만 고른다
  const soon = opts.filter(o => o.d <= 300 && ok(o)).length ? opts.filter(o => o.d <= 300 && ok(o)) : opts.filter(o => o.d <= 300);
  const best = (soon.length ? soon : opts.slice(0, 1)).slice().sort((a, b) => a.s.stops - b.s.stops || a.arr - b.arr || a.d - b.d)[0];
  const latest = dl == null ? null : opts.filter(ok).pop() || null;
  return { now: opts[0], best, latest };
}
const fmtSlack = s => s >= 60 ? `${Math.floor(s / 60)}분` + (s % 60 >= 30 ? " 30초" : "") : `${Math.max(0, Math.round(s))}초`;
function renderGoCard() {
  const wrap = $("go-wrap"), el = $("go-card"), S = state.sims;
  if (!S || S.jjuk.knownN + S.short.knownN === 0) { wrap.hidden = true; return null; }
  const p = planDeparture();
  if (!p) { wrap.hidden = true; return null; }
  const { now, best, latest } = p, dl = state.deadline;
  const better = best.d > 0 && (best.s.stops < now.s.stops || best.arr < now.arr - 5);
  const pick = better ? best : now, when = pick.d === 0 ? "지금" : (pick.d < 60 ? pick.d + "초" : phrase(pick.d)) + " 뒤";
  const stat = (label, val, bad) => `<div class="${bad ? "bad" : ""}"><span>${label}</span><b>${val}</b></div>`;
  let h = `<div class="gc-head">추천 출발</div>
    <div class="gc-big">${when} 출발</div>
    <div class="gc-stats">${stat("예상 멈춤", pick.s.stops + "번")}${stat("신호 대기", mmss(pick.s.wait))}${stat("도착 예상", clock(pick.arr), dl != null && pick.arr > dl)}</div>`;
  if (better) h += `<div class="gc-row">${state.dep === best.d ? `<span class="on">✓ 선택됨</span>` : `<button class="use" data-dep-use="${best.d}">이 시각 선택</button>`}<span class="note2">지금 출발하면 ${now.s.stops}번 멈춤</span></div>`;
  if (dl != null) h += `<div class="gc-head">${clock(dl)} 마감 · ${latest ? `${clock(BASE + latest.d)}까지 출발` : pick.arr > dl ? `약 ${phrase(pick.arr - dl).trim()} 늦음` : "도착 여유 30초 미만"}</div>`;
  el.innerHTML = h;
  $("go-foot").textContent = `신호 ${now.s.knownN}곳 예측` + (now.s.unknownN ? ` · ${now.s.unknownN}곳 대기시간 미반영` : "") + " · 실제 신호를 확인하세요";
  wrap.hidden = false;
  return { pick, when };
}
// '이번 신호 놓쳐도 괜찮아?' 한 줄. 마감이 있으면 여유와 비교한다. 뛰라고 하지 않는다.
function missLine(x, sim) {
  if (!x.known) return "";
  const slack = state.deadline == null ? null : state.deadline - (BASE + state.dep + sim.total);
  if (!x.green) return slack != null && slack < 0 ? `<span class="miss warn">마감보다 늦을 수 있어요. 서두르지 말고 늦는다고 알려 두세요.</span>` : "";
  if (x.rem < MIN_GREEN) return `<span class="miss">초록이 곧 끝나요. 무리하지 말고 다음 초록(약 ${x.miss}초 뒤)을 기다려요.</span>`;
  if (slack == null) return `<span class="miss">이번 초록을 놓쳐도 다음 초록까지 약 ${x.miss}초예요. 서두르지 않아도 돼요.</span>`;
  return slack >= x.miss
    ? `<span class="miss">이번 초록을 놓쳐도 괜찮아요. 다음 초록까지 약 ${x.miss}초, 마감까지 ${fmtSlack(slack)} 여유가 있어요.</span>`
    : `<span class="miss warn">이번 초록을 놓치면 마감에 빠듯해요(놓치면 +${x.miss}초, 여유 ${fmtSlack(slack)}). 다음엔 조금 일찍 나와요.</span>`;
}

// ---------- 화면 ----------
function stripHTML(sim, scale, walkClass) {
  return sim.segs.map(seg => seg.type === "unk" ? `<i class="unk"></i>` : `<i class="${seg.type === "wait" && seg.s > 2 ? "wait" : walkClass}" style="width:${(seg.s / scale * 100).toFixed(2)}%"></i>`).join("");
}
function statLine(sim) {
  const parts = [];
  if (sim.knownN) parts.push(`멈춤 <strong>${sim.stops}번</strong> · 기다림 <strong>${mmss(sim.wait)}</strong>`);
  if (sim.unknownN) parts.push(`${sim.knownN ? "패턴 없는 신호" : "신호"} <strong>${sim.unknownN}곳</strong>`);
  if (!sim.knownN && !sim.unknownN) parts.push(`신호 <strong>0곳</strong>`);
  return parts.join(" · ");
}
function renderHome() {
  mountMap("map-home"); clearDyn();
  setPeek("home", `<span>언제 나가면 안 멈출까요?</span><small>${state.deadline == null ? "마감 없음" : clock(state.deadline) + " 마감"}</small>`);
  setRoutes(null, null);
  addDyn(el("m-me", "<i></i>"), ME.ll);
  if (!state.picked) resetHomeSheet();
  const recent = store.get("recent", []);
  const chips = [...recent.slice(0, 2).map(p => ({ ...p, recent: true })), ...EXAMPLES];
  $("home-chips").innerHTML = chips.map((p, i) => `<button class="chip" data-chip="${i}">${p.recent ? "최근 · " + esc(p.name) : esc(p.from) + " → " + esc(p.to)}</button>`).join("");
  $("home-chips").chips = chips;
  setSheet("home", state.picked ? "mid" : sheets.home?.pos || "mid");
  // 처음엔 신호 패턴을 아는 구간(노란 테두리)이 다 보이게
  ready(() => {
    if (state.homeView) return;
    const c = corridor();
    if (c.geometry) map.fitBounds(c.geometry.coordinates[0].slice(0, 4).reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(c.geometry.coordinates[0][0], c.geometry.coordinates[0][0])), { padding: { top: 130, bottom: sheetH() + 30, left: 30, right: 60 }, duration: 0 });
    else map.jumpTo({ center: ME.ll, zoom: 16.2, bearing: 0 });
    state.homeView = true;
  });
}
async function renderResult() {
  mountMap("map-result");
  $("from-name").innerHTML = esc(tripLabel(state.from)) + (state.from.sub ? `<small>${esc(state.from.sub)}</small>` : "");
  $("to-name").innerHTML = esc(state.to.name) + (state.to.sub ? `<small>${esc(state.to.sub)}</small>` : "");
  const st = $("result-status"), cards = $("route-cards");
  const waitUI = on => { ["tradeoff", "result-actions"].forEach(id => $(id).hidden = !on); if (!on) $("go-wrap").hidden = true; };
  if (state.tripKey !== tripKeyNow()) { state.routes = null; state.error = null; }
  if (!state.routes && !state.error) {
    st.hidden = false; st.innerHTML = "<b>길 찾는 중…</b>지도 데이터를 받고 있어요."; cards.hidden = true; waitUI(false);
    setSheet("result", "mid"); clearDyn(); setRoutes(null, null);
    await computeTrip();
    if (current !== "result") return;
  } else refreshSims();
  if (state.error) {
    st.hidden = false; st.innerHTML = `<b>${esc(state.error.title)}</b>${esc(state.error.text)}`; cards.hidden = true; waitUI(false);
    $("cov-note").hidden = true; setRoutes(null, null); markTrip(null);
    setSheet("result", "mid"); fit([[state.from.ll, state.to.ll]]);
    return;
  }
  st.hidden = true; cards.hidden = false; waitUI(true);
  const go = renderGoCard();
  const S = state.sims, scale = Math.max(S.jjuk.total, S.short.total);
  $("depart-label").textContent = `${clock(BASE + state.dep)} 출발`;
  for (const k of ["jjuk", "short"]) {
    const sim = S[k], c = $("card-" + k);
    c.hidden = k === "short" && state.same;
    c.setAttribute("aria-pressed", String(state.focus === k));
    const name = k === "jjuk" ? (state.same ? "쭉고 · 최단 시간" : "쭉고") : "최단 시간";
    c.innerHTML = `<span class="name">${name}</span><span class="mins">${mins(sim.total)}</span><span class="stat">${statLine(sim)}</span>
      <span class="strip" aria-hidden="true">${stripHTML(sim, scale, k === "jjuk" ? "walk-j" : "walk-s")}</span>`;
  }
  const kn = S.jjuk.knownN + S.short.knownN, dWalk = S.jjuk.walk - S.short.walk;
  let t;
  if (state.same) t = S.jjuk.unknownN + S.jjuk.knownN === 0 ? "신호 없이 쭉 갈 수 있어요." : "기다림까지 따진 최단 시간 길이 신호도 가장 적어요.";
  else if (kn) {
    const dWait = S.short.wait - S.jjuk.wait, dStops = S.short.stops - S.jjuk.stops, dUnk = S.short.unknownN - S.jjuk.unknownN;
    if (dWait > 5) t = `${dWalk > 20 ? phrase(dWalk) + " 더 걷고, " : ""}${phrase(dWait)} 덜 기다려요.`;
    else if (dStops > 0) t = `${dStops}번 덜 멈춰요.`;
    else if (dUnk > 0) t = `신호를 ${dUnk}곳 덜 지나요.`;
    else t = "지금은 두 길의 기다림이 비슷해요.";
  } else {
    const dSig = S.short.unknownN - S.jjuk.unknownN;
    t = dSig > 0 ? `${dWalk > 20 ? phrase(dWalk) + " 더 걷고, " : ""}신호를 ${dSig}곳 덜 지나요.` : "두 길이 지나는 신호 수가 같아요.";
  }
  $("tradeoff").textContent = t;
  $("tradeoff").hidden = state.same;
  $("start-walk").textContent = "걷기 시작";
  document.querySelectorAll("[data-dep]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.dep === state.dep)));
  // 패턴이 없는 길: 기다림 대신 신호 개수로 비교한다고 지도 위에 알린다
  const anyKnown = S.jjuk.knownN + S.short.knownN > 0, anyUnknown = S.jjuk.unknownN + S.short.unknownN > 0;
  $("cov-note").hidden = !anyUnknown || !$("go-wrap").hidden;  // 출발 카드가 있으면 그 각주로 대신
  $("cov-text").textContent = anyKnown ? "일부 신호는 패턴이 없어 개수만 셌어요" : "이 길은 신호 패턴이 없어 신호 개수만 비교했어요";
  $("result-safety").textContent = `예상값이에요. 건널 때는 신호를 꼭 확인하세요. 걷는 속도 1.2m/s 기준.`;
  setRoutes(state.focus === "jjuk" || state.same ? state.routes.jjuk : state.routes.short, state.same ? null : (state.focus === "jjuk" ? state.routes.short : state.routes.jjuk));
  ready(() => { map.setPaintProperty("route-jjuk", "line-color", state.focus === "jjuk" ? "#F6C343" : "#9AA3B2"); });
  markTrip(S, state.focus);
  const fk = state.same ? "jjuk" : state.focus;
  setPeek("result", go ? `<span>${go.when} 출발 · 멈춤 ${go.pick.s.stops}번 · ${clock(go.pick.arr)} 도착</span><small>올려서 보기</small>`
    : `<span>${fk === "jjuk" ? "쭉고" : "최단 시간"} ${mins(S[fk].total)} · ${statLine(S[fk]).replace(/<[^>]+>/g, "")}</span><small>올려서 보기</small>`);
  setSheet("result", sheets.result?.pos === "full" ? "full" : sheets.result?.pos || "mid");
  if (!state.fitted || state.fitted !== state.tripKey) { fit([state.routes.jjuk.coords, state.routes.short.coords]); state.fitted = state.tripKey; }
}
function renderDetail() {
  if (!state.sims) return go("result");
  const sim = state.sims[state.focus];
  $("detail-title").textContent = `${state.focus === "jjuk" ? "쭉고" : "최단 시간"} 길의 신호 ${sim.xings.length}곳`;
  $("detail-list").innerHTML = (sim.xings.length ? sim.xings.map(x => {
    const cls = !x.known ? "unk" : x.wait > 2 ? "stop" : "go";
    const msg = (!x.known ? "신호 있음 · 패턴을 아직 몰라요" : x.wait > 2 ? `도착하면 ${x.green ? "초록이 곧 끝나서" : "빨간불,"} 약 ${x.wait}초 기다려요` : `도착하면 초록불(약 ${x.rem}초 남음), 그대로 건너요`) + missLine(x, sim);
    return `<button class="xing-btn" data-sig="${esc(x.id)}"><div class="xing"><time>${clock(x.arrive)}</time><span class="mark ${cls}">${!x.known ? "–" : x.wait > 2 ? "Ⅱ" : "✓"}</span><div><b>${esc(x.name)} ›</b><small>${msg}</small></div></div></button>`;
  }).join("") : `<p class="note">이 길에는 신호 횡단보도가 없어요.</p>`) +
  `<p class="note">경로는 OpenStreetMap 보행 도로망에서 계산했어요. 신호는 서울 C-ITS 신호 교차로와 OSM 신호 표시이고, 교차로 중심 35m 안을 지나면 그 신호를 지나는 것으로 셌어요(지하도·육교는 제외). 신호 패턴은 실측한 ${realCount()}곳만 써요. 관측한 시간대와 다른 시간엔 신호 계획이 다를 수 있어요. 건널 때는 신호를 꼭 확인하세요.</p>`;
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
let walkTimer = null;
function renderWalk() {
  if (!state.sims) return go("result");
  const k = state.same ? "jjuk" : state.focus, sim = state.sims[k], route = state.routes[k];
  mountMap("map-walk");
  setRoutes(route, null);
  markTrip({ [k]: sim }, k);
  setSheet("walk", "mid");
  fit([route.coords], { top: 170 });
  walker = new maplibregl.Marker({ element: el("m-me", "<i></i>") }).setLngLat(route.coords[0]).addTo(map);
  const L = route.length, DUR = 9000, reduce = matchMedia("(prefers-reduced-motion: reduce)").matches, start = performance.now();
  cancelAnimationFrame(walkTimer);
  const step = now => {
    const f = reduce ? 0.32 : Math.min(1, (now - start) / DUR), dist = f * L;
    if (walker) walker.setLngLat(pointAt(route, dist));
    $("w-stops").textContent = sim.xings.filter(z => z.d <= dist && z.known && z.wait > 2).length;
    $("w-left").textContent = mins(sim.total * (1 - f));
    $("w-eta").textContent = clock(BASE + state.dep + sim.total);
    setPeek("walk", `<span>멈춘 횟수 ${$("w-stops").textContent} · 남은 ${$("w-left").textContent}</span><small>${clock(BASE + state.dep + sim.total)} 도착</small>`);
    const next = sim.xings.find(z => z.d > dist + 1);
    if (next) {
      $("next-dist").textContent = Math.round(next.d - dist) + "m";
      if (!next.known) { $("next-state").textContent = `${next.name} · 신호 패턴을 몰라요`; $("next-say").textContent = "도착하면 신호를 확인하세요"; }
      else if (next.wait > 2) { $("next-state").textContent = `${next.name} · 도착하면 약 ${next.wait}초 기다려요`; $("next-say").textContent = "천천히 가도 괜찮아요"; }
      else { $("next-state").textContent = `${next.name} · 도착하면 초록불(약 ${next.rem}초 남음)`; $("next-say").textContent = next.miss ? `놓쳐도 다음 초록까지 약 ${next.miss}초, 서두르지 않아도 돼요` : "지금처럼 걸으면 돼요"; }
    } else { $("next-dist").textContent = "없음"; $("next-state").textContent = `도착까지 ${Math.round(L - dist)}m, 남은 신호 횡단보도가 없어요`; $("next-say").textContent = "지금처럼 걸으면 돼요"; }
    if (f < 1 && !reduce) walkTimer = requestAnimationFrame(step);
  };
  walkTimer = requestAnimationFrame(step);
}
function renderDone() {
  if (!state.sims) return go("result");
  const k = state.same ? "jjuk" : state.focus, o = k === "jjuk" ? "short" : "jjuk";
  const sim = state.sims[k], other = state.sims[o], route = state.routes[k];
  const kn = sim.knownN > 0;
  $("c-stops").textContent = kn ? sim.stops + "번" : (sim.unknownN) + "곳";
  $("c-stops-l").textContent = kn ? "멈춘 횟수" : "지난 신호";
  $("c-wait").textContent = kn ? mmss(sim.wait) : km(sim.meters);
  $("c-wait-l").textContent = kn ? "신호 기다림" : "걸은 거리";
  $("c-time").textContent = mmss(sim.total);
  $("card-kind").textContent = `걷기 · ${tripLabel(state.from)} → ${state.to.name}`;
  if (state.same) $("c-compare").textContent = "오늘은 최단 시간 길이 곧 쭉고 길이었어요";
  else if (kn) $("c-compare").textContent = other.stops <= sim.stops && other.wait <= sim.wait + 5 ? "오늘은 다른 길로 갔어도 비슷했을 거예요" : `${o === "short" ? "최단 시간 길" : "쭉고 길"}으로 갔다면 ${other.stops}번 멈추고 ${mmss(other.wait)} 기다렸을 거예요`;
  else $("c-compare").textContent = other.unknownN > sim.unknownN ? `${o === "short" ? "최단 시간 길" : "쭉고 길"} 길보다 신호를 ${other.unknownN - sim.unknownN}곳 덜 지났어요` : "신호 수는 다른 길과 같았어요";
  $("card-date").textContent = `10월 28일 ${clock(BASE + state.dep)}`;
  $("done-hint").textContent = "스크린샷을 찍어 공유해 보세요";
  const kx = 111320 * Math.cos(37.55 * Math.PI / 180), pts = route.coords.map(c => [c[0] * kx, -c[1] * 110540]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = 150 / Math.max(maxX - minX, maxY - minY, 1), ox = (190 - (maxX - minX) * s) / 2, oy = (190 - (maxY - minY) * s) / 2;
  const tx = p => [(p[0] - minX) * s + ox, (p[1] - minY) * s + oy], proj = c => tx([c[0] * kx, -c[1] * 110540]);
  let h = `<svg viewBox="0 0 190 190" aria-label="걸은 길 모양"><polyline points="${pts.map(p => tx(p).map(v => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="var(--lane)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
  const [sx, sy] = tx(pts[0]), [ex, ey] = tx(pts[pts.length - 1]);
  h += `<circle cx="${sx}" cy="${sy}" r="6" fill="#262D3B" stroke="var(--lane)" stroke-width="3"/><circle cx="${ex}" cy="${ey}" r="7" fill="var(--lane)"/>`;
  sim.xings.forEach(x => { const [px, py] = proj(x.at); const col = !x.known ? "#8C93A3" : x.wait > 2 ? "var(--stop)" : null; if (col) h += `<circle cx="${px}" cy="${py}" r="${x.known ? 7 : 4.5}" fill="${col}" stroke="#262D3B" stroke-width="2.5"/>`; });
  $("card-shape").innerHTML = h + "</svg>";
}
function renderDepart() {
  if (!state.sims) return go("result");
  const hasKnown = state.sims.jjuk.knownN + state.sims.short.knownN > 0;
  $("depart-head").textContent = `쭉고 길 · ${tripLabel(state.from)} → ${state.to.name} · 1분 간격. 시각을 누르면 그 기준으로 길을 보여드려요.`;
  if (!hasKnown) {
    $("depart-best").innerHTML = `<span class="when">이 길은</span><span class="big" style="font-size:24px">신호 패턴이 없어요</span><span class="why">패턴을 아는 곳(광화문 일대)을 지나야 출발 시각에 따라 기다림이 달라지는 걸 계산할 수 있어요.</span>`;
    $("depart-list").innerHTML = ""; $("depart-note").textContent = ""; return;
  }
  const opts = [];
  for (let d = 0; d <= 840; d += 60) { const r = routeFor("jjuk", d); if (r) opts.push({ d, sim: simulate(r, d) }); }
  const scale = Math.max(...opts.map(o => o.sim.total));
  const best = opts.slice().sort((a, b) => a.sim.stops - b.sim.stops || (a.d + a.sim.total) - (b.d + b.sim.total) || a.d - b.d)[0];
  const now = opts[0], saved = now.sim.wait - best.sim.wait;
  $("depart-best").innerHTML = `<span class="when">${best.d === 0 ? "지금" : clock(BASE + best.d)} 나가면</span><span class="big">멈춤 ${best.sim.stops}번</span>
    <span class="why">${clock(BASE + best.d + best.sim.total)} 도착 · ${best.d === 0 ? "지금이 가장 좋아요" : saved > 2 ? `지금 나갈 때보다 ${phrase(saved)} 덜 기다려요` : "기다림은 지금과 비슷해요"}</span>`;
  $("depart-list").innerHTML = opts.map(o => `<button class="drow" data-dep-pick="${o.d}" aria-current="${o.d === state.dep}">
      <span class="t"><time>${clock(BASE + o.d)}</time>${o.d === 0 ? '<span class="tag now">지금</span>' : ""}${o === best ? '<span class="tag rec">추천</span>' : ""}</span>
      <span class="strip" aria-hidden="true">${stripHTML(o.sim, scale, "walk-j")}</span>
      <span class="res">멈춤 <b>${o.sim.stops}번</b><br>${clock(BASE + o.d + o.sim.total)} 도착</span></button>`).join("");
  $("depart-note").textContent = `패턴을 아는 신호 ${realCount()}곳만 시각에 따라 계산했어요. 모르는 신호는 시각과 상관없이 같게 셌어요.`;
}
function renderSignal() {
  const id = state.sig, m = SIGMETA.get(id);
  if (!m) return go("home");
  $("sig-title").textContent = sigName(id);
  const x = state.sims && [...state.sims[state.focus].xings, ...state.sims.jjuk.xings, ...state.sims.short.xings].find(z => z.id === id);
  const arrive = x ? x.arrive : BASE + state.dep;
  $("sig-known").hidden = !known(id); $("sig-req").hidden = known(id);
  if (known(id)) {
    const dir = x && x.dir, w = Math.round(sigWait(id, arrive, dir)), stop = w > 2;
    $("sig-hero").innerHTML = `<div class="lamp ${stop ? "stop" : "go"}">${stop ? w : "✓"}</div>
      <div><b>${clock(arrive)} 도착하면 ${stop ? `약 ${w}초 기다려요` : "초록불, 그대로 건너요"}</b><span>${x ? "지금 보는 길 기준" : `${clock(BASE + state.dep)} 기준`}</span>${x && state.sims ? missLine(x, state.sims[state.focus]) : ""}</div>`;
    const t0 = arrive - 60, span = 360; let html = "", runStart = null;
    for (let i = 0; i <= span; i++) {
      const green = i < span && sigState(id, t0 + i, dir).g;
      if (green && runStart === null) runStart = i;
      if (!green && runStart !== null) { html += `<i style="left:${runStart / span * 100}%;width:${(i - runStart) / span * 100}%"></i>`; runStart = null; }
    }
    html += `<span class="me" style="left:calc(${60 / span * 100}% - 1px)"></span>`;
    $("sig-timeline").innerHTML = html; $("sig-timeline").setAttribute("aria-label", "앞으로 6분 동안 초록·빨강 신호와 내 도착 시점");
    $("sig-tl-me").innerHTML = `<span style="left:calc(${60 / span * 100}% - 6px); transform:none; font-weight:700; color:var(--asphalt)">▼ 내 도착 ${clock(arrive)}</span>`;
    $("sig-tl-labels").innerHTML = `<span style="left:0">${clock(t0)}</span><span style="left:100%">${clock(t0 + span)}</span>`;
  } else {
    $("sig-hero").innerHTML = `<div class="lamp unk">?</div><div><b>이 신호는 아직 패턴을 몰라요</b><span>서울 신호를 하나씩 모으는 중이에요(지금 ${realCount()}곳 확인). 이 신호는 지나는 개수로만 셌어요.</span></div>`;
  }
  const r = REAL.signals[id];
  const facts = r
    ? [["주기", `${r.c.toFixed(1)}초`], ["보행 초록", `${Math.round(r.win.reduce((a, w) => a + w[1] - w[0], 0))}초 (한 주기에 ${r.win.length}번)`], ["근거", `실측 ${r.from}–${r.to} (${r.observed_min}분 관측)`], ["방향", `${Object.keys(r.legs || {}).map(l => DIR_KO[l]).join("·") || "기본"} 횡단보도 (C-ITS 방향 대응은 가정)`], ["교차로", `${id} · ${r.dir} 방향 보행신호`]]
    : [["종류", m.cits ? `C-ITS 신호 교차로 ${id}` : "OSM 신호 표시"], ["패턴", "아직 없음"], ["위치", `${m.ll[1].toFixed(5)}, ${m.ll[0].toFixed(5)}`]];
  $("sig-facts").innerHTML = facts.map(([k2, v]) => `<dt>${k2}</dt><dd>${esc(v)}</dd>`).join("");
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
  const origin = state.pick === "from" ? state.to.ll : state.from.ll;
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
  const q = $("sq").value, seq = ++searchSeq, origin = state.pick === "from" ? state.to.ll : state.from.ll;
  $("sq-clear").hidden = !q;
  $("search-for").textContent = state.pick === "from" ? "출발지를 골라요" : `도착지를 골라요 · 거리는 ${state.from.me ? "내 위치(서울광장 예시)" : state.from.name}에서 직선`;
  if (!q.trim()) {
    const recent = store.get("recent", []);
    const sugg = ["강남역", "시청역", "홍대입구역", "잠실역", "여의도역", "성수동 카페"];
    let h = "";
    if (state.pick === "from") h += `<button class="res-item" data-res-me><b>내 위치</b><small>예시: 서울광장 · 실제 GPS는 아직 안 써요</small></button>`;
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
  const place = { name: p.name, sub: p.kind && p.kind !== "역" ? p.kind : "", ll: p.ll, kind: p.kind };
  if (!p.me) {
    const recent = store.get("recent", []).filter(r => r.name !== p.name);
    store.set("recent", [{ name: p.name, kind: p.kind, ll: p.ll }, ...recent].slice(0, 6));
  }
  if (state.pick === "from") state.from = p.me ? ME : place; else state.to = place;
  state.dep = 0; state.focus = "jjuk";
  resetHomeSheet();
  go("result");
}

async function exampleTrip(ex) {
  const list = await ensureSearch();
  const find = n => list.find(p => p.name === n) || list.find(p => p.name.startsWith(n));
  const a = find(ex.from), b = find(ex.to);
  if (!a || !b) return;
  state.from = { name: a.name, sub: "", ll: a.ll, kind: a.kind };
  state.to = { name: b.name, sub: b.kind === "역" ? "" : b.kind, ll: b.ll, kind: b.kind };
  state.dep = 0; state.focus = "jjuk";
  go("result");
}

// ---------- 화면 전환 ----------
const SCREENS = ["splash", "home", "search", "result", "detail", "walk", "done", "depart", "signal"];
const MAP_SCREENS = ["home", "result", "walk"];
let splashTimer = null, booted = false;
function show(name) {
  if (!SCREENS.includes(name)) name = "splash";
  if (!booted && name !== "splash") { pendingScreen = name; name = "splash"; }
  if (name === "signal" && !state.sig) name = "home";
  current = name;
  SCREENS.forEach(n => { $("s-" + n).hidden = n !== name; });
  $("badge").hidden = true;  // 예시 표시는 숫자 옆(카드·신호 상세·공유 카드)에만 둔다
  $("mapctl").hidden = !MAP_SCREENS.includes(name); $("map-attrib").hidden = !MAP_SCREENS.includes(name);
  $("phone").style.setProperty("--sheet-h", (MAP_SCREENS.includes(name) && sheets[name] ? sheets[name].h : 0) + "px");
  clearTimeout(splashTimer);
  if (name === "splash" && booted) splashTimer = setTimeout(() => go("home"), 1600);
  if (name !== "walk") cancelAnimationFrame(walkTimer);
  if (name === "home") renderHome();
  if (name === "search") { renderSearchList(); setTimeout(() => $("sq").focus(), 50); }
  if (name === "result") renderResult();
  if (name === "detail") renderDetail();
  if (name === "walk") renderWalk();
  if (name === "done") renderDone();
  if (name === "depart") renderDepart();
  if (name === "signal") renderSignal();
}
let pendingScreen = null;
function go(name) { if (location.hash === "#" + name) show(name); else location.hash = name; }
document.addEventListener("click", e => {
  const t = e.target;
  const sg = t.closest("[data-sig]");
  if (sg) { state.sig = sg.dataset.sig; go("signal"); return; }
  if (t.closest("[data-back]")) { history.length > 1 ? history.back() : go("home"); return; }
  const dp = t.closest("[data-dep-pick]");
  if (dp) { state.dep = +dp.dataset.depPick; go("result"); return; }
  const sr = t.closest("[data-search]");
  if (sr) { state.pick = sr.dataset.search; $("sq").value = ""; go("search"); return; }
  const ch = t.closest("[data-chip]");
  if (ch) { const p = $("home-chips").chips[+ch.dataset.chip]; if (p.ll) { state.pick = "to"; choosePlace(p); } else exampleTrip(p); return; }
  const r = t.closest("[data-res]");
  if (r) { choosePlace($("search-list").results[+r.dataset.res]); return; }
  const rr = t.closest("[data-res-recent]");
  if (rr) { choosePlace(store.get("recent", [])[+rr.dataset.resRecent]); return; }
  if (t.closest("[data-res-me]")) { choosePlace({ ...ME }); return; }
  const rs = t.closest("[data-res-sugg]");
  if (rs) { $("sq").value = rs.dataset.resSugg; renderSearchList(); return; }
  if (t.closest("#hp-to")) { state.pick = "to"; choosePlace({ ...state.picked }); return; }
  if (t.closest("#hp-from")) { state.pick = "from"; choosePlace({ ...state.picked }); return; }
  if (t.closest("[data-trip='demo']")) { state.from = DEMO_FROM; state.to = DEMO_TO; state.dep = 0; go("result"); return; }
  if (t.closest("#swap")) { [state.from, state.to] = [state.to, state.from]; state.dep = 0; renderResult(); return; }
  if (t.closest("#sq-clear")) { $("sq").value = ""; renderSearchList(); $("sq").focus(); return; }
  const du = t.closest("[data-dep-use]");
  // 같은 길에서 출발 시각만 바꾼다(길을 다시 찾지 않음)
  if (du) { state.dep = +du.dataset.depUse; if (state.routes) state.routes.dep = state.dep; renderResult(); return; }
  const timeStep = t.closest("[data-time-step]");
  if (timeStep) { if (state.deadline != null) setDeadline(Math.max(0, Math.min(86340, state.deadline + Number(timeStep.dataset.timeStep) * 60))); return; }
  if (t.closest("#no-deadline")) { setDeadline(state.deadline == null ? state.lastDeadline ?? 33000 : null); return; }
  if (t.closest("#cov-req")) { $("cov-text").textContent = "기록했어요. 프로토타입이라 실제로 보내지는 않아요."; return; }
  if (t.closest("#sig-req")) { $("sig-note").textContent = "기록했어요. 프로토타입이라 실제로 보내지는 않아요."; return; }
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

function setDeadline(v) {
  if (v !== null && (!Number.isInteger(v) || v < 0 || v > 86340 || v % 60 !== 0)) v = 33000;
  state.deadline = v;
  if (v != null) state.lastDeadline = v;
  store.set(DEADLINE_KEY, v);
  $("no-deadline").setAttribute("aria-pressed", String(v == null));
  $("deadline").disabled = v == null;
  if (v != null) {
    $("deadline-hour").value = String(Math.floor(v / 3600)).padStart(2, "0");
    $("deadline-minute").value = String(v / 60 % 60).padStart(2, "0");
  }
}
for (const id of ["deadline-hour", "deadline-minute"]) $(id).addEventListener("change", () => {
  if (state.deadline == null) return;
  const hour = $("deadline-hour"), minute = $("deadline-minute");
  if (!hour.value || !minute.value || !hour.validity.valid || !minute.validity.valid) { setDeadline(state.deadline); return; }
  setDeadline(Number(hour.value) * 3600 + Number(minute.value) * 60);
});
async function boot() {
  show("splash");
  try {
    [IDX, SIGS, GMETA] = await Promise.all([getJSON("tiles/index.json"), getJSON("signals.json"), getJSON("graph/index.json")]);
  } catch (err) {
    $("splash-foot").textContent = "지도 데이터를 못 불러왔어요. 새로고침해 주세요.";
    console.error(err);
    return;
  }
  for (const [id, x, y, name, cits, col] of SIGS) {
    SIGMETA.set(id, { name, cits, ll: fromQ(x, y) });
  }
  ["home", "result", "walk"].forEach(n => { sheets[n] = { pos: "mid", h: 0 }; initSheet(n); });
  setDeadline(store.get(DEADLINE_KEY, 9 * 3600 + 600));
  booted = true;
  $("splash-foot").textContent = "서울 어디든 · 광화문은 신호 패턴까지";
  const target = pendingScreen || location.hash.slice(1);
  if (target && target !== "splash") go(target); else splashTimer = setTimeout(() => go("home"), 1400);
}
boot();
