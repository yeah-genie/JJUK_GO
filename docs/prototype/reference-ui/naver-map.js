/* Display adapter only: route selection and signal evidence remain in the walking engine. */
(function (root) {
  'use strict';
  let loading = null, loadingKey = null, loadedKey = null, attempt = 0;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validLL = ll => Array.isArray(ll) && ll.length >= 2 && ll.slice(0,2).every(Number.isFinite) && Math.abs(ll[0]) <= 180 && Math.abs(ll[1]) <= 90;
  const icon = name => `<span class="mi" aria-hidden="true">${name}</span>`;
  const sdkReady = () => ['Map','LatLng','Marker','Polyline','Size','Point'].every(name => typeof root.naver?.maps?.[name] === 'function')
    && typeof root.naver?.maps?.Event?.once === 'function' && typeof root.naver?.maps?.Event?.removeListener === 'function';

  function load(clientId) {
    const key = typeof clientId === 'string' ? clientId.trim() : '';
    if (!/^[A-Za-z0-9_-]{5,128}$/.test(key)) return Promise.reject(new Error('네이버 지도 Client ID가 아직 설정되지 않았어요.'));
    if (loading) return key === loadingKey ? loading : Promise.reject(new Error('다른 네이버 지도 설정을 불러오는 중이에요.'));
    if (sdkReady() && loadedKey) {
      if (loadedKey && loadedKey !== key) return Promise.reject(new Error('지도 Client ID를 바꾸려면 화면을 새로 열어 주세요.'));
      return Promise.resolve(root.naver.maps);
    }
    const callback = '__jjukgoNaverReady' + (++attempt);
    let resolveLoad, rejectLoad;
    const promise = new Promise((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject; });
    loading = promise; loadingKey = key;
    const script = document.createElement('script');
    const previousAuthFailure = root.navermap_authFailure;
    let settled = false, callbackSeen = false, readyPoll = null;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(readyPoll);
      loading = null; loadingKey = null;
      script.onerror = null;
      script.onload = null;
      // A timed-out SDK may still invoke its callback. It must not resolve a later attempt.
      root[callback] = () => {};
      if (root.navermap_authFailure === authFailure) root.navermap_authFailure = previousAuthFailure;
      if (error) { script.remove(); rejectLoad(error); }
      else { loadedKey = key; resolveLoad(root.naver.maps); }
    };
    const authFailure = () => {
      finish(new Error('네이버 지도 인증을 확인해 주세요. Client ID와 등록 도메인을 확인해야 해요.'));
      if (typeof previousAuthFailure === 'function') previousAuthFailure();
    };
    const checkReady = () => {
      if (settled) return;
      clearTimeout(readyPoll);
      if (callbackSeen && sdkReady()) { finish(null); return; }
      // Readiness is checked within the original 12s deadline, never assumed from HTTP load.
      readyPoll = setTimeout(checkReady,50);
    };
    root.navermap_authFailure = authFailure;
    root[callback] = () => { callbackSeen = true; checkReady(); };
    const timer = setTimeout(() => finish(new Error('네이버 지도 연결이 늦어져 기존 지도를 사용해요.')), 12000);
    script.async = true;
    script.src = 'https://oapi.map.naver.com/openapi/v3/maps.js?' + new URLSearchParams({ncpKeyId:key,callback,language:'ko'});
    script.onerror = () => finish(new Error('네이버 지도를 불러오지 못했어요. 기존 지도를 사용해요.'));
    script.onload = checkReady;
    document.head.append(script);
    return promise;
  }

  function render(container, options = {}) {
    const n = root.naver?.maps;
    if (!n?.Map) throw new Error('네이버 지도 SDK를 먼저 준비해 주세요.');
    if (typeof n.Event?.once !== 'function' || typeof n.Event?.removeListener !== 'function') throw new Error('네이버 지도 이벤트 준비를 완료하지 못했어요.');
    if (!container || container.nodeType !== 1) throw new TypeError('지도 컨테이너가 필요해요.');
    // The SDK may rewrite the overlay's inline layout; the visible host owns its size.
    const host = container.parentElement || container;
    const dimensions = () => {
      const rect = host.getBoundingClientRect?.();
      const width = Math.round(rect?.width ?? host.clientWidth);
      const height = Math.round(rect?.height ?? host.clientHeight);
      return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? {width,height} : null;
    };
    let size = dimensions();
    if (!size) throw new Error('지도 영역이 아직 준비되지 않았어요. 기존 지도를 사용해요.');
    const coords = (Array.isArray(options.coords) ? options.coords : []).filter(validLL).map(ll => [ll[0],ll[1]]);
    const latLng = ll => new n.LatLng(ll[1],ll[0]);
    const origin = validLL(options.currentLL) ? options.currentLL : coords[0] || [126.97799,37.56562];
    const map = new n.Map(container, {center:latLng(origin),zoom:16,minZoom:10,maxZoom:19,size:new n.Size(size.width,size.height),
      zoomControl:false,scaleControl:true,logoControl:true,mapDataControl:true});
    const overlays = [], signalMarkers = [], signalListeners=[];
    let signalPopup=null, selectedSignal=null;
    let destroyed = false;
    let readyDone = false, readyListener = null, readyTimer = null, resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const finishReady = loaded => {
      if (readyDone) return;
      readyDone = true;
      clearTimeout(readyTimer);
      if (readyListener) n.Event.removeListener(readyListener);
      readyListener = null;
      resolveReady(loaded);
    };
    readyListener = n.Event.once(map,'tilesloaded',() => finishReady(true));
    if (!readyDone) readyTimer = setTimeout(() => finishReady(false),12000);
    else { n.Event.removeListener(readyListener); readyListener = null; }
    const addMarker = (ll, html, size, zIndex = 10) => {
      if (!validLL(ll)) return null;
      const marker = new n.Marker({map,position:latLng(ll),zIndex,
        icon:{content:html,size:new n.Size(size,size),anchor:new n.Point(size/2,size/2)}});
      overlays.push(marker);
      return marker;
    };
    const statusOf = x => {
      const supported = x && (x.trusted === true || options.sample === true);
      return supported && x.state === 'walk' ? 'walk' : supported && x.state === 'wait' ? 'wait' : 'unknown';
    };
    const classes = {walk:'',wait:'red',unknown:'gray'};
    const signalHTML = (x, large = false) => {
      const state = statusOf(x), size = large ? 45 : options.summary ? 28 : 25;
      const history=state==='unknown'&&!!x.historyLabel;
      let html = `<button type="button" data-ref-signal-key="${escape(x.key||'')}" aria-label="${escape(x.label||'횡단보도')} 신호 정보${history?' · 과거 기록, 현재 신호 아님':''}" class="signal-disc ${history?'history':classes[state]}${x.trusted?' estimated':''}${large?'':options.summary?' summary-marker':' faded'}">${icon(history?'history':'directions_walk')}</button>`;
      if (large) {
        const distance = Number.isFinite(x.distanceM) ? Math.max(0,Math.round(x.distanceM))+'m' : x.historyLabel?'과거 기록':x.crossingLength?'약 '+x.crossingLength+'m 횡단':'신호 위치';
        const remaining = Number.isFinite(x.remainingSeconds) ? Math.max(0,Math.floor(x.remainingSeconds)) : null;
        const message = x.secondsLabel || (state === 'walk' && remaining !== null ? `초록 예상 · ${remaining}초 남음` : state === 'wait' ? '대기 예상 · 현장 신호 확인' : '현장 신호를 확인하세요');
        html = `<div class="crossing-marker"><div class="signal-callout"><small>${escape(x.label || '다음 횡단보도')}</small><strong>${distance}</strong><p style="color:${state==='walk'?'#2FA866':state==='wait'?'#D9443F':'#718096'}">${message}</p></div>${html}</div>`;
      }
      return {content:html,size:new n.Size(size,size),anchor:new n.Point(size/2,size/2)};
    };
    const signal = (x,large=false) => {
      const initial=signalHTML(x,large),marker=new n.Marker({map,position:latLng(x.ll),zIndex:large?100:10,icon:initial});
      const entry={item:x,marker,large,html:initial.content};signalMarkers.push(entry);overlays.push(marker);
      entry.listener=n.Event.addListener(marker,'click',()=>options.onSignalClick?.(entry.item));
      signalListeners.push(entry.listener);
      return marker;
    };
    if (coords.length > 1) {
      const path = coords.map(latLng);
      for (const [strokeColor,strokeWeight] of [['#FFFFFF',10],['#4D8FFF',6]]) {
        overlays.push(new n.Polyline({map,path,strokeColor,strokeWeight,strokeOpacity:1,strokeLineCap:'round',strokeLineJoin:'round'}));
      }
      map.fitBounds(path,options.summary ? {top:35,right:35,bottom:35,left:35,maxZoom:17} : {top:180,right:70,bottom:85,left:55,maxZoom:17});
    }
    for (const x of Array.isArray(options.crossings) ? options.crossings : []) if (x && validLL(x.ll) && x.key!==options.next?.key) signal(x);
    if (options.next && validLL(options.next.ll)) signal(options.next,true);
    let currentMarker = null;
    if (validLL(options.currentLL)) currentMarker=addMarker(options.currentLL,'<div class="m-me"></div>',28,110);
    if (coords.length && options.endpointHTML) {
      addMarker(coords[0],options.endpointHTML.from,36,120);
      addMarker(coords.at(-1),options.endpointHTML.to,36,120);
    }
    const viewportListener=options.onViewportChange?n.Event.addListener(map,'idle',()=>{
      if(destroyed)return;
      const center=map.getCenter();options.onViewportChange([center.lng(),center.lat()]);
    }):null;
    const resize = () => {
      if (destroyed) return;
      const nextSize = dimensions();
      if (!nextSize || (nextSize.width === size.width && nextSize.height === size.height)) return;
      size = nextSize;
      map.setSize(new n.Size(size.width,size.height));
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(host);
    return {
      map,
      ready,
      showSignal(item){
        if(destroyed)return;
        selectedSignal=item;
        if(!signalPopup)signalPopup=new n.InfoWindow({content:'',maxWidth:235,disableAutoPan:true,borderWidth:0,backgroundColor:'#FCFBF7',anchorColor:'#FCFBF7',anchorSize:new n.Size(12,10),pixelOffset:new n.Point(0,-23)});
        if(typeof map.setCenter==='function')map.setCenter(latLng(item.ll));
        if(typeof map.panBy==='function')map.panBy(new n.Point(0,-Math.max(70,size.height/2-60)));
        signalPopup.setContent(options.signalHTML(item));signalPopup.open(map,latLng(item.ll));
        const close=signalPopup.getContentElement()?.querySelector('[data-ref-action="close-signal"]');
        if(close)close.onclick=e=>{e.preventDefault();e.stopPropagation();options.onSignalClose?.();};
        const preview=signalPopup.getContentElement()?.querySelector('[data-ref-action="preview-pattern"]');
        if(preview)preview.onclick=e=>{e.preventDefault();e.stopPropagation();options.onPatternReplay?.();};
        host.classList.add('signal-detail-open');
      },
      closeSignal(){signalPopup?.close();selectedSignal=null;host.classList.remove('signal-detail-open');},
      updateSignals(items){
        if(destroyed)return;
        const byKey=new Map(items.map(x=>[x.key,x]));
        for(let i=signalMarkers.length-1;i>=0;i--){
          const entry=signalMarkers[i];if(byKey.has(entry.item.key))continue;
          entry.marker.setMap(null);n.Event.removeListener(entry.listener);
          signalListeners.splice(signalListeners.indexOf(entry.listener),1);
          overlays.splice(overlays.indexOf(entry.marker),1);signalMarkers.splice(i,1);
        }
        const existing=new Set(signalMarkers.map(x=>x.item.key));
        for(const item of items)if(validLL(item.ll)&&!existing.has(item.key))signal(item,item.key===options.next?.key);
        const buttons=Array.from(container.querySelectorAll?.('button[data-ref-signal-key]')||[]);
        for(const entry of signalMarkers){
          const item=byKey.get(entry.item.key);if(!item)continue;entry.item=item;const nextIcon=signalHTML(item,entry.large);
          if(nextIcon.content===entry.html)continue;
          const button=buttons.find(b=>b.dataset.refSignalKey===item.key);
          if(button){
            const state=statusOf(item),history=state==='unknown'&&!!item.historyLabel;
            button.className=`signal-disc ${history?'history':classes[state]}${item.trusted?' estimated':''}${entry.large?'':options.summary?' summary-marker':' faded'}`;
            button.setAttribute('aria-label',(item.label||'횡단보도')+' 신호 정보'+(history?' · 과거 기록, 현재 신호 아님':''));
            const iconNode=button.querySelector('.mi');if(iconNode)iconNode.textContent=history?'history':'directions_walk';
            const callout=button.closest('.crossing-marker');if(callout){const text=callout.querySelector('p');if(text){text.textContent=item.secondsLabel;text.style.color=state==='walk'?'#2FA866':state==='wait'?'#D9443F':'#718096';}}
          }else entry.marker.setIcon(nextIcon);
          entry.html=nextIcon.content;
        }
        if(selectedSignal&&signalPopup){const current=byKey.get(selectedSignal.key);if(current){selectedSignal=current;const node=signalPopup.getContentElement(),strong=node?.querySelector('[data-signal-value]'),p=node?.querySelector('p');if(strong)strong.textContent=options.signalTitle?.(current)||(current.trusted?current.secondsLabel:current.statusLabel);if(p)p.textContent=options.signalDescription?.(current)||current.reason;}}
      },
      resize,
      fitRoute() { if (!destroyed && coords.length > 1) map.fitBounds(coords.map(latLng), options.summary ? {top:35,right:35,bottom:35,left:35,maxZoom:17} : {top:180,right:70,bottom:85,left:55,maxZoom:17}); },
      center(ll, zoom) { if (!destroyed && validLL(ll)) { map.setCenter(latLng(ll)); if (Number.isFinite(zoom)) map.setZoom(zoom,false); } },
      setCurrent(ll) {
        if (destroyed || !validLL(ll)) return;
        if (currentMarker) currentMarker.setPosition(latLng(ll));
        else currentMarker=addMarker(ll,'<div class="m-me"></div>',28,110);
      },
      destroy() {
        if (destroyed) return;
        destroyed=true;finishReady(false);signalPopup?.close();if(viewportListener)n.Event.removeListener(viewportListener);signalListeners.forEach(l=>n.Event.removeListener(l));observer?.disconnect();overlays.forEach(x=>x.setMap(null));map.destroy();
      }
    };
  }
  root.JJUKGO_NAVER = Object.freeze({load,render});
})(window);
