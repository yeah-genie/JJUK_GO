// ---------- 신호 지도·횡단 안내 (2026-10-30 사용자 결정: 신호등이 핵심) ----------
// 지도에 신호 상태 아이콘을 1초마다 갱신해 보여 준다. 지금은 과거 신호 기록의 '패턴 예상'(점선 테두리)이고,
// 새 실시간 API가 승인·검증되면 같은 아이콘을 실시간(실선 테두리)으로 바꾼다(live-signals.js).
// 패턴은 신뢰 조건(TRUST, planConfidence)을 통과한 신호만 쓴다. 통과 못 하면 '정보 없음'.
// '건널 수 있어요'는 근거가 모두 있을 때만: 신뢰된 패턴 + 횡단보도 길이 + 도착 시각의 남은 고정 초록 ≥ 내 속도로 건너는 시간 + 여유.
// 점멸(permissive)은 초록으로 세지 않는다(의미 미확정).
var SIG = {   // var: app.js의 boot()가 이 파일보다 먼저 실행된다
  MARGIN_S: 3, NEAR_ZOOM: 15.2, timer: null, last: "", nearEdges: null, nearCells: 0, callout: null,

  // 하루 중 t초(한국 시각)에 이 신호·방향의 예상 상태. 신뢰된 패턴이 없으면 null.
  predict(id, t, dir) {
    if (!dir) return null;
    const r = trustedPlan(id, t, dir);
    if (!r) return null;
    const ph = (((r.day0 + ((t % 86400) + 86400) % 86400 - r.ref) % r.c) + r.c) % r.c;
    let wait = Infinity;
    for (const [a, b] of r.win) {
      for (const shift of [0, r.c]) if (ph + shift >= a && ph + shift < b) return { walk: true, rem: b - ph - shift };
      wait = Math.min(wait, ((a - ph) % r.c + r.c) % r.c);
    }
    return wait === Infinity ? null : { walk: false, wait };
  },
  // 경로 횡단 x의 예상: 방향이 있으면 그 다리, 후보 다리만 있으면 모두 같은 상태일 때만(초록이면 가장 짧은 남은 시간, 빨강이면 가장 긴 대기)
  predictX(x, t) {
    if (x.dir) return this.predict(x.s, t, x.dir);
    const ps = (x.dirs || []).map(d => this.predict(x.s, t, d)).filter(Boolean);
    if (!ps.length || (ps.some(p => p.walk) && ps.some(p => !p.walk))) return null;
    return ps[0].walk ? { walk: true, rem: Math.min(...ps.map(p => p.rem)) } : { walk: false, wait: Math.max(...ps.map(p => p.wait)) };
  },
  isCrossing: x => !!(x.dir || x.dirs?.length),
  // 횡단보도 x(경로의 신호 횡단)에 t초에 도착할 때의 안내. speed: m/s
  verdict(x, t, speed = SPEED) {
    const p = this.predictX(x, t);
    if (!p) return { kind: "unknown", label: "신호 정보 없음", text: "이 횡단보도는 신호 패턴이 아직 확인되지 않았어요" };
    if (!p.walk) return { kind: "wait", label: "대기 예상", text: `도착하면 약 ${Math.round(p.wait)}초 기다릴 것으로 예상돼요` };
    const rem = Math.floor(p.rem);
    if (!x.len) return { kind: "green", label: "초록 예상", text: `도착 때 초록 예상 · ${rem}초 남음` };
    const need = x.len / speed;
    if (p.rem >= need + this.MARGIN_S) return { kind: "go", label: "횡단 가능", text: `지금 속도면 건널 수 있어요(예상) · 도착 때 초록 ${rem}초 남음` };
    const next = this.predictX(x, t + p.rem + 0.5);
    return { kind: "short", label: "초록이 짧아요", text: `도착 때 초록 ${rem}초 남음(예상) · 건너는 데 약 ${Math.ceil(need)}초${next && !next.walk ? ` · 다음 초록까지 약 ${Math.round(p.rem + next.wait)}초` : ""}` };
  },

  // 아이콘: 보행(사람)·정지(손)·모름(?) × 예상(점선)·실시간(실선)
  icons() {
    const draw = (fill, glyph, dashed) => {
      const n = 48, c = document.createElement("canvas"); c.width = c.height = n; const g = c.getContext("2d");
      g.beginPath(); g.arc(24, 24, 18, 0, 7); g.fillStyle = fill; g.fill();
      g.lineWidth = 3; g.strokeStyle = "#F4F2E9"; g.setLineDash(dashed ? [5, 4] : []); g.beginPath(); g.arc(24, 24, 20, 0, 7); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineCap = "round"; g.lineJoin = "round";
      if (glyph === "walk") { g.beginPath(); g.arc(25, 13, 3.2, 0, 7); g.fill(); g.lineWidth = 3.2; g.beginPath(); g.moveTo(24, 18); g.lineTo(22, 27); g.lineTo(18, 35); g.moveTo(22, 27); g.lineTo(27, 30); g.lineTo(29, 36); g.moveTo(23, 21); g.lineTo(18, 25); g.moveTo(24, 20); g.lineTo(30, 24); g.stroke(); }
      else if (glyph === "stop") { g.beginPath(); g.roundRect ? g.roundRect(17, 19, 14, 15, 4) : g.rect(17, 19, 14, 15); g.fill(); for (const fx of [17.5, 21, 24.5, 28]) { g.beginPath(); g.roundRect ? g.roundRect(fx, 11, 3, 10, 1.5) : g.rect(fx, 11, 3, 10); g.fill(); } }
      else { g.font = "bold 22px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("?", 24, 25); }
      return g.getImageData(0, 0, n, n);
    };
    return { "sv-walk-p": draw("#2FA866", "walk", true), "sv-stop-p": draw("#D9443F", "stop", true), "sv-unk": draw("#6B7480", "?", false),
             "sv-walk-l": draw("#2FA866", "walk", false), "sv-stop-l": draw("#D9443F", "stop", false) };
  },
  ensure() {
    if (!map || !mapReady || map.getSource("sv-near")) return !!(map && map.getSource && map.getSource("sv-near"));
    for (const [k, img] of Object.entries(this.icons())) if (!map.hasImage(k)) map.addImage(k, img, { pixelRatio: 2 });
    const empty = { type: "FeatureCollection", features: [] };
    map.addSource("sv-near", { type: "geojson", data: empty }); map.addSource("sv-route", { type: "geojson", data: empty });
    // 주변 신호는 작고 흐리게, 경로 위 신호는 크게. 확대가 낮으면 주변은 숨긴다(지도를 깜빡임으로 채우지 않게)
    map.addLayer({ id: "sv-near", type: "symbol", source: "sv-near", minzoom: this.NEAR_ZOOM, layout: { "icon-image": ["get", "icon"], "icon-size": 0.55, "icon-allow-overlap": true }, paint: { "icon-opacity": 0.6 } });
    map.addLayer({ id: "sv-route", type: "symbol", source: "sv-route", minzoom: 12.5, layout: { "icon-image": ["get", "icon"], "icon-size": ["case", ["get", "next"], 1.05, 0.8], "icon-allow-overlap": true, "symbol-sort-key": ["case", ["get", "next"], 1, 0] } });
    return true;
  },
  // 지금 이 화면에서 보여 줄 경로(결과: 선택한 길, 걷기: 걷는 길)
  route() {
    if (!state.routes || !["result", "walk"].includes(current)) return null;
    return state.routes[state.same ? "jjuk" : state.focus];
  },
  // 지금 시각(실제 길찾기면 현재, 예시 길이면 예시 출발 시각+경과)
  now() { return state.mode === "actual" || current === "home" ? kstSec() : BASE + (Date.now() - (state.exampleStarted ||= Date.now())) / 1000; },
  iconFor(id, dir, t, x = null) {
    const lv = typeof LIVE !== "undefined" && LIVE.stateFor ? LIVE.stateFor(id, dir) : null;
    if (lv) return lv === "walk" ? "sv-walk-l" : lv === "stop" ? "sv-stop-l" : "sv-unk";
    const p = x ? this.predictX(x, t) : this.predict(id, t, dir);
    return !p ? "sv-unk" : p.walk ? "sv-walk-p" : "sv-stop-p";
  },
  // 주변 횡단보도: 불러온 보행망에서 신호·방향이 붙은 횡단 간선(지도 조각이 늘어날 때만 다시 모은다)
  nearList() {
    if (this.nearEdges && this.nearCells === G.cells.size) return this.nearEdges;
    const seen = new Set(), out = [];
    for (const edges of G.adj.values()) for (const e of edges) {
      if (!e.sig || !e.dir || seen.has(e) || !G.node.has(e.a) || !G.node.has(e.b)) continue;
      seen.add(e); const p = edgePts(e, e.a); out.push({ s: e.sig, dir: e.dir, ll: fromQ(...p[p.length >> 1]) });
    }
    this.nearCells = G.cells.size; return (this.nearEdges = out);
  },
  // 홈에서 확대하면 화면에 보이는 지도 조각을 불러와 주변 신호를 보여 준다
  loadView() {
    if (!map || current !== "home" || map.getZoom() < this.NEAR_ZOOM || !GMETA) return;
    const b = map.getBounds(); cellsFor([b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()], 0).slice(0, 6).forEach(k => loadCell(k).catch(() => {}));
  },
  tick() {
    if (!map || !mapReady || !["home", "result", "walk"].includes(current)) return;
    if (!this.ensure()) return;
    const t = this.now(), r = this.route(), b = map.getBounds(), z = map.getZoom();
    const onRoute = new Set(), rf = [];
    if (r) {
      const xs = r.x.filter(this.isCrossing), nextX = current === "walk" ? this.nextX : xs[0];
      for (const x of xs) { for (const d of x.dir ? [x.dir] : x.dirs) onRoute.add(x.s + ":" + d); rf.push({ type: "Feature", properties: { icon: this.iconFor(x.s, x.dir, t, x), next: x === nextX }, geometry: { type: "Point", coordinates: x.mid || x.at } }); }
    }
    const nf = [];
    if (z >= this.NEAR_ZOOM) for (const c of this.nearList()) {
      if (onRoute.has(c.s + ":" + c.dir) || !b.contains(c.ll)) continue;
      const icon = this.iconFor(c.s, c.dir, t); if (icon === "sv-unk") continue;   // 주변은 상태를 아는 신호만
      nf.push({ type: "Feature", properties: { icon }, geometry: { type: "Point", coordinates: c.ll } });
      if (nf.length > 250) break;
    }
    const key = JSON.stringify([rf, nf]);
    if (key !== this.last) { this.last = key; map.getSource("sv-route").setData({ type: "FeatureCollection", features: rf }); map.getSource("sv-near").setData({ type: "FeatureCollection", features: nf }); }
    this.legend(rf.length + nf.length > 0);
  },
  // 신뢰도 표시: 지금 아이콘이 무엇에 근거하는지(실시간 승인 전에는 패턴 예상)
  legend(on) {
    const el = $("sig-legend"); if (!el) return;
    el.hidden = !on;
    if (!on) return;
    const live = typeof LIVE !== "undefined" && LIVE.cfg?.enabled && LIVE.markers?.size;
    setText("sig-src", live ? "실시간" : `패턴 예상 ${planPeriodText().replace(" 신호 기록 기준 추정", "")}`);
    el.querySelector(".lg-dot").classList.toggle("live", !!live);
  },
  // 결과 화면: 선택한 길의 첫 신호 횡단에 '다음 횡단보도' 말풍선
  showCallout() {
    this.callout?.remove(); this.callout = null;
    const r = this.route(); if (!r || current !== "result") return;
    const x = r.x.find(this.isCrossing); if (!x) return;
    const t0 = state.mode === "actual" ? kstSec() : BASE, v = this.verdict(x, t0 + x.d / SPEED);
    if (v.kind === "unknown") return;   // 모르는 곳은 아이콘(?)만. 말풍선으로 지도를 가리지 않는다
    const e = el(`sv-call ${v.kind}`, `<small>다음 횡단보도 · 출발 후 ${km(x.d)}</small><b>${esc(v.label)}</b><span>${esc(v.text)}</span>`);
    // 화면 가장자리면 말풍선을 안쪽으로 펼친다(잘리지 않게)
    const px = map.project(x.mid || x.at).x, w = map.getContainer().clientWidth, anchor = px < 110 ? "bottom-left" : px > w - 110 ? "bottom-right" : "bottom";
    this.callout = new maplibregl.Marker({ element: e, anchor, offset: [0, -16] }).setLngLat(x.mid || x.at).addTo(map);
    dynMarkers.push(this.callout);
  },
  start() { if (!this.timer) this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.warn(e); } }, 1000); },
};
