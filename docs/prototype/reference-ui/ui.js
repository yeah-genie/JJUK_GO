/* Image-reference presentation adapter. Production sources and gates are unchanged. */
const refParams = new URLSearchParams(location.search);
const refSample = refParams.get('sample') === '1';
const refRoot = document.getElementById('reference-app');
const refIcon = name => `<span class="mi" aria-hidden="true">${name}</span>`;
const refPlaces = [
  {name:'낙산공원',sub:'서울 종로구 낙산길 41',ll:[127.0075,37.5806],kind:'공원'},
  {name:'대학로 마로니에공원',sub:'서울 종로구 대학로 104',ll:[127.0027,37.5803],kind:'공원'},
  {name:'동대문역사문화공원',sub:'서울 중구 을지로 281',ll:[127.0095,37.5665],kind:'공원'}
];
let refScreen='home', refPick='to', refSearchHits=[], refPaused=false, refSound=true, refNavigating=false;
let refMarkers=[], refRoute=null, refSearchSeq=0, refGPSMessage='', refNaverHandle=null, refMapEpoch=0, refSplashTimer=null, refDataStatus=null, refPendingRecenter=false;
let refSignals=[],refSignalMarkers=[],refSignalPopup=null,refSelectedSignal=null,refSignalFacts={};
let refProgress=null,refIgnoreUntil=0,refSettingsFromResult=false,refFindError=null,refArrivalCache={key:'',map:new Map()};
const refHistory=(id,d)=>{const f=refSignalFacts[id]?.[d];return f?.[dayTypeNow()]||f?.wd||f?.we||null;};
const refSignalModel=window.JJUKGO_SIGNAL_EVIDENCE.create({now:()=>SIG.now(),speed:()=>SPEED,meta:id=>SIGMETA.get(id),direction:d=>DIR_KO[d]||d,period:()=>planPeriodText(),plan:(...a)=>signalPlan(...a),history:refHistory,confidence:planConfidence,predict:(x,t)=>SIG.predictX(x,t),verdict:(...a)=>SIG.verdict(...a),arrival:x=>refArrival(x)});
// 경로 위 횡단에 '내가 도착할 때' 시각을 준다. 계획 화면은 지금 출발, 걷는 중은 내 위치에서 남은 거리 기준.
// 앞 횡단에서 기다릴 시간도 더해 경로의 예상 대기 계산(routeWaits)과 같은 방식으로 센다. 주변 신호와 위치를 모를 때는 null(지금 기준).
function refArrival(x){
 if(x.nearby||!Number.isFinite(x.d)||refScreen!=='walking')return null;
 const r=state.routes?.[state.focus];if(!r?.x?.includes(x))return null;
 const from=refNavigating?refProgress:0;if(from==null||x.d<from)return null;
 const now=SIG.now(),sp=refNavigating?(trackSpeed(walkTrack)||SPEED):SPEED,key=Math.floor(now)+':'+state.focus+':'+Math.round(from);
 if(refArrivalCache.key!==key){
  const map=new Map();let t=0;
  for(const c of r.x){if(c.d<from)continue;if(!c.dir&&c.dirs&&!c.dirs.length)continue;const at=now+(c.d-from)/sp+t;map.set(c,at);const w=crossingWait(c,at);if(w!=null)t+=w;}
  refArrivalCache={key,map};
 }
 return refArrivalCache.map.get(x)??null;
}
function refSignalTitle(item){return item.trusted?item.secondsLabel:item.historyLabel||(item.crossingLength?'지도상 횡단 약 '+item.crossingLength+'m':item.statusLabel);}
function refSignalDescription(item){return (item.geometrySummary?item.geometrySummary+' · ':'')+item.reason;}
function refSignalClass(item){return item.state==='wait'?'red':item.state==='walk'?'':item.historyLabel?'history':'gray';}
function refSignalHTML(item){return `<div class="signal-detail-card"><button data-ref-action="close-signal" aria-label="신호 정보 닫기">${refIcon('close')}</button><h3>${esc(item.label)}</h3><strong>${esc(refSignalTitle(item))}</strong><p>${esc(refSignalDescription(item))}</p><small>${esc(item.sourceLabel)} · 실시간 아님</small></div>`;}
const REF_POPUP_OFFSET=150;
function refCloseSignal(){refSignalPopup?.remove();refSignalPopup=null;refSelectedSignal=null;refNaverHandle?.closeSignal?.();refRoot.classList.remove('signal-detail-open');}
function refOpenSignal(item){
 refSelectedSignal=item;refRoot.classList.add('signal-detail-open');
 if(refNaverHandle&&refRoot.dataset.mapProvider==='naver'){refNaverHandle.showSignal(item);return;}
 refSignalPopup?.remove();refSignalPopup=new maplibregl.Popup({closeButton:false,offset:27,maxWidth:'245px',className:'reference-signal-popup'}).setLngLat(item.ll).setHTML(refSignalHTML(item)).addTo(map);
 map.easeTo({center:item.ll,offset:[0,REF_POPUP_OFFSET],duration:250});
}
function refMakeSignals(route,center=null){
 const raw=[...(route?.x||[]).filter(x=>x.dir||x.dirs?.length)];
 // Cross-count summaries have no controller/direction; do not invent a phase for them.
 for(const x of (route?.m?.xlist||[]).filter(x=>x.sig))if(!raw.some(r=>distLL(r.mid||r.at,x.at)<35))raw.push({...x,s:'unmapped',dir:null});
 // 계획 화면은 경로 위 신호만 보인다(주변 신호는 '어느 길이 나은지'와 상관없고 경로의 빨간불처럼 읽힌다).
 // 걷는 중에는 지금 보는 곳 근처 150m 안의 신호만 흐리게, 최대 8개.
 const near=center?[center]:[];
 const nearby=[];
 for(const[id,m]of SIGMETA)if(near.some(p=>distLL(p,m.ll)<150)){
  const dirs=['n','e','s','w'].filter(d=>signalPlan(id,SIG.now(),d)||refHistory(id,d));
  if(!dirs.length&&!raw.some(x=>String(x.s)===String(id)))nearby.push({s:id,dir:null,at:m.ll,len:null,nearby:true,locationOnly:true});
  for(const d of dirs){
   if(raw.some(x=>String(x.s)===String(id)&&(x.dir===d||x.dirs?.includes(d))))continue;
   nearby.push({s:id,dir:d,at:m.ll,len:null,nearby:true});
  }
 }
 nearby.sort((a,b)=>Number(!!trustedPlan(b.s,SIG.now(),b.dir))-Number(!!trustedPlan(a.s,SIG.now(),a.dir))||Math.min(...near.map(p=>distLL(p,a.at)))-Math.min(...near.map(p=>distLL(p,b.at))));
 raw.push(...nearby.slice(0,8));
 return raw.map(refSignalModel);
}
function refRefreshNearby(center){
 if(refSample||refScreen!=='walking'||!refNavigating)return;
 refSignals=refMakeSignals(state.routes?.[state.focus],center);
 refNaverHandle?.updateSignals(refSignals);
}
function refEndpointHTML(kind,name){
 const label=kind==='from'?'출발':'도착';
 return `<span class="route-endpoint ${kind}" role="img" aria-label="${label}: ${esc(name||label)}"><span class="endpoint-disc">${refIcon(kind==='from'?'trip_origin':'flag')}</span><small>${label}</small></span>`;
}
const refEngineWalk=renderWalk;
renderWalk=function(...args){if(refSample||refPaused||!refNavigating)return;return refEngineWalk(...args);};
const refEngineAlternative=pickAlternative;
function refTerrainKnown(route){return !!route?.steps?.length&&route.steps.every(([u,v,e])=>e.cls!==4&&Number.isFinite(G.node.get(u)?.h)&&Number.isFinite(G.node.get(v)?.h));}
pickAlternative=function(base,candidates,limit){
 const usual=refEngineAlternative(base,candidates,limit);
 if(!store.get('avoidSlope',true))return usual;
 if(!refTerrainKnown(base))return usual;
 const eligible=candidates.filter(r=>refTerrainKnown(r)&&!altRejectReason(r,base,limit));
 return eligible.sort((a,b)=>a.m.steep-b.m.steep||a.m.gain-b.m.gain||a.m.walk-b.m.walk)[0]||usual;
};
const refFixtureRoute = [
 [127.0060,37.5796],[127.0058,37.5802],[127.0055,37.58065],[127.0052,37.5808],
 [127.0050,37.5810],[127.0046,37.58125],[127.0042,37.5815],[127.0039,37.5818],
 [127.0034,37.5819],[127.0029,37.5822],[127.0026,37.5827],[127.0021,37.5832]
];
const refRecent = () => refSample ? refPlaces : store.get('recent',[]).slice(0,3);
function refToast(text){
 document.querySelector('.status-message')?.remove();
 const n=document.createElement('div');n.className='status-message';n.setAttribute('role','status');n.textContent=text;refRoot.append(n);
 const wb=refRoot.querySelector('.walk-bottom');
 if(wb&&refScreen==='walking')n.style.bottom=Math.max(20,refRoot.getBoundingClientRect().bottom-wb.getBoundingClientRect().top+12)+'px';
 setTimeout(()=>n.remove(),5000);
}
function refPace(){
 if(refSample)return {label:'보통 속도',value:'4.8',detail:'최근 7일간의 걸음 데이터를 분석했어요.'};
 const p=readProfile(),v=walkSpeed();
 const measured=!!p.learned.speed,manual=p.mode==='manual';
 return {label:manual?'직접 설정한 속도':measured?'학습한 내 속도':'아직 측정 전',value:(v*3.6).toFixed(1),pending:!measured&&!manual,detail:manual?'직접 정한 속도로 길을 계산해요.':p.autoEnabled===false?'자동 학습이 꺼져 있어 마지막 기준으로 계산해요.':measured?'측정한 걸음을 경로에 반영해요.':'처음엔 임시 기준으로, 걸으면 내 속도로 맞춰요.'};
}
function refHeader(title,back='home'){return `<header class="topbar"><button class="icon-button" data-ref-screen="${back}" aria-label="뒤로">${refIcon('chevron_left')}</button><h2>${title}</h2><span></span></header>`;}
function refRecentRows(rows,search=false){return rows.map((p,i)=>`<button class="recent-row" data-ref-recent="${i}">${refIcon('schedule')}<span class="row-copy"><strong>${esc(p.name)}</strong>${!search?`<small>${esc(p.sub||p.kind||'최근 찾은 장소')}</small>`:''}</span>${!search?refIcon('chevron_right'):''}</button>`).join('');}
function refHome(){
 const pace=refPace(),from=state.from;
 return `<section class="page home"><header class="topbar"><button class="icon-button" data-ref-screen="settings" aria-label="걷기 설정">${refIcon('settings')}</button></header>
 <h1>어디로 걸어갈까요?</h1><p class="small intro">${refSample?'신호를 고려한 더 스마트한 보행 경로를 안내해요.':'조금 더 걸어도, 계단과 횡단 부담이 덜한 길.'}</p>
 <div class="trip-inputs"><button class="place-input" data-ref-pick="from">${refIcon('circle').replace('class="mi"','class="mi origin-icon"')}<span class="place-text"><small>${refSample?'현재 위치':'출발지'}</small><strong id="ref-origin">${esc(from?.name||(refSample?'혜화역 (4호선)':'출발지를 선택하세요'))}</strong></span><span class="mi close">${refSample?'close':'chevron_right'}</span></button>
 <button class="place-input" data-ref-pick="to">${refIcon('location_on').replace('class="mi"','class="mi destination-icon"')}<span class="place-text"><small>도착지</small><strong id="ref-destination">${esc(state.to?.name||'어디로 갈까요?')}</strong></span><span class="mi close">close</span></button>
 <button class="icon-button swap" data-ref-action="swap" aria-label="출발 도착 바꾸기">${refIcon('swap_vert')}</button></div>
 <button class="yellow-button find" data-ref-action="find">${refIcon('search')}길찾기</button>${refFindError?`<div class="find-error" role="alert"><strong>${esc(refFindError.title)}</strong><p>${esc(refFindError.text||'')}</p><div>${refFindError.retry?'<button data-ref-action="find">다시 시도</button>':''}<button data-ref-pick="${refFindError.pick||'to'}">${refFindError.pick==='from'?'출발지':'도착지'} 다시 고르기</button></div></div>`:''}
 <button class="pace-link" data-ref-screen="settings"><span class="walk-disc">${refIcon('directions_walk')}</span><span class="pace-text"><small>내 걷기 속도</small><strong>${pace.label}${refSample||readProfile().learned.speed||readProfile().mode==='manual'?` (약 ${pace.value}km/h)`:''}</strong><p>${pace.detail}</p></span>${refIcon('chevron_right')}</button>
 <div class="section-heading"><span>최근 목적지</span><button data-ref-action="more">더보기 ›</button></div><div>${refRecentRows(refRecent())||'<p class="empty">최근 찾아본 장소가 여기에 보여요.</p>'}</div>
 <button class="crossing-entry" data-ref-action="crossing-map"><span class="map-entry-icon">${refIcon('location_on')}</span><span class="row-copy"><strong>횡단 시간 지도</strong><small>주변 횡단보도의 신호와 대기시간을<br>지도로 확인해보세요.</small></span>${refIcon('chevron_right')}</button></section>`;
}
function refSearch(){
 const names=['낙산공원','마로니에공원','대학로','서울대학교','동대문역사문화공원'];
 return `<section class="page search">${refHeader(refSample?'장소 검색':refPick==='from'?'출발지 선택':'도착지 선택')}<div class="search-box">${refIcon('search')}<input id="ref-query" aria-label="장소 검색" placeholder="${refSample?'장소, 주소 검색':'장소·주소 검색 · 출입구도 확인해 주세요'}" value="${refSample?'낙산공원':''}" autocomplete="off"><button data-ref-action="clear-query" aria-label="검색어 지우기">${refIcon('cancel')}</button></div>
 <nav class="tabs" aria-label="검색 분류">${['전체','장소','주소','최근 검색'].map((n,i)=>`<button class="${i?'':'active'}" data-ref-tab="${n}">${n}</button>`).join('')}</nav>
 <div id="ref-results"></div><div class="section-heading"><span>최근 검색</span><button data-ref-action="clear-recent">전체 삭제</button></div><div id="ref-search-recent">${refSample?names.map(n=>`<button class="recent-row" data-ref-query="${n}">${refIcon('schedule')}<span class="row-copy"><strong>${n}</strong></span></button>`).join(''):refRecentRows(refRecent(),true)}</div></section>`;
}
function refToggle(id,on,label,disabled=false){return `<button class="toggle" id="${id}" role="switch" aria-checked="${on}" aria-label="${label}"${disabled?' disabled aria-disabled="true"':''}></button>`;}
function refComfort(){
 const R=state.routes;if(!R)return {badge:'경로 미리보기',headline:'내 걸음으로 걷는 길',sub:'출발지와 도착지를 선택해 주세요.'};
 return routeSummary(R.short,R.alt?R.jjuk:null,state.focus);
}
function refRouteOptions(){
 const R=state.routes;if(refSample||refNavigating||!R?.alt)return '';
 return `<div class="route-choice" role="group" aria-label="경로 선택">${[['jjuk','편한 길'],['short','빠른 길']].map(([key,label])=>`<button data-ref-route="${key}" aria-pressed="${state.focus===key}"><strong>${label}</strong><small>${mins(R[key].m.walk)}</small></button>`).join('')}</div>`;
}
// 예상 신호 대기: 과거 기록 패턴이 있는 신호만 더한다. 모르는 곳은 숫자를 지어내지 않고 '몇 곳 모름'으로 적는다.
function refWaitText(m){
 if(!m||!Number.isFinite(m.waitTotal))return '미확인';
 if(!m.waitTotal)return '신호 없음';
 if(!m.waitKnown)return '정보 없음';
 return (m.wait<1?'0초':'약 '+dur(m.wait))+(m.waitUnknown?` · ${m.waitUnknown}곳 모름`:'');
}
function refValue(route,key){
 const m=route?.m;if(key==='wait')return refWaitText(m);
 if(!m||!Number.isFinite(m[key])||(['steep','gain'].includes(key)&&!refTerrainKnown(route)))return '미확인';
 return key==='walk'?mins(m[key]):key==='stairs'?m[key]+'구간':key==='sig'?m[key]+'곳':(key==='steep'?Math.round(m[key]/10)*10:Math.round(m[key]))+'m';
}
function refBurden(){
 const R=state.routes,r=R?.[state.focus];if(!r)return '';
 const value=refValue;
 const rows=[['walk','걷는 시간'],['wait','예상 신호 대기'],['sig','신호 횡단'],['stairs','확인된 계단'],['steep','급경사 거리 · 8% 이상'],['gain','오르는 높이']];
 return `<div class="route-burden"><details><summary><span>이 길의 보행 부담</span><span>자세히 ${refIcon('expand_more')}</span></summary><div class="burden-comparison"><h3>${R.alt?'길 조건 비교':'이 길의 조건'}</h3><table><thead><tr><th>조건</th>${R.alt?'<th>편한 길</th><th>빠른 길</th>':'<th>선택한 길</th>'}</tr></thead><tbody>${rows.map(([key,label])=>`<tr><th>${label}</th>${R.alt?'<td>'+value(R.jjuk,key)+'</td>':''}<td>${value(R.short,key)}</td></tr>`).join('')}</tbody></table><p>신호 대기는 과거 신호 기록으로 낸 예상(지금 출발 기준) · 경사는 지면 높이로 추정<br>턱·보도 폭·노면·경사로 연결은 아직 미확인</p></div></details><div class="burden-facts">${[['stairs','stairs','확인된 계단'],['landscape','steep','급경사·추정'],['trending_up','gain','오르는 높이']].map(([icon,key,label])=>`<div>${refIcon(icon)}<span><small>${label}</small><strong>${value(r,key)}</strong></span></div>`).join('')}</div></div>`;
}
function refSplash(){return `<section class="page reference-splash"><div class="reference-brand"><div id="ref-brand-mark"></div><h1>쭉고</h1><p>내 걸음으로, 쭉.</p></div><p class="reference-splash-foot">조금 더 걸려도, 더 편한 길.</p><button class="reference-splash-skip" data-ref-screen="home">건너뛰기</button></section>`;}
function refSettings(){
 const p=readProfile(),pace=refPace(),auto=refSample?true:p.autoEnabled&&p.mode==='auto';
 const selected=refSample?4.8:Math.round(walkSpeed()*3.6*10)/10;
 const header=refSettingsFromResult?`<header class="topbar"><button class="icon-button" data-ref-action="back-result" aria-label="경로로 돌아가기">${refIcon('chevron_left')}</button><h2>길 조건</h2><span></span></header>`:refHeader('걷기 설정');
 return `<section class="page settings">${header}<h3 class="setting-label">내 걷기 속도</h3>
 <div class="speed-summary"><span class="walk-disc">${refIcon('directions_walk')}</span><span class="pace-text"><small>${pace.label}</small><strong>${pace.pending?(p.autoEnabled===false?'임시 기준':'자동 맞춤'):pace.value+'<small> km/h</small>'}</strong><p>${pace.pending?'계산용 임시 기준 '+pace.value+'km/h'+(p.autoEnabled===false?' · 자동 학습 꺼짐':' · 걸으면 학습해요.'):pace.detail}</p></span>${refIcon('help')}</div>
 <div class="setting-row"><div class="setting-copy"><strong>자동으로 내 속도 학습하기</strong><p>실제 걸음 데이터를 기반으로<br>내 걷기 속도를 자동으로 설정해요.</p></div>${refToggle('ref-auto',auto,'자동으로 내 속도 학습하기')}</div>
 <hr><h3 class="setting-label manual-label">직접 설정하기</h3><div class="speed-options">${[['느리게',3.0],['보통',4.8],['빠르게',6.0]].map(([n,v])=>`<button class="speed-option ${Math.abs(selected-v)<.15?'active':''}" data-ref-speed="${v}" aria-pressed="${Math.abs(selected-v)<.15}">${refIcon('directions_walk')}<strong>${n}</strong><small>${v.toFixed(1)} km/h</small></button>`).join('')}</div>
 <h3 class="setting-label route-options">경로 옵션</h3><div class="setting-row">${refIcon('stairs')}<div class="setting-copy"><strong>계단 피하기</strong><p>가능한 계단이 적은 경로를 우선으로<br>추천해요.</p></div>${refToggle('ref-stairs',refSample||p.avoidSteps,'계단 피하기')}</div>
 <div class="setting-row">${refIcon('signal_cellular_4_bar')}<div class="setting-copy"><strong>${refSample?'급경사 피하기':'급경사 덜 걷기'}</strong><p>${refSample?'가파른 오르막과 내리막 구간을 피해서<br>추천해요.':'추정 급경사가 적은 대안을 먼저 찾아요.<br>완만한 경사로까지 피하지는 않아요.'}</p></div>${refToggle('ref-slope',refSample||store.get('avoidSlope',true),'급경사 덜 걷기')}</div>
 <h3 class="budget-label">추가로 걸을 수 있는 시간</h3><p class="budget-copy">${refSample?'최단 경로 대비, 최대 몇 분까지 더 걸을 수 있는<br>대안 경로를 추천할지 설정해요.':'추가 시간 안에서 부담을 줄이는 길을 찾아요.<br><span id="ref-data-source">'+esc(refDataLabel())+'</span>'}</p><div class="budget-options">${[.5,1,2,3].map(v=>`<button class="${(refSample?1:store.get('referenceBudget',p.budgetSeconds/60))===v?'active':''}" data-ref-budget="${v}">+${v}분</button>`).join('')}</div>
 ${refSample?'':`<div class="setting-row">${refIcon('bar_chart')}<div class="setting-copy"><strong>익명 사용 기록 보내기</strong><p>대안이 있었는지, 어느 길을 골랐는지만 보내요.<br>위치·장소 이름·이동 경로는 보내지 않아요.</p></div>${refToggle('ref-log',!store.get('nolog',false),'익명 사용 기록 보내기')}</div>`}</section>`;
}
function refNoAltText(){
 const s=state.routes?.short,p=readProfile(),extra=Math.round((state.budget||0)/30)/2;
 if(p.avoidSteps&&s?.m?.stairs===0)return '빠른 길에 이미 확인된 계단이 없어 이 길로 안내해요.';
 return extra>0?`${extra}분 더 걸어도 덜 힘든 다른 길이 없어 빠른 길로 안내해요.`:'덜 힘든 다른 길을 찾지 못해 빠른 길로 안내해요.';
}
function refWalking(){
 const demo=refSample,pace=refPace(),r=state.routes?.[state.focus],length=r?km(r.length):'—',planning=!demo&&!refNavigating,comfort=refComfort();
 return `<section class="page walking"><div class="walk-map"><div id="ref-map" class="mapbox"></div><div class="map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · Mapzen / USGS</div></div>
 <div class="walk-instruction ${planning?'planning':''}"><div class="instruction-content"><span class="direction-disc">${refIcon(planning?'directions_walk':'arrow_upward')}</span><span class="instruction-copy"><strong id="ref-next-distance">${demo?'74m 후':planning?esc(state.routes?.alt?comfort.badge||comfort.headline:'걷는 시간이 짧은 길'):'위치 확인 중'}</strong><p id="ref-instruction">${demo?'횡단보도를 건너세요.':planning?esc(state.routes?.alt?comfort.sub:refNoAltText()):'경로를 따라 걸어가세요.'}</p></span>${planning?`<button class="icon-button sound" data-ref-action="conditions" aria-label="길 조건 바꾸기">${refIcon('tune')}</button>`:`<button class="icon-button sound" data-ref-action="sound" aria-label="음성 안내" aria-pressed="${refSound}">${refIcon(refSound?'volume_up':'volume_off')}</button>`}</div>${refRouteOptions()}<div class="instruction-progress"></div></div>
 <div class="map-buttons"><button data-ref-action="recenter" aria-label="현재 위치">${refIcon('near_me')}</button><button data-ref-action="layers" aria-label="지도 레이어">${refIcon('layers')}</button><button data-ref-action="recenter" aria-label="지도 중심 맞추기">${refIcon('my_location')}</button></div>
 <div class="walk-bottom"><div class="walk-metrics"><div><small>${planning?'걷는 거리':'남은 거리'}</small><strong id="ref-left">${demo?'1.1 km':length}</strong></div><div><small>${demo?'남은 시간':planning?'예상 보행':'남은 보행'}</small><strong id="ref-time">${demo?'15분':r?mins(r.length/SPEED):'—'}</strong><p id="ref-arrival">${demo?'(오후 2:41 도착 예정)':pace.pending?'임시 속도 · 신호 대기 별도':'신호 대기 별도'}</p></div><div><small>내 속도</small><strong id="ref-speed">${demo?'4.8':pace.label==='아직 측정 전'?'—':pace.value}<span> km/h</span></strong></div></div>
 ${planning?refBurden():`<button class="next-crossing" data-ref-action="next-crossing"><span class="signal-disc ${demo?'':'gray'}">${refIcon('directions_walk')}</span><span class="row-copy"><strong>다음 횡단보도</strong><small id="ref-next-summary">${demo?'74m · 횡단 가능 · 17초 남음':'위치 확인 후 안내해요'}</small></span>${refIcon('chevron_right')}</button><button class="yellow-button ref-reroute" data-ref-action="reroute" style="display:none">${refIcon('refresh')}<span>내 위치에서 다시 찾기</span></button>`}
 <div class="bottom-actions"><button class="${planning?'yellow-button':'white-button'}" data-ref-action="${planning?'start':'pause'}">${refIcon(planning?'directions_walk':refPaused?'play_arrow':'pause')}<span>${planning?'걷기 시작':refPaused?'다시 시작':'일시정지'}</span></button><button class="navy-button" data-ref-action="finish">${refIcon('stop')}${planning?'닫기':'경로 종료'}</button></div></div></section>`;
}
function refSummary(){
 const rec=state.lastWalk,r=state.routes?.[state.focus],recorded=rec&&rec.meters>0;
 const time=refSample?'15분':recorded?mins(rec.elapsedS):'기록 없음',distance=refSample?'1.1 km':recorded?km(rec.meters):'—';
 return `<section class="page summary"><header class="topbar"><button class="icon-button" data-ref-screen="home" aria-label="닫기">${refIcon('close')}</button></header><h1>오늘의 걸음</h1><p class="intro">${refSample?'오늘도 조금 더 편안한 길을 걸었어요.':recorded?(r&&rec.meters<r.length*0.8?`경로 중 ${km(rec.meters)}를 걸었어요. 아래 지표는 계획 경로 기준이에요.`:'오늘도 내 걸음으로 걸었어요.'):'실측 기록 없음 · 아래 지도와 지표는 계획 경로예요.'}</p>
 <div class="total-card"><span class="walk-disc">${refIcon('directions_walk')}</span><div><small>총 소요 시간</small><strong>${time}</strong><p>${refSample?'오후 2:26 → 오후 2:41':recorded?'GPS로 측정한 실제 이동 기록':'걷기 기록이 있으면 표시해요'}</p></div></div>
 <div class="summary-metrics"><div><small>${refIcon('location_on')}이동 거리</small><strong>${distance}</strong></div><div><small>${refIcon('schedule')}예상 신호대기</small><strong>${refSample?'40초':esc(refWaitText(r?.m))}</strong>${refSample?'<p>약 2분 20초 절약</p>':''}</div></div>
 <div class="comfort-summary"><span class="thumb">${refIcon('thumb_up')}</span><p>${refSample?'빠른 길보다 2분 더 걸었지만,<br>신호대기를 2분 20초 줄였어요!':esc(refComfort().sub||'내 걸음에 맞춘 계획 경로예요.')}</p></div>
 <div class="mini-map-wrap"><div class="mapbox" id="ref-summary-map"></div><div class="map-end-label start">출발<strong>${esc(refSample?'혜화역':state.from?.name||'출발지')}</strong>${refSample?'(4호선)':''}</div><div class="map-end-label end">도착<strong>${esc(refSample?'낙산공원':state.to?.name||'도착지')}</strong></div><div class="map-attribution">© OpenStreetMap · Mapzen / USGS</div></div>
 ${refSample?'':'<div class="section-heading"><span>계획 경로 기준</span></div>'}<div class="route-facts">${[['directions_walk','신호 횡단',refSample?'3개':refValue(r,'sig')],['stairs','확인된 계단',refSample?'0개':refValue(r,'stairs')],['landscape','오르는 높이',refSample?'14m':refValue(r,'gain')],['warning','급경사',refSample?'0m':refValue(r,'steep')]].map(([i,n,v])=>`<div>${refIcon(i)}<span><small>${n}</small><strong>${v}</strong></span></div>`).join('')}</div>
 <div class="bottom-actions"><button class="white-button" data-ref-screen="home">${refIcon('home')}홈으로</button><button class="navy-button" data-ref-action="save">${refIcon('download')}이미지 저장</button></div></section>`;
}
// The map continues to use the bundled Seoul vector tiles and font protocol.
const refOriginalMapStyle=mapStyle;
mapStyle=function(){
 const s=refOriginalMapStyle();
 const colors={bg:'#F4F2E9',green:'#D4E8BD',sites:'#EFEEE6',water:'#C5E6EA',waterline:'#C5E6EA',bld:'#E5E4DD','foot-case':'#F8F8F1',foot:'#FFFDF8',steps:'#FFFDF8',service:'#FFFFFF','minor-case':'#DEDDD5','major-case':'#D9D7CC',minor:'#FFFFFF',major:'#FFFFFF','hw-case':'#E6D6B7',hw:'#F8E4B6'};
 for(const l of s.layers)if(['cov-line','sig-all','sig-label','xw-dot','xw-line'].includes(l.id))l.layout={...l.layout,visibility:'none'};
 for(const l of s.layers){
  if(colors[l.id]){const k=l.type==='background'?'background-color':l.type==='fill'?'fill-color':'line-color';l.paint[k]=colors[l.id];if(l.id==='bld')l.paint['fill-outline-color']='#DADBD4';}
  if(l.type==='symbol'){l.paint['text-color']=l.id.includes('park')?'#4F8054':'#7A858C';l.paint['text-halo-color']='#FCFBF7';l.paint['text-halo-width']=1.2;}
  if(l.id==='route-jjuk')l.paint['line-color']='#4D8FFF';
  if(l.id==='route-jjuk-case'){l.paint['line-color']='#FFFFFF';l.paint['line-opacity']=1;}
 }
 return s;
};
// Keep the engine's map mounted in the currently visible map surface.
mountMap=function(){
 const host=document.getElementById(refScreen==='summary'?'ref-summary-map':'ref-map');if(!host)return;
 mapEl.style.opacity='';mapEl.inert=false;mapEl.removeAttribute('aria-hidden');host.append(mapEl);ensureMap();map.resize();
};
function refDataLabel(){
 const h=refDataStatus?.historical;if(!h?.available)return '신호 이력 확인 전 · 현재 신호 미확인';
 const fmt=s=>+s.slice(4,6)+'/'+ +s.slice(6,8);
 return `신호 이력 ${fmt(h.firstDate)}–${fmt(h.lastDate)} · 현재 신호 미확인`;
}
async function refMountNaver(coords,summary){
 const epoch=refMapEpoch;
 const config=await window.JJUKGO_MAP_CONFIG_READY;
 if(!config?.naverClientId||!window.JJUKGO_NAVER||refSample)return;
 refRoot.dataset.mapProvider='naver-loading';
 let node,handle;
 try{
  await window.JJUKGO_NAVER.load(config.naverClientId);
  if(epoch!==refMapEpoch)return;
  const host=document.getElementById(summary?'ref-summary-map':'ref-map');if(!host)return;
  node=document.createElement('div');node.className='naver-basemap';node.style.opacity='0';host.append(node);
  const r=state.routes?.[state.focus];
  const crossings=refSignals;
  handle=window.JJUKGO_NAVER.render(node,{coords,currentLL:gpsFresh()?gpsFix.ll:null,crossings,next:summary?null:crossings.find(x=>!x.raw.nearby),summary,sample:false,onSignalClick:refOpenSignal,onSignalClose:refCloseSignal,signalHTML:refSignalHTML,signalTitle:refSignalTitle,signalDescription:refSignalDescription,onViewportChange:summary?null:refRefreshNearby,endpointHTML:{from:refEndpointHTML('from',state.from?.name),to:refEndpointHTML('to',state.to?.name)}});
  refNaverHandle=handle;
  if(!await handle.ready||epoch!==refMapEpoch){handle.destroy();node.remove();if(refNaverHandle===handle){refNaverHandle=null;refRoot.dataset.mapProvider='osm';}return;}
  node.style.opacity='1';mapEl.style.opacity='0';mapEl.inert=true;mapEl.setAttribute('aria-hidden','true');refRoot.dataset.mapProvider='naver';delete refRoot.dataset.mapError;
  if(refSelectedSignal){refSignalPopup?.remove();refSignalPopup=null;handle.showSignal(refSelectedSignal);}
 }catch(e){handle?.destroy();node?.remove();if(refNaverHandle===handle)refNaverHandle=null;if(epoch===refMapEpoch){mapEl.style.opacity='';refRoot.dataset.mapProvider='osm';refRoot.dataset.mapError=e.message;console.warn('네이버 지도 대신 기존 지도 사용:',e.message);refToast(e.message);}}
}
function refClearMarkers(){refMarkers.forEach(m=>m.remove());refMarkers=[];refSignalMarkers=[];}
function refMark(ll,element,opts={}){const m=new maplibregl.Marker({element,...opts}).setLngLat(ll).addTo(map);refMarkers.push(m);return m;}
function refNextMarker(ll,sample=false){
 const e=document.createElement('div');e.className='crossing-marker';
 e.innerHTML=`<div class="signal-callout"><small>다음 횡단보도</small><strong>${sample?'74m':'미확인'}</strong><p>${sample?'횡단 가능 · 17초 남음':'현장 신호를 확인하세요'}</p></div><span class="signal-disc ${sample?'':'gray'}">${refIcon('directions_walk')}</span>`;
 refMark(ll,e);return e;
}
async function refDrawMap(){
 await refData();
 if(!['walking','summary'].includes(refScreen))return;
 mountMap();refClearMarkers();clearDyn();
 await new Promise((resolve,reject)=>ready(()=>{try{
  if(!['walking','summary'].includes(refScreen)){resolve();return;}
  const summary=refScreen==='summary',r=state.routes?.[state.focus];
  const coords=refSample?(summary?refFixtureRoute.slice().reverse():refFixtureRoute):r?.coords;
  if(!coords){map.jumpTo({center:ME.ll,zoom:15});resolve();return;}
  refRoute=coords;
  map.getSource('rj').setData(lineFC(coords));map.getSource('rs').setData(EMPTY);
  if(refSample&&!summary){
   map.jumpTo({center:[127.0052,37.5813],zoom:15.85,bearing:0});
   // Fixture geometry follows the supplied image, then becomes geographic map data.
   // It is never passed to the real routing or GPS engine.
   const ll=(x,y)=>map.unproject([x,y]).toArray();
   const pixels=[[26,122],[35,165],[55,225],[67,256],[85,282],[108,302],[128,307],[139,325],[149,344],[154,362],[174,391],[174,410],[189,431],[193,448],[221,475]];
   refRoute=pixels.map(p=>ll(...p));map.getSource('rj').setData(lineFC(refRoute));
   refNextMarker(ll(139,325),true);
   for(const p of [[55,225],[174,391]])refMark(ll(...p),el('signal-disc red',refIcon('directions_walk')));
   for(const [p,c] of [[[102,160],'gray'],[[17,277],'gray'],[[28,329],'gray'],[[57,465],'red']])refMark(ll(...p),el(`signal-disc faded ${c}`,refIcon('directions_walk')));
   refMark(ll(221,475),el('m-me',''));
  }else{
   const bounds=new maplibregl.LngLatBounds(coords[0],coords[0]);coords.forEach(c=>bounds.extend(c));
   if(summary&&refSample){
    map.jumpTo({center:[127.0052,37.5813],zoom:15.85,bearing:0});
    const at=(x,y)=>map.unproject([x,y]).toArray();
    const points=[[35,41],[49,61],[79,68],[107,74],[132,57],[150,63],[179,66],[184,84],[206,90],[228,113],[250,122],[276,106],[304,87],[330,71]];
    const mini=points.map(p=>at(...p));map.getSource('rj').setData(lineFC(mini));
    refMark(mini[0],el('signal-disc summary-marker start',refIcon('directions_walk')));
    refMark(mini.at(-1),el('signal-disc summary-marker end',refIcon('location_on')));
    refMark(mini[9],el('signal-disc red summary-marker',refIcon('directions_walk')));
    map.resize();resolve();return;
   }
   else map.fitBounds(bounds,{padding:summary?{top:30,bottom:34,left:30,right:30}:{top:170,bottom:70,left:55,right:80},duration:0,maxZoom:summary?15.4:17});
   refMark(coords[0],el('endpoint-host',refEndpointHTML('from',state.from?.name)),{anchor:'top',offset:[0,-18]});
   refMark(coords.at(-1),el('endpoint-host',refEndpointHTML('to',state.to?.name)),{anchor:'top',offset:[0,-18]});
   if(refSample){refMark(coords[6],el('signal-disc red summary-marker',refIcon('directions_walk')));}
   else if(!summary){refSignals=refMakeSignals(r);for(const item of refSignals){
    const elm=el('signal-disc '+refSignalClass(item)+' estimated',refIcon(item.historyLabel&&!item.trusted?'history':'directions_walk'));
    elm.setAttribute('role','button');elm.tabIndex=0;elm.setAttribute('aria-label',item.label+' 신호 정보');
    elm.addEventListener('click',e=>{e.stopPropagation();refOpenSignal(item);});elm.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();refOpenSignal(item);}});
    refMark(item.ll,elm);refSignalMarkers.push({item,elm});
   }}
  }
  map.resize();
  if(!refSample)refMountNaver(coords,summary);
  resolve();
 }catch(e){reject(e);}}));
}
function refShow(screen){
 if(!['home','search','settings','walking','summary','splash'].includes(screen))screen='home';
 clearTimeout(refSplashTimer);refMapEpoch++;refCloseSignal();refNaverHandle?.destroy();refNaverHandle=null;
 if(refScreen==='walking'&&screen!=='walking'&&!refSample){stopGPS();if(screen==='summary')endWalk();}
 refClearMarkers();refScreen=screen;current=screen==='walking'?'walk':screen==='summary'?'done':screen;
 const views={home:refHome,search:refSearch,settings:refSettings,walking:refWalking,summary:refSummary,splash:refSplash};refRoot.innerHTML=views[screen]();
 document.title=`쭉고 · ${screen}${refSample?' · 시각 검증용 예시':''}`;
 if(screen==='search')refDoSearch(document.getElementById('ref-query').value);
 if(screen==='walking'||screen==='summary'){
  const epoch=refMapEpoch;refDrawMap().then(()=>{if(epoch===refMapEpoch&&screen==='walking'&&!refSample&&refNavigating&&state.routes)renderWalk(false,!!walkTrack);}).catch(e=>refToast('지도를 불러오지 못했어요. '+e.message));
 }
 if(screen==='splash'){
  document.getElementById('ref-brand-mark').append($('s-splash').querySelector('svg').cloneNode(true));
  if(!(refSample&&refParams.get('hold')==='1'))refSplashTimer=setTimeout(()=>refShow('home'),3200);store.set('seenSplash',true);
 }
 if(refSample)document.fonts.ready.then(()=>requestAnimationFrame(()=>{
  const p=refRoot.querySelector('.page');
  console.info('REFERENCE_LAYOUT',JSON.stringify({screen:refScreen,width:refRoot.clientWidth,height:refRoot.clientHeight,scrollHeight:p.scrollHeight,clientHeight:p.clientHeight,scrollWidth:p.scrollWidth}));
 }));
}
// Engine navigation callbacks are adapted, not allowed to reveal the old interface.
go=function(name){if(name==='result'){refFind();return;}if(name==='search')refPick=state.pick;refShow({walk:'walking',done:'summary',detail:'walking'}[name]||name);};
async function refDoSearch(q,category='전체'){
 const seq=++refSearchSeq,host=document.getElementById('ref-results');if(!host)return;
 if(refSample&&q==='낙산공원')refSearchHits=[refPlaces[0],{name:'낙산공원 주차장',sub:'서울 종로구 낙산길 41',ll:[127.0075,37.5806]},{name:'낙산공원 전망대',sub:'서울 종로구 낙산길 56',ll:[127.008,37.5808]},{name:'낙산공원 입구',sub:'서울 종로구 이화동 산1-3',ll:[127.005,37.5806]}];
 else{
  host.innerHTML='<p class="empty">장소를 찾고 있어요…</p>';
  try{refSearchHits=q.trim()?await runSearch(q):refRecent();}catch{host.innerHTML='<p class="empty">연결을 확인하고 다시 검색해 주세요.</p>';return;}
  if(seq!==refSearchSeq||refScreen!=='search')return;
 }
 if(category==='최근 검색')refSearchHits=refRecent();
 if(category==='주소')refSearchHits=refSearchHits.filter(p=>p.kind==='주소');
 host.innerHTML=refSearchHits.slice(0,refSample?4:40).map((p,i)=>`<button class="search-result" data-ref-hit="${i}">${refIcon('location_on')}<span class="row-copy"><strong>${esc(p.name)}</strong><small>${esc(p.sub||p.kind||'서울 장소')}</small></span>${i?'':refIcon('north_east').replace('class="mi"','class="mi arrow"')}</button>`).join('')||'<p class="empty">검색 결과가 없어요.</p>';
 if(!refSample&&q.trim())host.insertAdjacentHTML('beforeend','<button class="recent-row" data-ref-action="public-search"><span class="row-copy"><strong>공개 지도에서 더 찾아보기</strong><small>검색어를 공개 장소 검색에 보내요.</small></span></button>');
 if(!refSample&&!q.trim()&&refPick==='from')host.insertAdjacentHTML('afterbegin',`<button class="search-result" data-ref-action="gps">${refIcon('my_location')}<span class="row-copy"><strong>내 현재 위치</strong><small>GPS로 출발 위치 연결</small></span></button>`);
}
function refChoose(p){
 state[refPick]={...p,sub:p.sub||p.kind||''};state.routes=null;state.tripKey=null;state.fixedRoute=null;state.dep=0;state.focus='jjuk';state.mode='actual';
 store.set('recent',[p,...store.get('recent',[]).filter(v=>v.name!==p.name)].slice(0,6));refShow('home');
}
async function refFind(){
 if(refSample){refShow('walking');return;}
 if(!state.from){refToast('출발지를 선택하거나 현재 위치를 연결해 주세요.');refPick='from';state.pick='from';refShow('search');return;}
 if(!state.to){refPick='to';state.pick='to';refShow('search');return;}
 const btn=refRoot.querySelector('.find');if(btn){btn.disabled=true;btn.textContent='길을 찾고 있어요…';}
 refFindError=null;
 try{await refData();applyPace();state.budget=store.get('referenceBudget',readProfile().budgetSeconds/60)*60;if(state.mode==='actual'&&(!state.routes||state.tripKey!==tripKeyNow()))BASE=kstSec();await computeTrip();
  if(state.error){logRouteSearch();refFindError={...state.error,retry:state.error.kind==='network'};refNavigating=false;refShow('home');return;}
  logRouteSearch();refNavigating=false;refShow('walking');}
 catch(e){refFindError={title:'길을 찾지 못했어요',text:e.message,retry:true};refNavigating=false;refShow('home');}
}
function refUpdateProfile(change){const p=readProfile();Object.assign(p,change);writeProfile(p);applyPace();state.routes=null;state.tripKey=null;}
function refLocateStart(){
 refShow('home');const request=++gpsRequest;gpsPending=true;gpsStatus('내 위치를 찾고 있어요…');refToast('내 위치를 찾고 있어요…');
 if(!navigator.geolocation||!window.isSecureContext){gpsPending=false;refToast('위치 연결을 사용할 수 없어요. 출발지를 직접 선택해 주세요.');return;}
 requestLocation(p=>{
  if(request!==gpsRequest)return;
  gpsPending=false;
  try{
   gpsFix=readFix(p,1000);
   if(gpsFix.accuracy>100){refPick='from';state.pick='from';refShow('search');refToast('위치 오차가 커요. 출발지를 직접 선택해 주세요.');return;}
   state.from={name:'내 위치',sub:'GPS',ll:[...gpsFix.ll],me:true};state.mode='actual';state.routes=null;state.tripKey=null;state.fixedRoute=null;state.dep=0;state.focus='jjuk';
   refPick='to';state.pick='to';if(state.to)refFind();else refShow('search');
  }catch(e){gpsError(e);refToast('정확한 위치를 받지 못했어요. 출발지를 직접 선택해 주세요.');}
 },e=>{if(request!==gpsRequest)return;gpsPending=false;gpsError(e);refPick='from';state.pick='from';refShow('search');refToast('위치를 연결하지 못했어요. 권한을 확인하거나 출발지를 직접 선택해 주세요.');});
}
refRoot.addEventListener('input',e=>{if(e.target.id==='ref-query')refDoSearch(e.target.value);});
refRoot.addEventListener('keydown',e=>{const key=e.target.closest('button')?.dataset.refSignalKey;if(key&&['Enter',' '].includes(e.key)){e.preventDefault();const item=refSignals.find(x=>x.key===key);if(item)refOpenSignal(item);}},true);
refRoot.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 // 화면이 바뀐 직후 같은 자리에 생긴 버튼이 두 번째 탭을 받지 않게(걷기 시작 두 번 → 일시정지 방지)
 if(performance.now()<refIgnoreUntil&&['pause','finish','reroute'].includes(b.dataset.refAction))return;
 if(b.dataset.refPick)refFindError=null;
 if(b.dataset.refScreen){if(b.dataset.refScreen!=='settings')refSettingsFromResult=false;refShow(b.dataset.refScreen);return;}
 if(b.dataset.refPick){refPick=b.dataset.refPick;state.pick=refPick;refShow('search');return;}
 if(b.dataset.refRoute){if(!refNavigating&&state.routes?.alt&&['jjuk','short'].includes(b.dataset.refRoute)){state.focus=b.dataset.refRoute;refShow('walking');}return;}
 if(b.dataset.refHit!=null){refChoose(refSearchHits[Number(b.dataset.refHit)]);return;}
 if(b.dataset.refRecent!=null){refChoose(refRecent()[Number(b.dataset.refRecent)]);return;}
 if(b.dataset.refQuery){document.getElementById('ref-query').value=b.dataset.refQuery;refDoSearch(b.dataset.refQuery);return;}
 if(b.dataset.refTab){refRoot.querySelectorAll('.tabs button').forEach(v=>v.classList.toggle('active',v===b));refDoSearch(document.getElementById('ref-query').value,b.dataset.refTab);return;}
 if(b.dataset.refSpeed){refUpdateProfile({mode:'manual',manualSpeed:Number(b.dataset.refSpeed)/3.6});refShow('settings');return;}
 if(b.dataset.refBudget){store.set('referenceBudget',Number(b.dataset.refBudget));state.budget=Number(b.dataset.refBudget)*60;state.routes=null;state.tripKey=null;refShow('settings');return;}
 if(b.id==='ref-auto'){const on=b.getAttribute('aria-checked')!=='true';refUpdateProfile({mode:'auto',autoEnabled:on});refShow('settings');return;}
 if(b.id==='ref-stairs'){const on=b.getAttribute('aria-checked')!=='true';refUpdateProfile({avoidSteps:on,avoidStepsSet:true});b.setAttribute('aria-checked',on);return;}
 if(b.id==='ref-log'){const on=b.getAttribute('aria-checked')!=='true';store.set('nolog',!on);b.setAttribute('aria-checked',on);return;}
 if(b.id==='ref-slope'){const on=b.getAttribute('aria-checked')!=='true';store.set('avoidSlope',on);state.routes=null;state.tripKey=null;b.setAttribute('aria-checked',on);refToast(on?'급경사가 적은 대안을 먼저 찾아요.':'추가 시간이 적은 대안을 먼저 찾아요.');return;}
 const a=b.dataset.refAction;
 if(a==='close-signal'){refCloseSignal();return;}
 if(a==='conditions'){refSettingsFromResult=true;refShow('settings');return;}
 if(a==='back-result'){refSettingsFromResult=false;if(state.routes&&state.tripKey===tripKeyNow())refShow('walking');else{refToast('바뀐 조건으로 길을 다시 찾고 있어요…');refFind();}return;}
 if(a==='reroute'){rerouteFromGPS();return;}
 if(a==='find')refFind();
 if(a==='gps'){await refData();refLocateStart();}
 if(a==='swap'){[state.from,state.to]=[state.to,state.from];state.routes=null;state.tripKey=null;refShow('home');}
 if(a==='more'){refPick='to';state.pick='to';refShow('search');}
 if(a==='clear-query'){const q=document.getElementById('ref-query');q.value='';q.focus();refDoSearch('');}
 if(a==='clear-recent'){store.set('recent',[]);document.getElementById('ref-search-recent').innerHTML='';}
 if(a==='public-search'){
  const q=document.getElementById('ref-query').value;b.disabled=true;
  try{const r=await fetch('/api/places?q='+encodeURIComponent(q));const j=await r.json();if(!r.ok)throw new Error(j.error||'공개 검색 연결 실패');const rows=j.places||j.results||[];refSearchHits=rows;document.getElementById('ref-results').innerHTML=rows.map((p,i)=>`<button class="search-result" data-ref-hit="${i}">${refIcon('location_on')}<span class="row-copy"><strong>${esc(p.name)}</strong><small>${esc(p.sub||p.kind||'공개 검색')}</small></span></button>`).join('')||'<p class="empty">찾은 장소가 없어요.</p>';}catch(err){refToast(err.message);}finally{b.disabled=false;}
 }
 if(a==='crossing-map'){if(refSample)refShow('walking');else location.href=new URL('index.html#home',document.baseURI).href;}
 if(a==='pause'){refPaused=!refPaused;if(!refSample){if(refPaused){stopGPS();clearInterval(walkClock);walkClock=null;resumeTrack(walkTrack);}else{renderWalk(false,true);}}b.innerHTML=refIcon(refPaused?'play_arrow':'pause')+`<span>${refPaused?'다시 시작':'일시정지'}</span>`;}
 if(a==='start'){
  refIgnoreUntil=performance.now()+600;
  if(!refSample&&state.routes){const route=!state.routes.alt||state.focus==='short'?'fast':'jjukgo';logEvent('selected_route',{trip:state.tripId,route,alternative_available:!!state.routes.alt});state.walkLogPending=route;}
  refNavigating=true;refPaused=false;refProgress=null;refShow('walking');}
 if(a==='finish'){if(!refSample&&!refNavigating){refShow('home');return;}if(!refSample){endWalk();stopGPS();}refNavigating=false;refPaused=false;refShow('summary');}
 if(a==='sound'){refSound=!refSound;b.setAttribute('aria-pressed',refSound);b.innerHTML=refIcon(refSound?'volume_up':'volume_off');if(refSound&&!refSample&&'speechSynthesis'in window){speechSynthesis.speak(new SpeechSynthesisUtterance(document.getElementById('ref-instruction').textContent));}}
 if(a==='recenter'&&map){if(!refSample&&!gpsFresh()){refPendingRecenter=true;locate(false);}else if(refNaverHandle)refNaverHandle.center(gpsFix.ll,16);else map.easeTo({center:gpsFix?.ll||refFixtureRoute[0],zoom:16.7,duration:300});}
 if(a==='layers'&&refRoute){if(refNaverHandle)refNaverHandle.fitRoute();else{const b=new maplibregl.LngLatBounds(refRoute[0],refRoute[0]);refRoute.forEach(c=>b.extend(c));map.fitBounds(b,{padding:{top:170,bottom:70,left:45,right:70},duration:300});}}
 if(a==='next-crossing'){const next=refSignals.find(x=>!x.raw.nearby);if(next)refOpenSignal(next);else refToast('경로에 연결된 횡단 정보가 없어요. 지도 아이콘에서 주변 신호 위치를 볼 수 있어요.');}
 if(a==='save')refSave();
});
async function refSave(){
 // Export this same light summary, never the previous dark share-card design.
 const c=document.createElement('canvas');c.width=780;c.height=1000;const x=c.getContext('2d');x.scale(2,2);x.fillStyle='#FCFBF7';x.fillRect(0,0,390,500);x.fillStyle='#242A32';x.font='800 28px "Noto Sans KR",sans-serif';x.fillText('오늘의 걸음',28,58);x.font='500 14px "Noto Sans KR",sans-serif';x.fillText(refSample?'시각 검증용 예시 · 실제 이동 기록 아님':'내 걸음으로 남긴 오늘의 기록',28,90);
 x.font='800 42px "Noto Sans KR",sans-serif';x.fillText(refSample?'15분':state.lastWalk?mins(state.lastWalk.elapsedS):'기록 없음',28,160);x.font='600 20px "Noto Sans KR",sans-serif';x.fillText(refSample?'1.1 km':state.lastWalk?km(state.lastWalk.meters):'—',28,200);
 if(map&&map.loaded()){map.triggerRepaint();await new Promise(resolve=>map.once('render',resolve));try{x.drawImage(map.getCanvas(),28,240,334,210);}catch{}}
 x.fillStyle='#718096';x.font='12px sans-serif';x.fillText('쭉고 · © OpenStreetMap contributors',28,480);
 c.toBlob(blob=>{if(!blob)return;const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=refSample?'jjukgo-example.png':'jjukgo-walk.png';a.click();setTimeout(()=>URL.revokeObjectURL(u),3000);},'image/png');
}
let refDataPromise=null;
function refData(){
 if(!refDataPromise)refDataPromise=(async()=>{
 [IDX,SIGS,GMETA,TERRAIN]=await Promise.all([getJSON('tiles/index.json'),getJSON('signals.json'),getJSON('graph/index.json'),getJSON('terrain.json').catch(()=>null)]);
 try{const r=await fetch(new URL('reference-ui/signal-facts.json',document.baseURI));if(r.ok)refSignalFacts=(await r.json()).signals||{};}catch{console.warn('과거 신호 요약을 불러오지 못했어요.');}
 for(const[id,x,y,name,cits]of SIGS)SIGMETA.set(id,{name,cits,ll:fromQ(x,y)});
 booted=true;applyPace();state.deadline=null;state.budget=readProfile().budgetSeconds;
 if(!refSample&&window.JJUKGODataStatus)window.JJUKGODataStatus.read().then(status=>{refDataStatus=status;const label=document.getElementById('ref-data-source');if(label)label.textContent=refDataLabel();});
})().catch(e=>{refDataPromise=null;console.warn('기본 자료 연결 실패:',e.message);throw new Error('기본 자료를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');});
 return refDataPromise;
}
refData().catch(e=>refToast(e.message));
const refPoint = value => {
 const [lat,lon]=(value||'').split(',').map(Number);
 return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>37.3&&lat<37.8&&lon>126.6&&lon<127.3?[lon,lat]:null;
};
const refFrom=refPoint(refParams.get('from')),refTo=refPoint(refParams.get('to'));
refShow(refParams.get('screen')||(refSample||store.get('seenSplash',false)?'home':'splash'));
if(!refSample&&refFrom&&refTo){
 state.from={name:refParams.get('fn')||'출발',ll:refFrom,sub:''};state.to={name:refParams.get('tn')||'도착',ll:refTo,sub:''};state.mode='actual';
 refFind();
}
setInterval(()=>{
 if(refSample)return;
 const walkingNow=refScreen==='walking'&&refNavigating&&!!walkTrack,route=state.routes?.[state.focus];
 refProgress=walkingNow&&route&&gpsFresh()?projectOnRoute(route,gpsFix.ll).distance:null;
 if(['walking','summary'].includes(refScreen)&&refSignals.length){
  for(const item of refSignals)Object.assign(item,refSignalModel(item.raw));
  refNaverHandle?.updateSignals?.(refSignals);
  for(const{item,elm}of refSignalMarkers){elm.className='signal-disc '+refSignalClass(item)+' estimated';elm.querySelector('.mi').textContent=item.historyLabel&&!item.trusted?'history':'directions_walk';}
  if(refSelectedSignal&&refSignalPopup){const n=refSignalPopup.getElement().querySelector('strong');if(n)n.textContent=refSignalTitle(refSelectedSignal);}
  const next=refSignals.find(x=>!x.raw.nearby&&(refProgress==null||!Number.isFinite(x.raw.d)||x.raw.d>refProgress+3)),out=document.getElementById('ref-next-summary');
  if(next&&out){out.textContent=next.trusted?next.secondsLabel:next.historyLabel||next.geometrySummary||next.reason;const disc=out.closest('button').querySelector('.signal-disc');disc.className='signal-disc '+refSignalClass(next);disc.querySelector('.mi').textContent=next.historyLabel&&!next.trusted?'history':'directions_walk';}
  else if(out)out.textContent='경로의 횡단 시간 미확인 · 주변 아이콘 보기';
  if(out)out.closest('button').querySelector('.row-copy strong').textContent=next?'다음 횡단보도':'횡단 정보';
 }
 if(gpsFresh()&&refPendingRecenter){if(refNaverHandle)refNaverHandle.center(gpsFix.ll,16);refPendingRecenter=false;}
 if(refScreen==='home'&&state.from){const n=document.getElementById('ref-origin');if(n)n.textContent=state.from.name;}
 const gpsMessage=$('walk-location')?.textContent||$('location-status')?.textContent||$('search-location')?.textContent||'';
 // 위치 알림은 걷는 중에만 띄운다(다른 화면에서 '위치 연결 대기'가 중요한 오류 알림을 덮지 않게)
 if(gpsMessage&&gpsMessage!==refGPSMessage){refGPSMessage=gpsMessage;if(refScreen==='walking'&&refNavigating)refToast(gpsMessage);}
 const reroute=refRoot.querySelector('.ref-reroute'),offRoute=walkingNow&&$('walk-reroute')&&!$('walk-reroute').hidden;
 if(reroute){reroute.style.display=offRoute?'':'none';const nc=refRoot.querySelector('.next-crossing');if(nc)nc.style.display=offRoute?'none':'';}
 if(walkingNow){
  const left=$('w-left')?.textContent,time=$('w-time')?.textContent,sp=$('w-pace')?.textContent;
  if(left&&left!=='—')document.getElementById('ref-left').textContent=left;
  if(refProgress!=null&&!offRoute)document.getElementById('ref-time').textContent=mins(Math.max(0,route.length-refProgress)/(trackSpeed(walkTrack)||SPEED));
  if(gpsFresh()&&refNaverHandle)refNaverHandle.setCurrent(gpsFix.ll);
  if(sp&&sp!=='—')document.getElementById('ref-speed').textContent=sp;
  // 엔진의 다음 안내를 종류별로 나눠 쓴다: '다음 …'만 'N m 후', 신호 횡단만 아래 '다음 횡단보도' 칸에.
  const nl=$('next-label')?.textContent||'',nd=$('next-dist')?.textContent,ns=$('next-state')?.textContent;
  const head=document.getElementById('ref-next-distance'),line=document.getElementById('ref-instruction'),sumOut=document.getElementById('ref-next-summary');
  if(offRoute){head.textContent='경로 밖';line.textContent=$('walk-location')?.textContent||'경로에서 벗어났어요. 내 위치에서 다시 찾을 수 있어요.';}
  else if(nl==='도착'){head.textContent='도착';line.textContent=ns||'도착지 근처예요';document.getElementById('ref-left').textContent='도착';document.getElementById('ref-time').textContent='—';if(sumOut)sumOut.textContent='도착지 근처예요';}
  else if(nd&&gpsFresh()){
   head.textContent=nl.startsWith('다음')?nd+' 후':nl.startsWith('남은')?'남은 '+nd:'위치 확인 중';
   line.textContent=ns||'경로를 따라 걸어가세요.';
   if(sumOut&&nl.startsWith('다음 횡단보도'))sumOut.textContent=nd+' · '+(ns||'현장 신호 확인');
  }
 }
},1000);
