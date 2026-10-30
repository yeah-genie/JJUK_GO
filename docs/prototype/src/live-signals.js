// ---------- 실시간 보행 신호 지도(검증된 횡단보도만) ----------
// 서버(/api/signal-live)가 '켜짐'이고 검증된 횡단보도가 있을 때만 동작한다. 지금 production은 꺼져 있어 아무것도 그리지 않는다.
// 의미 구분: 이 표시는 '제공기관이 마지막으로 관측한 신호'다. 횡단 시간 지도(내 속도로 건너는 시간)·예상 신호 대기(과거 기록 추정)와 색·모양을 따로 쓴다.
// 갱신: 화면에 보이는 검증된 횡단보도만 주기적으로 묻고, 바뀐 마커만 고친다. 탭이 숨겨지면 멈추고 돌아오면 바로 다시 묻는다.
// 지도 중심·확대·열어 둔 설명창은 갱신 때문에 바뀌지 않는다(마커 내용만 바뀜). 0초가 됐다고 다음 색을 지어내지 않는다.
var LIVE = {   // var: app.js의 boot()가 이 파일보다 먼저 실행돼 typeof LIVE로 확인할 수 있게(const면 초기화 전 접근 오류)
  cfg: null, markers: new Map(), timer: null, busy: false, popup: null, MIN_ZOOM: 16,
  LEG_KO: { n: "북쪽", e: "동쪽", s: "남쪽", w: "서쪽" },
  REASON: { direction_unverified: "방향 확인 안 됨", stale: "갱신 지연", unmeasured: "지연 기준 측정 전", unavailable: "신호 정보 없음", clock_skew: "시각 확인 안 됨", unknown: "신호 정보 없음", dark: "신호 꺼짐", flash_unverified: "점멸 의미 확인 중" },
  async init() {
    try { const r = await fetch("/api/signal-live?config=1"); if (!r.ok) return; this.cfg = await r.json(); } catch { return; }
    if (!this.cfg.enabled || !this.cfg.crosswalks.length) return;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.tick(true); else this.stop(); });
    this.sync();
  },
  active() { return !!(this.cfg?.enabled && map && ["home", "result", "walk"].includes(current) && map.getZoom() >= this.MIN_ZOOM && !XW.on); },
  visible() { const b = map.getBounds(); return this.cfg.crosswalks.filter(c => b.contains(c.ll)); },
  sync() {
    if (!this.cfg?.enabled) return;
    if (!this.active()) { this.clear(); this.stop(); return; }
    this.tick(true);
  },
  stop() { clearTimeout(this.timer); this.timer = null; },
  clear() { for (const m of this.markers.values()) m.remove(); this.markers.clear(); this.popup?.remove(); this.popup = null; },
  async tick(now) {
    this.stop();
    if (!this.active() || document.hidden) return;
    const cws = this.visible(), ids = [...new Set(cws.map(c => c.id))].slice(0, 5);
    for (const [k, m] of this.markers) if (!cws.some(c => c.id + ":" + c.leg === k)) { m.remove(); this.markers.delete(k); }
    if (ids.length && !this.busy) {
      this.busy = true;
      try {
        const r = await fetch("/api/signal-live?ids=" + ids.join(","));
        const data = await r.json(); this.skew = data.server_now - Date.now(); this.paint(cws, data);
      } catch { this.paint(cws, null); } finally { this.busy = false; }
    }
    this.timer = setTimeout(() => this.tick(), Math.max(5, this.cfg.poll_hint_s || 15) * 1000);
  },
  view(item, leg) {
    if (!item) return { cls: "neutral", label: "?", text: "연결 안 됨" };
    const v = item.legs?.[leg];
    if (!v) return { cls: "neutral", label: "?", text: this.REASON[item.status] || "신호 정보 없음" };
    if (v.state === "walk") return { cls: "walk", label: "보행", text: "보행 신호" };
    if (v.state === "stop") return { cls: "stop", label: "정지", text: "정지 신호" };
    return { cls: "neutral", label: "?", text: this.REASON[v.reason] || "신호 정보 없음" };
  },
  paint(cws, data) {
    const items = new Map((data?.items || []).map(i => [i.id, i])), mock = !!data?.mock;
    for (const c of cws) {
      const k = c.id + ":" + c.leg, it = items.get(c.id), v = this.view(it, c.leg);
      const key = v.cls + v.label + (mock ? "m" : "");
      let m = this.markers.get(k);
      if (!m) {
        const e = el("m-live", ""); e.setAttribute("role", "button"); e.tabIndex = 0;
        e.addEventListener("click", ev => { ev.stopPropagation(); this.open(c); });
        m = new maplibregl.Marker({ element: e }).setLngLat(c.ll).addTo(map); this.markers.set(k, m);
      }
      const e = m.getElement();
      if (e.dataset.key !== key) {   // 바뀐 마커만 고친다
        e.dataset.key = key; e.classList.remove("walk", "stop", "neutral"); e.classList.add(v.cls);   // className을 통째로 바꾸면 지도 라이브러리의 마커 클래스가 지워진다
        e.innerHTML = `<span class="ml-shape" aria-hidden="true"></span><b>${v.label}</b>${mock ? "<i>시험</i>" : ""}`;
        e.setAttribute("aria-label", `${c.name} ${this.LEG_KO[c.leg]} 횡단보도 ${v.text}`);
      }
      m.info = { c, it, v, mock };
      if (this.popup && this.popup.k === k) this.fill(this.popup, m.info);   // 열어 둔 설명창은 닫지 않고 내용만 갱신
    }
  },
  open(c) {
    const k = c.id + ":" + c.leg, m = this.markers.get(k); if (!m) return;
    this.popup?.remove();
    this.popup = new maplibregl.Popup({ closeButton: true, offset: 14, className: "live-pop" }).setLngLat(c.ll).addTo(map);
    this.popup.k = k; this.popup.on("close", () => { if (this.popup?.k === k) this.popup = null; });
    this.fill(this.popup, m.info);
  },
  fill(p, info) {
    const { c, it, v, mock } = info || {}, t = it?.src_ts;
    const ago = t ? Math.max(0, Math.round((Date.now() + (this.skew || 0) - t) / 1000)) : null;
    p.setHTML(`<b>${esc(c.name)} · ${this.LEG_KO[c.leg]} 횡단보도</b><span>${esc(v.text)}${mock ? " · 시험 데이터(실제 신호 아님)" : ""}</span>` +
      `<small>${t ? `원천 관측 ${new Date(t).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })} · ${ago}초 전` : "관측 시각 없음"}</small>` +
      `<small>지금 불과 다를 수 있어요. 건널지는 실제 신호를 보고 정해 주세요.</small>`);
  },
};
