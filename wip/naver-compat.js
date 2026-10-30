// ---------- 네이버 지도 엔진 (2026-10-30 사용자 결정: 네이버 지도 API 사용) ----------
// 앱은 MapLibre 함수 이름(map.getSource().setData, new maplibregl.Marker 등)으로 지도를 다룬다.
// 네이버 지도를 쓸 수 있으면 같은 이름의 함수를 네이버 지도로 흉내 내는 '번역 층'을 maplibregl 자리에 넣는다.
// 키(Client ID)는 Vercel 환경변수 NAVER_MAP_KEY_ID → /api/map-config로 받는다(네이버 지도 키는 페이지에 드러나는 공개 키이고, 등록한 도메인에서만 동작).
// 키가 없거나 인증이 실패하면 기존 MapLibre 지도를 그대로 쓴다.
// 줌: MapLibre(512px 타일) z ≈ 네이버 z-1. 이 층은 MapLibre 기준 줌으로 주고받는다.
var NAVER = {   // var: app.js의 boot()가 먼저 실행된다
  ready: false,
  async load() {
    let key = null;
    try { const r = await fetch("/api/map-config", { signal: AbortSignal.timeout(4000) }); if (r.ok) key = (await r.json()).naver_key_id; } catch {}
    if (!key) return false;
    const ok = await new Promise(resolve => {
      const t = setTimeout(() => resolve(false), 8000);
      window.navermap_authFailure = () => { clearTimeout(t); NAVER.authFailed = true; resolve(false); };
      window.__naverReady = () => { clearTimeout(t); resolve(true); };
      const s = document.createElement("script");
      s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(key)}&callback=__naverReady`;
      s.onerror = () => { clearTimeout(t); resolve(false); };
      document.head.appendChild(s);
    });
    if (!ok || !window.naver?.maps) return false;
    this.ready = true; window.maplibregl = NaverGL; return true;
  },
};

const NaverGL = (() => {
  const LL = ([lng, lat]) => new naver.maps.LatLng(lat, lng);
  const toLL = c => [c.lng(), c.lat()];
  // 앵커(center/bottom/left…)와 offset은 감싼 상자를 CSS로 옮겨 흉내 낸다(네이버 아이콘 기준점은 왼쪽 위)
  const SHIFT = { center: "-50%,-50%", bottom: "-50%,-100%", top: "-50%,0", left: "0,-50%", right: "-100%,-50%", "bottom-left": "0,-100%", "bottom-right": "-100%,-100%", "top-left": "0,0", "top-right": "-100%,0" };
  function wrap(element, anchor = "center", offset = [0, 0]) {
    const box = document.createElement("div"); box.style.position = "relative";
    const inner = document.createElement("div"); inner.style.cssText = `position:absolute;left:0;top:0;transform:translate(${SHIFT[anchor] || SHIFT.center}) translate(${offset[0]}px,${offset[1]}px)`;
    inner.appendChild(element); box.appendChild(inner); return box;
  }
  class Marker {
    constructor(o = {}) { this.el = o.element || document.createElement("div"); this.anchor = o.anchor || "center"; this.offset = o.offset || [0, 0]; this.ll = null; this.m = null; }
    setLngLat(ll) { this.ll = Array.isArray(ll) ? ll : [ll.lng, ll.lat]; if (this.m) this.m.setPosition(LL(this.ll)); return this; }
    getLngLat() { return { lng: this.ll[0], lat: this.ll[1], toArray: () => this.ll }; }
    getElement() { return this.el; }
    addTo(map) { this.map = map; this.m = new naver.maps.Marker({ position: LL(this.ll), map: map.nm, icon: { content: wrap(this.el, this.anchor, this.offset), anchor: new naver.maps.Point(0, 0) }, clickable: true, zIndex: 100 }); return this; }
    remove() { if (this.m) { this.m.setMap(null); this.m = null; } return this; }
  }
  class Popup {
    constructor(o = {}) { this.o = o; this.el = document.createElement("div"); this.el.className = "maplibregl-popup " + (o.className || ""); this.el.innerHTML = `<div class="maplibregl-popup-content"></div>`; this.handlers = {}; }
    setLngLat(ll) { this.ll = Array.isArray(ll) ? ll : [ll.lng, ll.lat]; if (this.mk) this.mk.setLngLat(this.ll); return this; }
    setHTML(h) { const c = this.el.firstChild; c.innerHTML = h + (this.o.closeButton === false ? "" : `<button class="maplibregl-popup-close-button" aria-label="닫기">×</button>`); c.querySelector(".maplibregl-popup-close-button")?.addEventListener("click", e => { e.stopPropagation(); this.remove(); }); return this; }
    addTo(map) { this.mk = new Marker({ element: this.el, anchor: "bottom", offset: [0, -(this.o.offset || 10)] }).setLngLat(this.ll).addTo(map); return this; }
    on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
    remove() { if (this.mk) { this.mk.remove(); this.mk = null; (this.handlers.close || []).forEach(f => f()); } return this; }
  }
  class LngLatBounds {
    constructor(a, b) { this.w = a[0]; this.s = a[1]; this.e = (b || a)[0]; this.n = (b || a)[1]; }
    extend(c) { this.w = Math.min(this.w, c[0]); this.e = Math.max(this.e, c[0]); this.s = Math.min(this.s, c[1]); this.n = Math.max(this.n, c[1]); return this; }
  }
  // 앱이 쓰는 지도 층(source id)마다 네이버 도형으로 그린다
  const ROUTE_STYLE = { rj: { color: "#F6C343", w: 7, z: 30 }, rs: { color: "#959EAC", w: 5, z: 20 } };
  const ICON_PX = { next: 38, route: 30, near: 18 };
  class NMap {
    constructor(o) {
      this.container = o.container; this.handlers = {}; this.images = {}; this.shapes = {}; this.pts = {}; this.data = {}; this.hidden = {};
      this.nm = new naver.maps.Map(o.container, { center: LL(o.center), zoom: Math.round(o.zoom + 1), minZoom: (o.minZoom || 10) + 1, maxZoom: Math.min(21, (o.maxZoom || 19) + 1),
        scaleControl: true, scaleControlOptions: { position: naver.maps.Position.BOTTOM_RIGHT }, logoControlOptions: { position: naver.maps.Position.BOTTOM_LEFT },
        mapDataControl: false, zoomControl: false, mapTypeControl: false, disableKineticPan: false });
      this.touchZoomRotate = { disableRotation() {} };
      naver.maps.Event.once(this.nm, "init", () => this.emit("load"));
      naver.maps.Event.addListener(this.nm, "idle", () => this.emit("moveend"));
      naver.maps.Event.addListener(this.nm, "click", e => { const p = this.nm.getProjection().fromCoordToOffset(e.coord); this.emit("click", { lngLat: { lng: e.coord.lng(), lat: e.coord.lat() }, point: { x: p.x, y: p.y } }); });
      naver.maps.Event.addListener(this.nm, "zoom_changed", () => this.redrawPoints());
    }
    emit(ev, arg) { for (const f of this.handlers[ev] || []) f(arg); }
    on(ev, a, b) { if (typeof a === "function") (this.handlers[ev] ||= []).push(a); return this; }   // 층 이름을 받는 mouseenter 등은 쓰지 않는다
    once(ev, fn) { const g = x => { this.handlers[ev] = this.handlers[ev].filter(h => h !== g); fn(x); }; return this.on(ev, g); }
    loaded() { return true; } isMoving() { return false; }
    getZoom() { return this.nm.getZoom() - 1; } getBearing() { return 0; } resetNorth() {}
    zoomIn() { this.nm.setZoom(this.nm.getZoom() + 1, true); } zoomOut() { this.nm.setZoom(this.nm.getZoom() - 1, true); }
    getContainer() { return this.container; } getCanvas() { return this.container; }
    resize() { const r = this.container.getBoundingClientRect(); if (r.width && r.height) this.nm.setSize(new naver.maps.Size(r.width, r.height)); }
    getCenter() { const c = this.nm.getCenter(); return { lng: c.lng(), lat: c.lat(), toArray: () => [c.lng(), c.lat()] }; }
    jumpTo(o) { if (o.center) this.nm.setCenter(LL(o.center)); if (o.zoom != null) this.nm.setZoom(Math.round(o.zoom + 1), false); }
    easeTo(o) { if (o.center && o.zoom != null) this.nm.morph(LL(o.center), Math.round(o.zoom + 1)); else if (o.center) this.nm.panTo(LL(o.center)); else if (o.zoom != null) this.nm.setZoom(Math.round(o.zoom + 1), true); }
    fitBounds(b, o = {}) {
      const p = typeof o.padding === "number" ? { top: o.padding, right: o.padding, bottom: o.padding, left: o.padding } : (o.padding || {});
      this.nm.fitBounds(new naver.maps.LatLngBounds(new naver.maps.LatLng(b.s, b.w), new naver.maps.LatLng(b.n, b.e)), { top: p.top || 0, right: p.right || 0, bottom: p.bottom || 0, left: p.left || 0 });
      if (o.maxZoom != null && this.nm.getZoom() > o.maxZoom + 1) this.nm.setZoom(o.maxZoom + 1, false);
    }
    getBounds() {
      const b = this.nm.getBounds(), sw = b.getSW(), ne = b.getNE();
      return { contains: c => c[0] >= sw.lng() && c[0] <= ne.lng() && c[1] >= sw.lat() && c[1] <= ne.lat(), getWest: () => sw.lng(), getSouth: () => sw.lat(), getEast: () => ne.lng(), getNorth: () => ne.lat() };
    }
    project(ll) { const p = this.nm.getProjection().fromCoordToOffset(LL(Array.isArray(ll) ? ll : [ll.lng, ll.lat])); return { x: p.x, y: p.y }; }
    queryRenderedFeatures() { return []; }
    addControl() {} setPaintProperty() {}
    addImage(name, img) { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").putImageData(img, 0, 0); this.images[name] = c.toDataURL(); }
    hasImage(name) { return !!this.images[name]; }
    addSource(id) { this.data[id] ||= { type: "FeatureCollection", features: [] }; }
    addLayer() {}
    getSource(id) { const self = this; this.data[id] ||= { type: "FeatureCollection", features: [] }; return { get _data() { return self.data[id]; }, setData(d) { self.data[id] = d; self.draw(id); } }; }
    setLayoutProperty(id, prop, v) { if (prop === "visibility") { this.hidden[id] = v === "none"; this.draw(id); } }
    draw(id) {
      if (ROUTE_STYLE[id]) return this.drawLines(id);
      if (id === "sv-route" || id === "sv-near") return this.drawPoints(id);
      // 횡단 시간 지도(xw)·서비스 범위(cov)·신호 점(sigall)은 네이버 지도에서는 그리지 않는다
    }
    drawLines(id) {
      for (const s of this.shapes[id] || []) s.setMap(null);
      const st = ROUTE_STYLE[id], out = [];
      for (const f of this.data[id].features || []) {
        const path = (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates).map(line => line.map(LL));
        for (const p of path) {
          const under = f.properties && "u" in f.properties;
          if (!under) out.push(new naver.maps.Polyline({ map: this.nm, path: p, strokeColor: "#2A3140", strokeOpacity: .85, strokeWeight: st.w + 4, strokeLineCap: "round", strokeLineJoin: "round", zIndex: st.z }));
          out.push(new naver.maps.Polyline({ map: this.nm, path: p, strokeColor: under ? "#2A3140" : st.color, strokeWeight: under ? 3 : st.w, strokeStyle: under ? "shortdash" : "solid", strokeLineCap: "round", strokeLineJoin: "round", zIndex: st.z + 1 }));
        }
      }
      this.shapes[id] = out;
    }
    // 신호 아이콘: 좌표마다 표시 하나를 두고 아이콘이 바뀔 때만 고친다(1초마다 다시 만들지 않게)
    drawPoints(id) {
      const pts = (this.pts[id] ||= new Map()), seen = new Set(), z = this.getZoom();
      const show = !this.hidden[id] && !(id === "sv-near" && z < 15.2) && !(id === "sv-route" && z < 12.5);
      for (const f of show ? this.data[id].features || [] : []) {
        const c = f.geometry.coordinates, key = c.join(","), icon = f.properties.icon, px = f.properties.next ? ICON_PX.next : id === "sv-near" ? ICON_PX.near : ICON_PX.route;
        seen.add(key);
        const sig = icon + px, cur = pts.get(key);
        if (cur && cur.sig === sig) continue;
        const html = `<img src="${this.images[icon] || ""}" width="${px}" height="${px}" style="display:block;transform:translate(-50%,-50%);${id === "sv-near" ? "opacity:.6" : ""}" alt="">`;
        if (cur) { cur.m.setIcon({ content: html, anchor: new naver.maps.Point(0, 0) }); cur.sig = sig; }
        else pts.set(key, { sig, m: new naver.maps.Marker({ map: this.nm, position: LL(c), icon: { content: html, anchor: new naver.maps.Point(0, 0) }, clickable: false, zIndex: id === "sv-near" ? 40 : 60 }) });
      }
      for (const [k, v] of pts) if (!seen.has(k)) { v.m.setMap(null); pts.delete(k); }
    }
    redrawPoints() { for (const id of ["sv-route", "sv-near"]) if (this.data[id]) this.drawPoints(id); }
  }
  return { Map: NMap, Marker, Popup, LngLatBounds, ScaleControl: class {}, addProtocol() {} };
})();
