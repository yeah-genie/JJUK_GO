/* Image-reference presentation adapter. Production sources and gates are unchanged. */
const refParams = new URLSearchParams(location.search);
const refSample = refParams.get('sample') === '1';
const refRoot = document.getElementById('reference-app');
refRoot.classList.toggle('live-ui',!refSample);
document.documentElement.dataset.theme=refSample?'light':store.get('referenceTheme','light')==='asphalt'?'asphalt':'light';
const refIcon = name => `<span class="mi" aria-hidden="true">${name}</span>`;
const refPlaces = [
  {name:'낙산공원',sub:'서울 종로구 낙산길 41',ll:[127.0075,37.5806],kind:'공원'},
  {name:'대학로 마로니에공원',sub:'서울 종로구 대학로 104',ll:[127.0027,37.5803],kind:'공원'},
  {name:'동대문역사문화공원',sub:'서울 중구 을지로 281',ll:[127.0095,37.5665],kind:'공원'}
];
let refScreen='home', refPick='to', refSearchHits=[], refPaused=false, refSound=true, refNavigating=false;
let refMarkers=[], refRoute=null, refSearchSeq=0, refGPSMessage='', refNaverHandle=null, refMapEpoch=0, refSplashTimer=null, refDataStatus=null, refPendingRecenter=false;
let refSignals=[],refSignalMarkers=[],refSignalPopup=null,refSelectedSignal=null,refSignalFacts={},refReplay=null;
let refPosterSkin='asphalt',refPosterPhoto=null;
let refHomeMoveHooked=false,refPlace=null,refSearchFrom='home',refHomeCenter=null,refDep=0,refWake=null,refLastSpoken='',refFollow=true,refFollowZoomed=false,refLastFollow=0,refDragHooked=false,refRerouting=false,refProgress=null,refIgnoreUntil=0,refSettingsFromResult=false,refFindError=null,refArrivalCache={key:'',map:new Map()};
const refHistory=(id,d)=>{const f=refSignalFacts[id]?.[d];return f?.[dayTypeNow()]||f?.wd||f?.we||null;};
const refSignalModelBase=window.JJUKGO_SIGNAL_EVIDENCE.create({now:()=>SIG.now(),speed:()=>SPEED,meta:id=>SIGMETA.get(id),direction:d=>DIR_KO[d]||d,period:()=>planPeriodText(),plan:(...a)=>signalPlan(...a),history:refHistory,confidence:planConfidence,predict:(x,t)=>SIG.predictX(x,t),verdict:(...a)=>SIG.verdict(...a),arrival:x=>refArrival(x),preferArrival:()=>!refNavigating});
// 경로 위 횡단에 '내가 도착할 때' 시각을 준다. 계획 화면은 지금 출발, 걷는 중은 내 위치에서 남은 거리 기준.
// 앞 횡단에서 기다릴 시간도 더해 경로의 예상 대기 계산(routeWaits)과 같은 방식으로 센다. 주변 신호와 위치를 모를 때는 null(지금 기준).
// 지금 위치(from m)부터 남은 신호 횡단의 예상 대기 합(패턴이 있는 곳만). 결과 카드의 '신호 대기 포함' 시간과 같은 방식.
function refWaitAhead(r,from,sp){
 let t=0;const now=SIG.now();
 for(const c of r.x||[]){if(c.d<from)continue;if(!c.dir&&c.dirs&&!c.dirs.length)continue;const w=crossingWait(c,now+(c.d-from)/sp+t);if(w!=null)t+=w;}
 return t;
}
function refArrival(x){
 if(x.nearby||!Number.isFinite(x.d)||refScreen!=='walking')return null;
 const r=state.routes?.[state.focus];if(!r?.x?.includes(x))return null;
 const from=refNavigating?refProgress:0;if(from==null||x.d<from)return null;
 const now=SIG.now()+(refNavigating?0:refDep),sp=refNavigating?(trackSpeed(walkTrack)||SPEED):SPEED,key=Math.floor(now)+':'+state.focus+':'+Math.round(from);
 if(refArrivalCache.key!==key){
  const map=new Map();let t=0;
  for(const c of r.x){if(c.d<from)continue;if(!c.dir&&c.dirs&&!c.dirs.length)continue;const at=now+(c.d-from)/sp+t;map.set(c,at);const w=crossingWait(c,at);if(w!=null)t+=w;}
  refArrivalCache={key,map};
 }
 return refArrivalCache.map.get(x)??null;
}
// 이 시간대 패턴이 없으면 남은 초를 셀 수 없다. 다른 날 기록을 지금처럼 보이게 하지 않는다.
// 패턴만 확인된 신호(확신 기준 미통과)도 빨강·초록을 보여 준다. 단 '검증 중'으로 구분하고 경로 계산·신호 띠에는 쓰지 않는다.
// 1) 이 요일 종류·시간대 패턴이 있으나 다른 날 대조가 부족 → '검증 중'  2) 같은 시간대 다른 요일 종류 패턴만 있음 → '평일/주말 기록 기준'
// 기준 시각(위상)이 없는 기록(초록 길이만 아는 곳)은 색을 지어내지 않고 회색으로 둔다. 매일 새벽 자료가 다시 만들어지면 자동으로 늘어난다.
function refLoosePlan(id,t,dir){
 const r=signalPlan(id,t,dir);if(r)return {r,basis:'검증 중'};
 const bands=REAL.signals?.[id]?.bands||[],local=((t%86400)+86400)%86400,band=bands.find(b=>local>=b.start&&local<b.end);
 if(!band)return null;const we=dayTypeNow()==='we',o=(we?band.legs:band.legsWe)?.[dir];
 return o?{r:o,basis:we?'평일 기록 기준':'주말 기록 기준'}:null;
}
function refLoosePhase(r,t){
 if(!r?.win?.length||!(r.c>=20&&r.c<=400)||!Number.isFinite(r.ref)||!Number.isFinite(r.day0??0))return null;
 const ph=((((r.day0||0)+((t%86400)+86400)%86400-r.ref)%r.c)+r.c)%r.c;let wait=Infinity;
 for(const[a,b]of r.win){for(const sh of[0,r.c])if(ph+sh>=a&&ph+sh<b)return {walk:true,rem:b-ph-sh};wait=Math.min(wait,((a-ph)%r.c+r.c)%r.c);}
 return Number.isFinite(wait)?{walk:false,wait}:null;
}
function refSignalModel(x){
 const item=refSignalModelBase(x);
 if(item.trusted||!x.dir||x.s==null||x.s==='unmapped')return item;
 const t=SIG.now(),lp=refLoosePlan(x.s,t,x.dir),ph=lp&&refLoosePhase(lp.r,t);if(!ph)return item;
 const left=Math.max(0,Math.ceil(ph.walk?ph.rem:ph.wait));
 Object.assign(item,{tentative:true,state:ph.walk?'walk':'wait',remainingSeconds:left,countdown:ph.walk?`${left}초 뒤 빨간불`:`${left}초 뒤 초록불`,
  statusLabel:(ph.walk?'지금 초록':'지금 빨강')+'(예상·'+lp.basis+')',secondsLabel:`${ph.walk?'지금 초록':'지금 빨강'} · 약 ${left}초 뒤 ${ph.walk?'빨간불':'초록불'} (예상·${lp.basis})`,
  reason:'기록이 적어 몇 초 어긋날 수 있어요. 자료가 쌓이면 자동으로 더 정확해져요 · 현장 신호를 함께 확인하세요',sourceLabel:engineSourceLabel(lp.basis)});
 return item;
}
function engineSourceLabel(basis){return '과거 신호 기록 패턴 · '+basis+' · 실시간 아님';}
function refSignalTitle(item){return item.trusted||item.tentative?item.secondsLabel:'남은 시간 모름';}
function refRowText(item){return item.trusted||item.tentative?item.secondsLabel:'신호 시간 모름 · 현장 신호를 확인하세요';}
function refSignalDescription(item){return (item.geometrySummary?item.geometrySummary+' · ':'')+(!item.trusted&&item.historySummary?'이 시간대 기록이 없어 초를 셀 수 없어요. '+item.historySummary.replace(' (이력 추정)','')+'(다른 날 기록) · ':'')+item.reason;}
function refSignalClass(item){return item.state==='wait'?'red':item.state==='walk'?'':item.historyLabel?'history':'gray';}
function refSignalHTML(item){const preview=!item.trusted&&item.recordedPattern;return `<div class="signal-detail-card"><button data-ref-action="close-signal" aria-label="신호 정보 닫기">${refIcon('close')}</button><h3>${esc(item.label)}</h3>${preview?'<div class="signal-replay" hidden><small>기록 패턴 재생 · 현재 신호 아님</small><strong data-replay-count></strong><small>시작 위치를 임의로 잡은 시연</small></div>':''}<strong data-signal-value>${esc(refSignalTitle(item))}</strong>${preview?'<button class="pattern-preview-button" data-ref-action="preview-pattern">기록 패턴 보기</button>':''}<small class="signal-disclaimer">패턴으로 추정 · 실시간 신호 아님</small><details class="signal-more"><summary>자료 기준 보기</summary><p>${esc(refSignalDescription(item))}</p><small>${esc(item.sourceLabel)}</small></details></div>`;}
function refPaintReplay(){
 if(!refReplay||refSelectedSignal?.key!==refReplay.key)return;
 const phase=window.JJUKGO_SIGNAL_EVIDENCE.replayPhase(refReplay.pattern,(Date.now()-refReplay.started)/1000),panel=document.querySelector('.signal-detail-card .signal-replay');
 if(!phase||!panel)return;
 panel.hidden=false;panel.classList.toggle('replay-green',phase.state==='walk');panel.classList.toggle('replay-red',phase.state==='wait');
 panel.querySelector('[data-replay-count]').textContent=phase.state==='walk'?`초록 ${phase.seconds}초 남음 · 시연`:`${phase.seconds}초 뒤 초록 · 시연`;
}
function refStartReplay(){if(!refSelectedSignal?.recordedPattern)return;const active=refReplay?.key===refSelectedSignal.key;refReplay=active?null:{key:refSelectedSignal.key,pattern:refSelectedSignal.recordedPattern,started:Date.now()};const button=document.querySelector('.pattern-preview-button');if(button)button.textContent=active?'기록 패턴 보기':'재생 멈추기';const panel=document.querySelector('.signal-replay');if(panel)panel.hidden=active;document.querySelector('.signal-detail-card')?.classList.toggle('replaying',!active);if(!active)refPaintReplay();}
function refCloseSignal(){refReplay=null;refSignalPopup?.remove();refSignalPopup=null;refSelectedSignal=null;refNaverHandle?.closeSignal?.();refRoot.classList.remove('signal-detail-open');}
function refOpenSignal(item){
 refReplay=null;
 refSelectedSignal=item;refRoot.classList.add('signal-detail-open');
 if(refNaverHandle&&refRoot.dataset.mapProvider==='naver'){refNaverHandle.showSignal(item);return;}
 refSignalPopup?.remove();refSignalPopup=new maplibregl.Popup({closeButton:false,offset:27,maxWidth:'245px',className:'reference-signal-popup'}).setLngLat(item.ll).setHTML(refSignalHTML(item)).addTo(map);
 map.easeTo({center:item.ll,offset:[0,Math.max(70,map.getContainer().clientHeight/2-60)],duration:250});
}
function refMakeSignals(route,center=null,radius=150,max=8){
 const raw=[...(route?.x||[]).filter(x=>x.dir||x.dirs?.length)];
 // Cross-count summaries have no controller/direction; do not invent a phase for them.
 for(const x of (route?.m?.xlist||[]).filter(x=>x.sig))if(!raw.some(r=>distLL(r.mid||r.at,x.at)<35))raw.push({...x,s:'unmapped',dir:null});
 // 계획 화면은 경로 위 신호만 보인다(주변 신호는 '어느 길이 나은지'와 상관없고 경로의 빨간불처럼 읽힌다).
 // 걷는 중에는 지금 보는 곳 근처 150m 안의 신호만 흐리게, 최대 8개.
 const near=center?[center]:[];
 const nearby=[];
 for(const[id,m]of SIGMETA)if(near.some(p=>distLL(p,m.ll)<radius)){
  const dirs=['n','e','s','w'].filter(d=>signalPlan(id,SIG.now(),d)||refHistory(id,d));
  if(!dirs.length&&!raw.some(x=>String(x.s)===String(id)))nearby.push({s:id,dir:null,at:m.ll,len:null,nearby:true,locationOnly:true});
  for(const d of dirs){
   if(raw.some(x=>String(x.s)===String(id)&&(x.dir===d||x.dirs?.includes(d))))continue;
   // 같은 교차로의 방향별 횡단을 한 점에 겹치지 않게, 그 방향 다리 쪽으로 약 15m 옮겨 둔다(n=북쪽 다리 …)
   const k=15,dl={n:[0,k/110540],s:[0,-k/110540],e:[k/(111320*Math.cos(m.ll[1]*Math.PI/180)),0],w:[-k/(111320*Math.cos(m.ll[1]*Math.PI/180)),0]}[d]||[0,0];
   nearby.push({s:id,dir:d,at:[m.ll[0]+dl[0],m.ll[1]+dl[1]],len:null,nearby:true});
  }
 }
 nearby.sort((a,b)=>Number(!!trustedPlan(b.s,SIG.now(),b.dir))-Number(!!trustedPlan(a.s,SIG.now(),a.dir))||Math.min(...near.map(p=>distLL(p,a.at)))-Math.min(...near.map(p=>distLL(p,b.at))));
 raw.push(...nearby.slice(0,max));
 return raw.map(refSignalModel);
}
function refRefreshNearby(center){
 if(refSample)return;
 if(refScreen==='home'){refHomeCenter=center;refSignals=refMakeSignals(null,center,350,14);refNaverHandle?.updateSignals(refSignals);if(refRoot.dataset.mapProvider!=='naver')refDrawSignalMarkers();return;}
 if(refScreen!=='walking'||!refNavigating)return;
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
 const wb=refRoot.querySelector('.ma-navbottom,.ma-sheet,.walk-bottom');
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
function refPlaceInput(kind,item){
 const from=kind==='from',label=from?(refSample?'현재 위치':'출발지'):'도착지',name=item?.name||(from?(refSample?'혜화역 (4호선)':'출발지를 선택하세요'):'어디로 갈까요?');
 const content=`${refIcon(from?'circle':'location_on').replace('class="mi"','class="mi '+(from?'origin':'destination')+'-icon"')}<span class="place-text"><small>${label}</small><strong id="ref-${from?'origin':'destination'}">${esc(name)}</strong></span>`;
 if(refSample)return `<button class="place-input" data-ref-pick="${kind}">${content}<span class="mi close">close</span></button>`;
 return `<div class="place-input"><button class="place-select" data-ref-pick="${kind}">${content}</button>${item?`<button class="place-clear" data-ref-clear="${kind}" aria-label="${label} 지우기">${refIcon('close')}</button>`:from?`<button class="place-clear" data-ref-action="gps" aria-label="내 위치로 출발">${refIcon('my_location')}</button>`:refIcon('chevron_right')}</div>`;
}
// ---------- 홈: 네이버 지도처럼 지도가 첫 화면. 위 검색창, 장소를 고르면 아래 장소 카드(출발/도착). 쭉고만의 것: 주변 신호 남은 초 ----------
// ---------- 지하철 실시간 도착(서울 열린데이터광장) ----------
// 실시간 도착은 제공기관 값(실시간). 걷는 시간·신호 대기는 쭉고 예상. 둘을 합쳐 '이번 열차 / 다음 열차'를 고른다. 뛰라고 하지 않는다.
const REF_STATION_INSIDE=120;   // 역 입구→승강장 이동 가정(역마다 다름, 화면에 '가정'이라고 적는다)
let refArr={station:null,at:0,data:null,timer:null};
const refIsStation=p=>!!p&&(p.kind==='역'||/지하철/.test(p.kind||'')||/역$/.test(p.name||'')&&/역|지하철/.test(p.sub||p.kind||''));
async function refLoadArrivals(name){
 if(refArr.station===name&&Date.now()-refArr.at<20000)return refArr.data;
 try{const r=await fetch('/api/subway-arrival?station='+encodeURIComponent(name));const j=await r.json();refArr={...refArr,station:name,at:Date.now(),data:j};}catch{refArr={...refArr,station:name,at:Date.now(),data:{error:'지하철 실시간 정보에 연결하지 못했어요.'}};}
 return refArr.data;
}
function refArrRows(data,walkS){
 if(!data)return '<p class="arr-note">실시간 도착을 불러오는 중…</p>';
 if(data.enabled===false)return '';
 if(data.error)return `<p class="arr-note">${esc(data.error)}</p>`;
 const age=(Date.now()-refArr.at)/1000,list=(data.arrivals||[]).filter(a=>a.seconds!=null||a.message);
 if(!list.length)return `<p class="arr-note">${esc(data.note||'지금은 도착 예정 열차 정보가 없어요(운행 시간 밖일 수 있어요).')}</p>`;
 const groups=new Map();for(const a of list){const k=a.line+'|'+a.updown;if(!groups.has(k))groups.set(k,[]);if(groups.get(k).length<2)groups.get(k).push(a);}
 const need=walkS!=null?walkS+REF_STATION_INSIDE:null;
 const farNote=need!=null&&list.every(a=>a.seconds!=null&&a.seconds-age<need)?`<p class="arr-note">역까지 약 ${Math.round(need/60)}분이라 지금 보이는 열차는 타기 어려워요. 가까워지면 다시 확인해 드려요.</p>`:'';
 return farNote+[...groups.values()].map(g=>{const a0=g[0];let pickShown=false;
  return `<div class="arr-group"><div class="arr-line"><i style="background:${esc(a0.color)}"></i><strong>${esc(a0.line)}</strong><small>${esc((a0.heading||'').replace(/\s*-\s*/,' → '))}</small></div>${g.map(a=>{
   const left=a.seconds!=null?Math.max(0,Math.round(a.seconds-age)):null,txt=left!=null?(left<30?'곧 도착':`${Math.floor(left/60)}분${left%60?` ${left%60}초`:''} 후`):a.message;
   let fit='';if(need!=null&&left!=null){const margin=left-need;if(margin<0)fit='<em class="miss">못 탈 것 같아요</em>';else if(margin<60)fit='<em class="tight">빠듯해요(예상)</em>';else{fit=`<em class="ok">여유 약 ${Math.floor(margin/60)}분(예상)${pickShown?'':' · 이 열차 기준'}</em>`;pickShown=true;}}
   return `<div class="arr-row"><span>${esc(txt)}</span><small>${esc(a.position||'')}${a.last?' · 막차':''}</small>${fit}</div>`;}).join('')}</div>`;}).join('')+`<p class="arr-note">실시간 · ${esc(data.source||'')}${need!=null?` · 걷는 시간(신호 대기 포함 예상) + 역 안 이동 약 ${REF_STATION_INSIDE/60}분 가정`:''}</p>`;
}
function refPaintArrivals(){
 const host=document.getElementById('ref-arr');if(!host)return;
 const station=host.dataset.station,r=state.routes?.[state.focus],walkS=refScreen==='walking'&&!refNavigating&&r?refTotal(r):null;
 if(refArr.station!==station||Date.now()-refArr.at>20000)refLoadArrivals(station).then(()=>{if(document.getElementById('ref-arr')===host)host.innerHTML=refArrRows(refArr.data,walkS);});
 else host.innerHTML=refArrRows(refArr.data,walkS);
}
function refMapHome(){
 const recent=refRecent(),trusted=refSignals.filter(x=>x.trusted||x.tentative).length,p=refPlace;
 const sheet=p?`<div class="nm-place"><button class="icon-button nm-close" data-ref-action="place-close" aria-label="장소 닫기">${refIcon('close')}</button>
   <strong>${esc(p.name)}</strong><small>${esc([refHitDist(p),p.sub||p.kind||''].filter(Boolean).join(' · '))}</small>
   ${refIsStation(p)?`<div class="arr" id="ref-arr" data-station="${esc(p.name)}"><p class="arr-note">실시간 도착을 불러오는 중…</p></div>`:''}
   <div class="nm-place-btns"><button class="white-button" data-ref-action="place-from">출발</button><button class="yellow-button" data-ref-action="place-to">${refIcon('directions_walk')}도착</button></div></div>`
  :refFindError?`<div class="find-error" role="alert"><strong>${esc(refFindError.title)}</strong><p>${esc(refFindError.text||'')}</p><div>${refFindError.retry?'<button data-ref-action="find">다시 시도</button>':''}<button data-ref-action="home-search">${refFindError.pick==='from'?'출발지':'도착지'} 다시 고르기</button></div></div>`
  :`<div class="nm-home-card"><div><strong>${refIcon('traffic')}주변 신호</strong><small id="ref-home-signal">${trusted?`남은 시간을 아는 신호 ${trusted}곳 · 아이콘 숫자는 남은 초(예상)`:'지도를 움직여 주변 신호를 찾아보세요 · 실시간 아님'}</small></div><button class="yellow-button nm-route" data-ref-action="home-search">${refIcon('directions')}길찾기</button></div>`;
 return `<section class="page walking ma-home"><div class="walk-map"><div id="ref-map" class="mapbox"></div><div class="map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · Mapzen / USGS</div></div>
 <div class="nm-top"><button class="nm-search-bar" data-ref-action="home-search">${refIcon('search')}<span>${p?esc(p.name):'장소, 주소 검색'}</span></button><button class="icon-button nm-menu" data-ref-screen="settings" aria-label="설정">${refIcon('menu')}</button></div>
 ${recent.length&&!p?`<div class="nm-chips">${recent.map((r,i)=>`<button data-ref-chip="${i}">${refIcon('schedule')}${esc(r.name)}</button>`).join('')}</div>`:''}
 <div class="map-buttons"><button data-ref-action="recenter" aria-label="내 위치">${refIcon('my_location')}</button></div>
 <div class="ma-sheet nm-sheet">${sheet}</div></section>`;
}
function refDrawSignalMarkers(){
 refSignalMarkers.forEach(({elm})=>elm.closest('.maplibregl-marker')?.remove());refSignalMarkers=[];
 for(const item of refSignals){
  const elm=el('signal-disc '+refSignalClass(item)+' estimated',refIcon(item.historyLabel&&!item.trusted&&!item.tentative?'history':'directions_walk')+((item.trusted||item.tentative)&&Number.isFinite(item.remainingSeconds)?`<span class="sig-sec${item.tentative?' tentative':''}">${item.remainingSeconds}</span>`:''));
  elm.setAttribute('role','button');elm.tabIndex=0;elm.setAttribute('aria-label',item.label+' 신호 정보');
  elm.addEventListener('click',e=>{e.stopPropagation();refOpenSignal(item);});
  refMark(item.ll,elm);refSignalMarkers.push({item,elm});
 }
}
function refHome(){
 if(!refSample)return refMapHome();
 const pace=refPace(),from=state.from;
 return `<section class="page home ${refSample?'':'home-live'}"><header class="topbar">${refSample?'':'<span class="home-wordmark">쭉고</span>'}<button class="icon-button" data-ref-screen="settings" aria-label="걷기 설정">${refIcon('settings')}</button></header>
 <h1>어디로 걸어갈까요?</h1><p class="small intro">${refSample?'신호를 고려한 더 스마트한 보행 경로를 안내해요.':'조금 더 걸어도, 계단과 횡단 부담이 덜한 길.'}</p>
 <div class="trip-inputs">${refPlaceInput('from',from)}${refPlaceInput('to',state.to)}
 <button class="icon-button swap" data-ref-action="swap" aria-label="출발 도착 바꾸기">${refIcon('swap_vert')}</button></div>
 <button class="yellow-button find" data-ref-action="find">${refIcon('search')}길찾기</button>${refFindError?`<div class="find-error" role="alert"><strong>${esc(refFindError.title)}</strong><p>${esc(refFindError.text||'')}</p><div>${refFindError.retry?'<button data-ref-action="find">다시 시도</button>':''}<button data-ref-pick="${refFindError.pick||'to'}">${refFindError.pick==='from'?'출발지':'도착지'} 다시 고르기</button></div></div>`:''}
 <button class="pace-link" data-ref-screen="settings"><span class="walk-disc">${refIcon('directions_walk')}</span><span class="pace-text"><small>내 걷기 속도</small><strong>${pace.label}${refSample||readProfile().learned.speed||readProfile().mode==='manual'?` (약 ${pace.value}km/h)`:''}</strong><p>${pace.detail}</p></span>${refIcon('chevron_right')}</button>
 <div class="section-heading"><span>최근 목적지</span>${refSample||refRecent().length?'<button data-ref-action="more">더보기 ›</button>':''}</div><div>${refRecentRows(refRecent())||'<p class="empty">최근 찾아본 장소가 여기에 보여요.</p>'}</div>
 <button class="crossing-entry" data-ref-action="crossing-map" aria-label="${refSample?'횡단 시간 지도':'길의 횡단과 계단 살펴보기'}"><span class="map-entry-icon">${refIcon('location_on')}</span><span class="row-copy"><strong>${refSample?'횡단 시간 지도':'길의 횡단·계단 살펴보기'}</strong><small>${refSample?'주변 횡단보도의 신호와 대기시간을<br>지도로 확인해보세요.':'목적지를 고르면 경로에서 확인할 수 있어요.'}</small></span>${refIcon('chevron_right')}</button></section>`;
}
function refSearch(){
 const names=['낙산공원','마로니에공원','대학로','서울대학교','동대문역사문화공원'];
 return `<section class="page search ${refSample?'':'search-live'}">${refHeader(refSample?'장소 검색':refPick==='from'?'출발지 선택':'도착지 선택')}<div class="search-box">${refIcon('search')}<input id="ref-query" aria-label="장소 검색" placeholder="${refSample?'장소, 주소 검색':'장소·주소 검색 · 출입구도 확인해 주세요'}" value="${refSample?'낙산공원':''}" autocomplete="off"><button type="button" data-ref-action="clear-query" aria-label="검색어 지우기"${refSample?'':' hidden'}>${refIcon('cancel')}</button>${refSample?'':'<button type="button" id="ref-search-submit" data-ref-action="search-submit" aria-label="장소 검색 실행">검색</button>'}</div>
 ${refSample?`<nav class="tabs" aria-label="검색 분류">${['전체','장소','주소','최근 검색'].map((n,i)=>`<button class="${i?'':'active'}" data-ref-tab="${n}">${n}</button>`).join('')}</nav>`:''}
 <div id="ref-results" aria-live="polite"></div>${refSample?`<div class="section-heading"><span>최근 검색</span><button data-ref-action="clear-recent">전체 삭제</button></div><div id="ref-search-recent">${names.map(n=>`<button class="recent-row" data-ref-query="${n}">${refIcon('schedule')}<span class="row-copy"><strong>${n}</strong></span></button>`).join('')}</div>`:''}</section>`;
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
 return `<div class="route-burden"><details><summary><span>이 길의 보행 부담</span><span><span class="burden-toggle-label">자세히</span> ${refIcon('expand_more')}</span></summary><div class="burden-comparison"><h3>${R.alt?'길 조건 비교':'이 길의 조건'}</h3><table><thead><tr><th>조건</th>${R.alt?'<th>편한 길</th><th>빠른 길</th>':'<th>선택한 길</th>'}</tr></thead><tbody>${rows.map(([key,label])=>`<tr><th>${label}</th>${R.alt?'<td>'+value(R.jjuk,key)+'</td>':''}<td>${value(R.short,key)}</td></tr>`).join('')}</tbody></table><p>신호 대기는 과거 신호 기록으로 낸 예상(지금 출발 기준) · 경사는 지면 높이로 추정<br>턱·보도 폭·노면·경사로 연결은 아직 미확인</p></div></details><div class="burden-facts">${[['stairs','stairs','확인된 계단'],['landscape','steep','급경사·추정'],['trending_up','gain','오르는 높이']].map(([icon,key,label])=>`<div>${refIcon(icon)}<span><small>${label}</small><strong>${value(r,key)}</strong></span></div>`).join('')}</div></div>`;
}
function refSplash(){return `<section class="page reference-splash"><div class="reference-brand"><div id="ref-brand-mark"></div><h1>쭉고</h1><p>내 걸음으로, 쭉.</p></div><p class="reference-splash-foot">조금 더 걸려도, 더 편한 길.</p><button class="reference-splash-skip" data-ref-screen="home">건너뛰기</button></section>`;}
function refThemeChoices(){
 const theme=store.get('referenceTheme','light');
 return `<div class="theme-setting"><span>화면 스타일</span><div role="group" aria-label="화면 스타일">${[['light','밝게'],['asphalt','아스팔트']].map(([key,name])=>`<button data-ref-theme="${key}" aria-pressed="${theme===key}">${name}</button>`).join('')}</div></div>`;
}
function refSettings(){
 const p=readProfile(),pace=refPace(),auto=refSample?true:p.autoEnabled&&p.mode==='auto';
 const selected=refSample?4.8:Math.round(walkSpeed()*3.6*10)/10;
 const header=refSettingsFromResult?`<header class="topbar"><button class="icon-button" data-ref-action="back-result" aria-label="경로로 돌아가기">${refIcon('chevron_left')}</button><h2>길 조건</h2><span></span></header>`:refHeader('걷기 설정');
 return `<section class="page settings ${refSample?'':'settings-live'}">${header}${!refSample&&!refSettingsFromResult?refThemeChoices():''}<h3 class="setting-label">내 걷기 속도</h3>
 <div class="speed-summary"><span class="walk-disc">${refIcon('directions_walk')}</span><span class="pace-text"><small>${pace.label}</small><strong>${pace.pending?(p.autoEnabled===false?'임시 기준':'자동 맞춤'):pace.value+'<small> km/h</small>'}</strong><p>${pace.pending?'계산용 임시 기준 '+pace.value+'km/h'+(p.autoEnabled===false?' · 자동 학습 꺼짐':' · 걸으면 학습해요.'):pace.detail}</p></span>${refSample?refIcon('help'):''}</div>
 <div class="setting-row"><div class="setting-copy"><strong>자동으로 내 속도 학습하기</strong><p>${refSample?'실제 걸음 데이터를 기반으로<br>내 걷기 속도를 자동으로 설정해요.':'안내 중 측정한 걸음으로 맞춰요.'}</p></div>${refToggle('ref-auto',auto,'자동으로 내 속도 학습하기')}</div>
 <hr>${refSample?'':'<details class="manual-speed"><summary>직접 속도 설정'+refIcon('expand_more')+'</summary>'}<h3 class="setting-label manual-label">직접 설정하기</h3><div class="speed-options">${[['느리게',3.0],['보통',4.8],['빠르게',6.0]].map(([n,v])=>`<button class="speed-option ${Math.abs(selected-v)<.15?'active':''}" data-ref-speed="${v}" aria-pressed="${Math.abs(selected-v)<.15}">${refIcon('directions_walk')}<strong>${n}</strong><small>${v.toFixed(1)} km/h</small></button>`).join('')}</div>
 ${refSample?'':'</details>'}${!refSample&&refSettingsFromResult?`<h3 class="setting-label">출발 시각</h3><div class="ma-dep" role="group" aria-label="출발 시각">${[[0,'지금'],[300,'5분 뒤'],[600,'10분 뒤'],[900,'15분 뒤']].map(([v,l])=>`<button data-ref-dep="${v}" aria-pressed="${refDep===v}">${l}</button>`).join('')}</div>`:''}<h3 class="setting-label route-options">경로 옵션</h3><div class="setting-row">${refIcon('stairs')}<div class="setting-copy"><strong>계단 피하기</strong><p>${refSample?'가능한 계단이 적은 경로를 우선으로<br>추천해요.':'지도에 확인된 계단을 제외해요.'}</p></div>${refToggle('ref-stairs',refSample||p.avoidSteps,'계단 피하기')}</div>
 <div class="setting-row">${refIcon('signal_cellular_4_bar')}<div class="setting-copy"><strong>${refSample?'급경사 피하기':'급경사 덜 걷기'}</strong><p>${refSample?'가파른 오르막과 내리막 구간을 피해서<br>추천해요.':'추정 급경사가 적은 대안을 우선해요.'}</p></div>${refToggle('ref-slope',refSample||store.get('avoidSlope',true),'급경사 덜 걷기')}</div>
 <h3 class="budget-label">추가로 걸을 수 있는 시간</h3><p class="budget-copy">${refSample?'최단 경로 대비, 최대 몇 분까지 더 걸을 수 있는<br>대안 경로를 추천할지 설정해요.':'추가 시간 안에서 부담을 줄이는 길을 찾아요.'}</p><div class="budget-options">${[.5,1,2,3].map(v=>`<button class="${(refSample?1:store.get('referenceBudget',p.budgetSeconds/60))===v?'active':''}" data-ref-budget="${v}">+${v}분</button>`).join('')}</div>
 ${refSample||refSettingsFromResult?'':`<details class="settings-notes"><summary>계산 기준${refIcon('expand_more')}</summary><p class="small" id="ref-data-source">${esc(refDataLabel())}</p><p class="small">신호는 과거 패턴 예상, 경사는 지형 추정이에요. 턱과 노면은 미확인입니다.</p></details>`}
 ${refSample||refSettingsFromResult?'':`<div class="setting-row">${refIcon('bar_chart')}<div class="setting-copy"><strong>익명 사용 기록 보내기</strong><p>대안이 있었는지, 어느 길을 골랐는지만 보내요.<br>위치·장소 이름·이동 경로는 보내지 않아요.</p></div>${refToggle('ref-log',!store.get('nolog',false),'익명 사용 기록 보내기')}</div>`}${!refSample&&refSettingsFromResult?'<div class="settings-apply"><button class="yellow-button" data-ref-action="back-result">이 조건으로 길찾기</button></div>':''}</section>`;
}
function refNoAltText(){
 const extra=Math.round((state.budget||0)/30)/2;
 return extra>0?`추가 ${extra}분 안에서 부담을 더 줄이는 대안을 찾지 못했어요.`:'현재 조건에서 부담을 더 줄이는 대안을 찾지 못했어요.';
}
// Distances follow the route, not proximity to an unrelated controller on the map.
function refRouteEvents(route){
 if(!route?.coords?.length)return [];
 const rows=[],point=d=>{const i=route.cum?.findIndex(n=>n>=d);return i>=0?route.coords[i]:route.coords.at(-1);};
 for(const x of route.x||[])if(Number.isFinite(x.d))rows.push({kind:'signal',d:x.d,ll:x.mid||x.at||point(x.d),raw:x,title:'신호 횡단보도'});
 for(const x of route.m?.xlist||[]){
  const d=x.d+(route.cum?.[1]||0); // Count-only crossings start at the graph; include the origin connector.
  if(!Number.isFinite(d)||rows.some(r=>Math.abs(r.d-d)<25&&distLL(r.ll,x.at)<35))continue;
  rows.push({kind:x.sig?'signal':'crossing',d,ll:x.at,raw:null,title:x.sig?'신호 횡단보도':'횡단보도'});
 }
 for(const g of route.guides||[])if(Number.isFinite(g.d))rows.push({kind:'stairs',d:g.d,ll:point(g.d),title:'계단 구간'});
 let cursor=1,steep=null;
 for(const [u,v,e] of route.steps||[]){
  const d=route.cum?.[cursor];cursor+=edgePts(e,u).length-1;
  const end=route.cum?.[cursor],meters=e.f?.[2]||0;
  const known=e.cls!==4&&Number.isFinite(G.node.get(u)?.h)&&Number.isFinite(G.node.get(v)?.h);
  if(known&&meters>0&&Number.isFinite(d)&&Number.isFinite(end)){
   if(steep&&Math.abs(d-steep.end)<2){steep.meters+=meters;steep.end=end;}
   else{steep={kind:'steep',d,end,ll:point(d),meters,title:'급경사 포함 보행로'};rows.push(steep);}
  }else steep=null;
 }
 rows.sort((a,b)=>a.d-b.d);
 return [{kind:'from',d:0,ll:route.coords[0],title:state.from?.name||'출발'},...rows,{kind:'to',d:route.length,ll:route.coords.at(-1),title:state.to?.name||'도착'}];
}
function refItinerary(){
 const r=state.routes?.[state.focus];if(!r)return '';
 const icons={from:'trip_origin',to:'flag',signal:'traffic',crossing:'directions_walk',stairs:'stairs',steep:'landscape'};
 const events=refRouteEvents(r);
 return `<details class="route-itinerary"><summary><span>${refIcon('format_list_bulleted')}경로 상세</span>${refIcon('expand_more')}</summary><p class="itinerary-note">출발지부터의 거리 · 구간을 누르면 지도에서 보여요.</p><ol>${events.map((e,i)=>`<li><button data-ref-event="${i}" aria-label="${esc(e.title)} 지도에서 보기"><span class="itinerary-icon ${e.kind}">${refIcon(icons[e.kind])}</span><span class="itinerary-copy"><small>${e.kind==='from'?'출발':e.kind==='to'?'도착':km(e.d)+' 지점'}</small><strong>${esc(e.title)}</strong><span>${e.kind==='signal'?(e.raw?'신호 정보 · 눌러서 예상과 출처 확인':'시간·횡단 방향 미확인 · 현장 신호 확인'):e.kind==='stairs'?'지도에 표시된 계단 · 단차는 별도 미확인':e.kind==='steep'?'이 보행로에 급경사 약 '+Math.round(e.meters)+'m · 지형 추정':e.kind==='crossing'?'현장 신호와 보행로를 확인하세요':e.kind==='to'?'출입구와 마지막 보행로를 확인하세요':'선택한 '+(state.routes.alt&&state.focus==='jjuk'?'편한 길':'빠른 길')}</span></span>${refIcon('chevron_right')}</button></li>`).join('')}</ol><p class="itinerary-note">턱·보도 폭·노면과 경사로 연결은 아직 미확인입니다. 계단·경사가 적어도 휠체어 통행 가능을 뜻하지 않아요.</p></details>`;
}
function refWalkingLegacy(){
 const demo=refSample,pace=refPace(),r=state.routes?.[state.focus],length=r?km(r.length):'—',planning=!demo&&!refNavigating,comfort=refComfort();
 return `<section class="page walking"><div class="walk-map"><div id="ref-map" class="mapbox"></div><div class="map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · Mapzen / USGS</div></div>
 <div class="walk-instruction ${planning?'planning':''}"><div class="instruction-content"><span class="direction-disc">${refIcon(planning?'directions_walk':'arrow_upward')}</span><span class="instruction-copy"><strong id="ref-next-distance">${demo?'74m 후':planning?esc(state.routes?.alt?comfort.badge||comfort.headline:'걷는 시간이 짧은 길'):'위치 확인 중'}</strong><p id="ref-instruction">${demo?'횡단보도를 건너세요.':planning?esc(state.routes?.alt?comfort.sub:refNoAltText()):'경로를 따라 걸어가세요.'}</p></span>${planning?`<button class="icon-button sound" data-ref-action="conditions" aria-label="길 조건 바꾸기">${refIcon('tune')}</button>`:`<button class="icon-button sound" data-ref-action="sound" aria-label="음성 안내" aria-pressed="${refSound}">${refIcon(refSound?'volume_up':'volume_off')}</button>`}</div>${refRouteOptions()}<div class="instruction-progress"></div></div>
 <div class="map-buttons"><button data-ref-action="recenter" aria-label="현재 위치">${refIcon('near_me')}</button><button data-ref-action="layers" aria-label="지도 레이어">${refIcon('layers')}</button><button data-ref-action="recenter" aria-label="지도 중심 맞추기">${refIcon('my_location')}</button></div>
 <div class="walk-bottom"><div class="walk-metrics"><div><small>${planning?'걷는 거리':'남은 거리'}</small><strong id="ref-left">${demo?'1.1 km':length}</strong></div><div><small>${demo?'남은 시간':planning?'예상 보행':'남은 보행'}</small><strong id="ref-time">${demo?'15분':r?mins(r.length/SPEED):'—'}</strong><p id="ref-arrival">${demo?'(오후 2:41 도착 예정)':pace.pending?'임시 속도 · 신호 대기 별도':'신호 대기 별도'}</p></div><div><small>내 속도</small><strong id="ref-speed">${demo?'4.8':pace.label==='아직 측정 전'?'—':pace.value}<span> km/h</span></strong></div></div>
 ${planning?refBurden():`<button class="next-crossing" data-ref-action="next-crossing"><span class="signal-disc ${demo?'':'gray'}">${refIcon('directions_walk')}</span><span class="row-copy"><strong>다음 횡단보도</strong><small id="ref-next-summary">${demo?'74m · 횡단 가능 · 17초 남음':'위치 확인 후 안내해요'}</small></span>${refIcon('chevron_right')}</button><button class="yellow-button ref-reroute" data-ref-action="reroute" style="display:none">${refIcon('refresh')}<span>내 위치에서 다시 찾기</span></button>`}
 <div class="bottom-actions"><button class="${planning?'yellow-button':'white-button'}" data-ref-action="${planning?'start':'pause'}">${refIcon(planning?'directions_walk':refPaused?'play_arrow':'pause')}<span>${planning?'걷기 시작':refPaused?'다시 시작':'일시정지'}</span></button><button class="navy-button" data-ref-action="finish">${refIcon('stop')}${planning?'닫기':'경로 종료'}</button></div></div></section>`;
}

// ---------- 지도 앱 형식(네이버·카카오에 익숙한 사용자 기준) ----------
// 결과: 위 출발·도착 막대 + 아래 경로 카드(총 시간에 예상 신호 대기 포함). 걷기: 위 방향 카드 + 신호 초읽기 띠 + 아래 남은 시간 막대.
const REF_FAR_M=5000;
function refClock(sec){return new Date(Date.now()+sec*1000).toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Seoul'});}
function refTotal(route){const m=route?.m;if(!m)return null;return m.walk+(m.waitKnown?m.wait:0);}
function refBadge(key){
 const R=state.routes;if(!R?.alt)return key==='short'?'추천':'';
 if(key==='short')return '가장 빨리 걷는 길';
 const a=R.jjuk.m,b=R.short.m;
 if(a.waitKnown&&b.waitKnown&&b.wait-a.wait>=10||a.sig<b.sig)return '덜 멈추는 길';
 if(a.stairs<b.stairs)return '계단 적은 길';
 if(a.steep<b.steep||a.gain<b.gain)return '덜 가파른 길';
 return '다른 길';
}
function refSignalLine(m){
 if(!m||!Number.isFinite(m.waitTotal))return '신호 정보 확인 중';
 if(!m.waitTotal)return '신호 없는 길';
 const known=m.waitKnown?`신호 대기 ${m.wait<1?'거의 없음':'약 '+dur(m.wait)}`:'이 시간대 신호 기록 없음';
 return `${known} · 신호 ${m.sig}곳${m.waitKnown&&m.waitUnknown?` (${m.waitUnknown}곳 모름)`:''}`;
}
function refRouteBenefit(key){
 const R=state.routes;if(key!=='jjuk'||!R?.alt)return '';
 const a=R.jjuk.m,b=R.short.m;let benefit='';
 if(a.stairs<b.stairs)benefit=`계단 ${b.stairs-a.stairs}구간 덜 지나가요`;
 else if(refTerrainKnown(R.jjuk)&&refTerrainKnown(R.short)&&a.steep<b.steep)benefit=`급경사 약 ${Math.round(b.steep-a.steep)}m 덜 걸어요`;
 else if(a.sig<b.sig)benefit=`신호 횡단 ${b.sig-a.sig}곳 적어요`;
 else if(refTerrainKnown(R.jjuk)&&refTerrainKnown(R.short)&&a.gain<b.gain)benefit=`오르는 높이 약 ${Math.round(b.gain-a.gain)}m 적어요`;
 const extra=refTotal(R.jjuk)-refTotal(R.short);
 return benefit+(benefit&&extra>0?' · '+dur(extra)+' 더':'');
}
function refCard(key){
 const R=state.routes,r=R?.[key];if(!r)return '';
 const m=r.m,total=refTotal(r),on=state.focus===key||!R.alt,far=r.length>REF_FAR_M;
 const title=R.alt?(key==='jjuk'?'덜 부담스러운 길':'빠른 길'):'추천 경로',why=refRouteBenefit(key);
 const signal=!m.waitTotal?'신호 없는 길':m.waitKnown?'예상 신호 대기 '+dur(m.wait)+(m.waitUnknown?' · '+m.waitUnknown+'곳 미확인':''):'신호 '+m.sig+'곳 · 대기 시간 미확인';
 return `<button class="ma-card${on?' on':''}" data-ref-route="${key}" aria-pressed="${on}">
  <span class="ma-route-title">${title}${refIcon(on?'radio_button_checked':'radio_button_unchecked')}</span>
  <span class="ma-time"><strong>${mins(total)}</strong><span>${km(r.length)} · ${refClock(total+refDep)} 도착</span></span>
  ${why?`<span class="ma-why">${esc(why)}</span>`:''}
  ${on?`<span class="ma-sig">${esc(signal)}</span><span class="ma-meta">횡단보도 ${m.cross??m.sig}회 · 계단 ${m.stairs}구간${refTerrainKnown(r)?` · 오르막 ${Math.round(m.gain)}m`:''}</span>`:''}
  ${far&&on?'<span class="ma-warn">걷기엔 먼 길이에요. 대중교통도 함께 확인해 보세요.</span>':''}
 </button>`;
}
function refResult(){
 const R=state.routes;
 const cards=R?(R.alt?['jjuk','short']:['short']).map(refCard).join(''):'<p class="empty">경로가 없어요.</p>';
 return `<section class="page walking ma-result"><div class="walk-map"><div id="ref-map" class="mapbox"></div><div class="map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · Mapzen / USGS</div></div>
 <header class="ma-top"><button class="icon-button" data-ref-action="finish" aria-label="뒤로">${refIcon('arrow_back')}</button>
  <div class="ma-places"><button data-ref-pick="from"><i class="dot from"></i><span>${esc(state.from?.name||'출발지')}</span></button><button data-ref-pick="to"><i class="dot to"></i><span>${esc(state.to?.name||'도착지')}</span></button></div>
  <button class="icon-button" data-ref-action="swap-find" aria-label="출발 도착 바꾸기">${refIcon('swap_vert')}</button></header>
 <div class="map-buttons"><button data-ref-action="recenter" aria-label="내 위치">${refIcon('my_location')}</button><button data-ref-action="layers" aria-label="경로 전체 보기">${refIcon('route')}</button></div>
 <div class="ma-sheet"><div class="ma-sheet-head"><span><strong>걷기 경로</strong></span><span class="ma-head-btns"><button data-ref-action="share" aria-label="경로 공유">${refIcon('share')}</button><button data-ref-action="conditions">${refIcon('tune')}조건</button></span></div>
  <div class="ma-cards">${cards}${refIsStation(state.to)?`<div class="arr arr-route"><div class="arr-head">${refIcon('subway')}<strong>${esc(state.to.name)} 실시간 도착</strong></div><div id="ref-arr" data-station="${esc(state.to.name)}"><p class="arr-note">실시간 도착을 불러오는 중…</p></div></div>`:''}${refItinerary()}</div>
  ${R&&[R.short,R.alt?R.jjuk:null].filter(Boolean).some(x=>x.m.waitUnknown)?'<p class="ma-note compact-note">시간을 모르는 신호의 대기는 제외한 예상이에요.</p>':''}
  <button class="yellow-button ma-start" data-ref-action="start">${refIcon('navigation')}안내 시작</button></div></section>`;
}
function refNav(){
 const r=state.routes?.[state.focus],pace=refPace();
 return `<section class="page walking ma-nav"><div class="walk-map"><div id="ref-map" class="mapbox"></div><div class="map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · Mapzen / USGS</div></div>
 <div class="ma-turn"><span class="ma-turn-icon" id="ref-turn-icon">${refIcon('location_searching')}</span><span class="ma-turn-copy"><strong id="ref-next-distance">위치 확인 중</strong><p id="ref-instruction">위치를 잡는 중이에요. 잠시 기다려 주세요.</p></span><button class="icon-button sound" data-ref-action="sound" aria-label="음성 안내" aria-pressed="${refSound}">${refIcon(refSound?'volume_up':'volume_off')}</button></div>
 <div class="ma-banner" id="ref-signal-banner" hidden><span class="ma-light" id="ref-banner-light"></span><span><strong id="ref-banner-main"></strong><small id="ref-banner-sub"></small></span></div>
 <div class="map-buttons"><button data-ref-action="recenter" aria-label="내 위치">${refIcon('my_location')}</button><button data-ref-action="layers" aria-label="경로 전체 보기">${refIcon('route')}</button></div>
 <div class="ma-navbottom">
  <button class="next-crossing" data-ref-action="next-crossing"><span class="signal-disc gray">${refIcon('directions_walk')}</span><span class="row-copy"><strong>다음 횡단보도</strong><small id="ref-next-summary">위치 확인 후 안내해요</small></span>${refIcon('chevron_right')}</button>
  <button class="yellow-button ref-reroute" data-ref-action="reroute" style="display:none">${refIcon('refresh')}<span>내 위치에서 다시 찾기</span></button>
  <div class="ma-bar"><div class="ma-bar-copy"><strong id="ref-time">${r?mins(refTotal(r)):'—'}</strong><span><b id="ref-left">${r?km(r.length):'—'}</b> · <span id="ref-arrival">${r?refClock(refTotal(r))+' 도착':''}</span></span><small>내 속도 <b id="ref-speed">${pace.label==='아직 측정 전'?'걸으면 재요':pace.value+' km/h'}</b> · <span id="ref-timing-basis">출발지 기준 예상</span></small></div>
  <button class="ma-round" data-ref-action="pause" aria-label="${refPaused?'다시 시작':'일시정지'}">${refIcon(refPaused?'play_arrow':'pause')}</button><button class="ma-end" data-ref-action="finish">종료</button></div>
 </div></section>`;
}
// 아래 시트 높이에 맞춰 지도와 지도 버튼 위치를 정한다(빈 공간 없이 지도를 최대한 크게)
function refFitSheet(){
 const sheet=refRoot.querySelector('.ma-sheet,.ma-navbottom');if(!sheet)return;
 const h=Math.ceil(sheet.getBoundingClientRect().height),m=refRoot.querySelector('.walk-map'),b=refRoot.querySelector('.map-buttons');
 if(m)m.style.bottom=Math.max(0,h-20)+'px';if(b)b.style.bottom=(h+14)+'px';
}
// 안내 중 화면이 꺼지지 않게(지도 앱처럼). 화면이 꺼지면 브라우저가 위치를 멈추기 때문. 지원하지 않는 브라우저는 그냥 넘어간다.
async function refKeepAwake(on){
 try{if(on&&!refWake&&navigator.wakeLock){refWake=await navigator.wakeLock.request('screen');refWake.addEventListener?.('release',()=>{refWake=null;});}
  if(!on&&refWake){await refWake.release();refWake=null;}}catch{refWake=null;}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&refNavigating&&!refPaused)refKeepAwake(true);});
// 음성 안내: 위 카드 안내가 바뀌면 자동으로 읽는다(소리 켜짐일 때). 숫자만 바뀐 같은 안내는 다시 읽지 않는다. 재촉하는 말은 하지 않는다.
function refSpeak(text){
 if(!refSound||refSample||!('speechSynthesis'in window)||!text)return;
 const key=text.replace(/\d+m/,'').replace(/\d+초/g,'');if(key===refLastSpoken)return;refLastSpoken=key;
 try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='ko-KR';speechSynthesis.speak(u);}catch{}
}
function refWalking(){if(refSample)return refWalkingLegacy();return refNavigating?refNav():refResult();}
function refSummaryReal(){
 const rec=state.lastWalk,R=state.routes,r=R?.[state.focus],full=r&&rec.meters>=r.length*0.8,plan=r?refTotal(r):null;
 const stopS=Math.max(0,(rec.elapsedS||0)-(rec.moveS??rec.elapsedS??0));
 const a=R?.jjuk?.m,b=R?.short?.m,saved=R?.alt&&state.focus==='jjuk'&&a.waitKnown&&b.waitKnown&&a.waitUnknown<=b.waitUnknown?b.wait-a.wait:0;
 return `<section class="page summary"><header class="topbar"><button class="icon-button" data-ref-screen="home" aria-label="닫기">${refIcon('close')}</button></header><h1>오늘의 걸음</h1>
 <p class="intro">${full?esc((state.to?.name||'도착지')+'까지 걸었어요.'):`경로 중 ${km(rec.meters)}를 걸었어요.`}</p>
 <div class="total-card"><span class="walk-disc">${refIcon('directions_walk')}</span><div><small>걸은 시간</small><strong>${mins(rec.elapsedS)}</strong><p>${plan&&full?'출발 전 예상 '+mins(plan)+' · ':''}GPS로 잰 실제 기록</p></div></div>
 <div class="summary-metrics"><div><small>${refIcon('location_on')}걸은 거리</small><strong>${km(rec.meters)}</strong></div><div><small>${refIcon('pause_circle')}멈춘 시간</small><strong>${stopS<30?'거의 없음':mins(stopS)}</strong><p class="muted">정지 추정 · 원인 구분 안 됨</p></div></div>
 ${r?`<div class="ma-sumsig"><span>${refIcon('traffic')}</span><div><small>이 길의 신호 · 출발 전 예상</small><strong>${esc(refSignalLine(r.m))}</strong>${saved>=10?`<p>빠른 길보다 신호 대기가 약 ${esc(dur(saved))} 적은 길이었어요</p>`:''}</div></div>`:''}
 <div class="mini-map-wrap"><div class="mapbox" id="ref-summary-map"></div><div class="map-attribution">© OpenStreetMap · Mapzen / USGS</div></div><p class="small summary-map-caption">계획한 경로 · 실제 이동 궤적과 다를 수 있어요.</p>
 <div class="bottom-actions"><button class="white-button" data-ref-screen="home">${refIcon('home')}홈으로</button><button class="navy-button" data-ref-action="save">${refIcon('ios_share')}공유 카드</button></div></section>`;
}
function refSummary(){
 if(!refSample&&state.lastWalk?.meters>0)return refSummaryReal();
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
function refShare(){
 return `<section class="page share-page">${refHeader('걸음 공유','summary')}<p class="small">${refSample?'시각 예시 · 실제 이동 기록이 아닙니다.':'내 걸음으로 남긴 오늘.'}</p><div class="poster-preview"><canvas id="ref-poster" width="990" height="1800" role="img" aria-label="걸은 경로와 거리, 시간, 페이스 공유 카드"></canvas></div><div class="poster-styles" role="group" aria-label="카드 배경">${[['asphalt','아스팔트'],['light','밝게'],['transparent','투명']].map(([key,label])=>`<button data-ref-poster="${key}" aria-pressed="${refPosterSkin===key}">${label}</button>`).join('')}</div><div class="poster-photo-actions"><label class="white-button" for="ref-poster-photo">${refIcon('add_photo_alternate')}사진 넣기</label><input type="file" id="ref-poster-photo" accept="image/*" hidden>${refPosterPhoto?'<button data-ref-action="poster-clear-photo">사진 지우기</button>':''}</div><p class="small poster-privacy">사진은 서버로 보내지 않아요. 투명 카드는 사진 위에 얹어 쓸 수 있어요.</p><button class="yellow-button" data-ref-action="poster-save">${refIcon('download')}이미지 저장</button></section>`;
}
function refPaintPoster(){
 const c=document.getElementById('ref-poster');if(!c)return;
 const rec=refSample?{trace:[refFixtureRoute],meters:1100,elapsedS:900}:state.lastWalk,route=state.routes?.[state.focus],segments=(rec?.trace||[]).filter(s=>s.length>1),actual=!refSample&&segments.length>0;
 const lines=actual||refSample?segments:route?.coords?.length?[route.coords]:[],points=lines.flat(),ctx=c.getContext('2d');
 ctx.clearRect(0,0,c.width,c.height);ctx.save();ctx.scale(3,3);
 const light=refPosterSkin==='light',ink=light?'#242A32':'#F4F2E9',muted=light?'#59616D':'#B7BEC8';
 if(refPosterSkin==='photo'&&refPosterPhoto){const im=refPosterPhoto,k=Math.max(330/im.width,600/im.height);ctx.drawImage(im,(330-im.width*k)/2,(600-im.height*k)/2,im.width*k,im.height*k);ctx.fillStyle='rgba(0,0,0,.4)';ctx.fillRect(0,0,330,600);}
 else if(refPosterSkin!=='transparent'){ctx.fillStyle=light?'#F4F2E9':'#242A32';ctx.fillRect(0,0,330,600);}
 const text=(value,y,size,weight=600,color=ink)=>{ctx.fillStyle=color;ctx.font=`${weight} ${size}px "Noto Sans KR",sans-serif`;ctx.textAlign='center';ctx.fillText(value,165,y,300);};
 text('내 걸음으로, 쭉.',47,20,800);text(refSample?'시각 예시 · 실제 이동 기록 아님':actual?'GPS로 기록한 오늘의 걸음':'계획 경로 · 실제 이동 궤적 없음',69,10,500,muted);
 if(points.length){const cos=Math.cos(37.55*Math.PI/180),xs=points.map(p=>p[0]*cos),ys=points.map(p=>-p[1]),x0=Math.min(...xs),y0=Math.min(...ys),dx=Math.max(...xs)-x0,dy=Math.max(...ys)-y0,k=220/Math.max(dx,dy,1e-7);ctx.strokeStyle=light?'#946900':'#F6C343';ctx.lineWidth=4;ctx.lineJoin='round';ctx.lineCap='round';for(const line of lines){ctx.beginPath();line.forEach((p,i)=>{const x=55+(220-dx*k)/2+(p[0]*cos-x0)*k,y=95+(220-dy*k)/2+(-p[1]-y0)*k;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}}
 const meters=actual||refSample?rec.meters:route?.length,seconds=actual||refSample?rec.elapsedS:route?.m?.walk;
 text(meters>0?(meters/1000).toFixed(2):'—',377,49,900);text(actual||refSample?'킬로미터':'계획 거리 · km',398,11,500,muted);
 text(Number.isFinite(seconds)?dur(seconds):'—',451,25,800);text(actual||refSample?'걸은 시간':'예상 보행 시간',472,11,500,muted);
 const pace=(actual||refSample)&&meters>=100&&seconds>=60?Math.round(seconds/(meters/1000)):null;
 text(pace?`${Math.floor(pace/60)}'${String(pace%60).padStart(2,'0')}\"`:'—',518,25,800);text(pace?'평균 페이스 · 분/km':'평균 페이스 · 기록이 더 필요해요',539,11,500,muted);
 text('쭉고',575,16,900,light?'#242A32':'#F6C343');ctx.restore();
}
async function refSavePoster(){
 const c=document.getElementById('ref-poster');if(!c)return;
 const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!blob){refToast('저장하지 못했어요. 다시 시도해 주세요.');return;}
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=refSample?'쭉고-공유카드-시각예시.png':'쭉고-오늘의-걸음.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);refToast('공유 이미지를 저장했어요.');
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
async function refMountNaver(coords,summary,center=null){
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
  handle=window.JJUKGO_NAVER.render(node,{coords,showSeconds:refScreen==='home'||refNavigating,placeLL:refScreen==='home'&&refPlace?refPlace.ll:null,placeHTML:refPlace?refEndpointHTML('to',refPlace.name):null,altCoords:!summary&&!refNavigating&&state.routes?.alt?state.routes[state.focus==='jjuk'?'short':'jjuk'].coords:null,currentLL:gpsFresh()?gpsFix.ll:null,crossings,next:summary||!refNavigating?null:crossings.find(x=>!x.raw.nearby&&x.trusted&&(refProgress==null||x.raw.d>refProgress+3)),summary,sample:false,onSignalClick:refOpenSignal,onSignalClose:refCloseSignal,onPatternReplay:refStartReplay,signalHTML:refSignalHTML,signalTitle:refSignalTitle,signalDescription:refSignalDescription,onViewportChange:summary?null:refRefreshNearby,endpointHTML:{from:refEndpointHTML('from',state.from?.name),to:refEndpointHTML('to',state.to?.name)}});
  refNaverHandle=handle;
  if(!await handle.ready||epoch!==refMapEpoch){handle.destroy();node.remove();if(refNaverHandle===handle){refNaverHandle=null;refRoot.dataset.mapProvider='osm';}return;}
  if(center)handle.center(center,15);
  node.style.opacity='1';mapEl.style.opacity='0';mapEl.inert=true;mapEl.setAttribute('aria-hidden','true');refRoot.dataset.mapProvider='naver';delete refRoot.dataset.mapError;
  try{window.naver?.maps?.Event?.addListener(handle.map,'dragstart',()=>{refFollow=false;});}catch{}
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
 if(!['walking','summary','home'].includes(refScreen))return;
 mountMap();refClearMarkers();clearDyn();
 if(refScreen==='home'){
  const center=refPlace?.ll||(gpsFresh()?gpsFix.ll:refHomeCenter||state.from?.ll||[126.9780,37.5665]);
  await new Promise(resolve=>ready(()=>{
   if(refScreen!=='home'){resolve();return;}
   map.getSource('rj').setData(EMPTY);map.getSource('rs').setData(EMPTY);map.jumpTo({center,zoom:15.8,bearing:0});map.resize();
   if(refPlace)refMark(refPlace.ll,el('endpoint-host',refEndpointHTML('to',refPlace.name)),{anchor:'top',offset:[0,-14]});
   if(gpsFresh())refMark(gpsFix.ll,el('m-me',''));
   refSignals=refMakeSignals(null,center,350,14);refDrawSignalMarkers();
   if(!refHomeMoveHooked){map.on('moveend',()=>{if(refScreen==='home'&&refRoot.dataset.mapProvider!=='naver')refRefreshNearby(map.getCenter().toArray());});refHomeMoveHooked=true;}
   refMountNaver([],false,center);resolve();
  }));
  return;
 }
 if(!refDragHooked&&map){map.on('dragstart',()=>{refFollow=false;});refDragHooked=true;}
 await new Promise((resolve,reject)=>ready(()=>{try{
  if(!['walking','summary'].includes(refScreen)){resolve();return;}
  const summary=refScreen==='summary',r=state.routes?.[state.focus];
  const coords=refSample?(summary?refFixtureRoute.slice().reverse():refFixtureRoute):r?.coords;
  if(!coords){map.jumpTo({center:ME.ll,zoom:15});resolve();return;}
  refRoute=coords;
  map.getSource('rj').setData(lineFC(coords));map.getSource('rs').setData(!summary&&!refSample&&!refNavigating&&state.routes?.alt?lineFC(state.routes[state.focus==='jjuk'?'short':'jjuk'].coords):EMPTY);
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
   refMark(coords[0],el('endpoint-host',refEndpointHTML('from',state.from?.name)),{anchor:'top',offset:[0,-14]});
   refMark(coords.at(-1),el('endpoint-host',refEndpointHTML('to',state.to?.name)),{anchor:'top',offset:[0,-14]});
   if(refSample){refMark(coords[6],el('signal-disc red summary-marker',refIcon('directions_walk')));}
   else if(!summary){refSignals=refMakeSignals(r);for(const item of refSignals){
    const elm=el('signal-disc '+refSignalClass(item)+' estimated',refIcon(item.historyLabel&&!item.trusted&&!item.tentative?'history':'directions_walk'));
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
 if(!['home','search','settings','walking','summary','splash','share'].includes(screen))screen='home';
 clearTimeout(refSplashTimer);refMapEpoch++;refCloseSignal();refNaverHandle?.destroy();refNaverHandle=null;
 if(refScreen==='walking'&&screen!=='walking'&&!refSample){stopGPS();endWalk();refKeepAwake(false);}
 refClearMarkers();refScreen=screen;current=screen==='walking'?'walk':screen==='summary'?'done':screen;
 const views={home:refHome,search:refSearch,settings:refSettings,walking:refWalking,summary:refSummary,splash:refSplash,share:refShare};refRoot.innerHTML=views[screen]();refFitSheet();if(!refSample)refPaintArrivals();
 if(screen==='share')document.fonts.ready.then(()=>{if(refScreen==='share')refPaintPoster();});
 document.title=`쭉고 · ${screen}${refSample?' · 시각 검증용 예시':''}`;
 if(screen==='search'){refDoSearch(document.getElementById('ref-query').value);if(!refSample)document.getElementById('ref-query').focus({preventScroll:true});}
 if(screen==='walking'||screen==='summary'||(screen==='home'&&!refSample)){
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
// 검색 결과 거리: 지도 앱처럼 기준점(내 위치 > 반대쪽 장소)에서 직선거리. 기준이 없으면 쓰지 않는다.
function refHitDist(p){const o=gpsFresh()?gpsFix.ll:(refPick==='to'?state.from:state.to)?.ll;if(!o||!p?.ll)return '';const d=distLL(o,p.ll);return d<1000?Math.round(d/10)*10+'m':(d/1000).toFixed(1)+'km';}
async function refDoSearch(q,category='전체'){
 const seq=++refSearchSeq,host=document.getElementById('ref-results');if(!host)return;
 if(!refSample){
  const clear=document.querySelector('[data-ref-action="clear-query"]');if(clear)clear.hidden=!q.trim();
  if(!q.trim()){
   refSearchHits=refRecent();
   host.innerHTML=(refPick==='from'?`<button class="search-result" data-ref-action="gps">${refIcon('my_location')}<span class="row-copy"><strong>내 현재 위치</strong><small>GPS로 출발 위치 연결</small></span></button>`:'')+(refSearchHits.length?'<div class="section-heading"><span>최근 검색</span><button data-ref-action="clear-recent">전체 삭제</button></div>'+refRecentRows(refSearchHits,true):'<p class="search-hint">역·건물·주소를 입력해 보세요.</p>');return;
  }
 }
 if(refSample&&q==='낙산공원')refSearchHits=[refPlaces[0],{name:'낙산공원 주차장',sub:'서울 종로구 낙산길 41',ll:[127.0075,37.5806]},{name:'낙산공원 전망대',sub:'서울 종로구 낙산길 56',ll:[127.008,37.5808]},{name:'낙산공원 입구',sub:'서울 종로구 이화동 산1-3',ll:[127.005,37.5806]}];
 else{
  host.innerHTML='<p class="empty">장소를 찾고 있어요…</p>';
  let hits;try{hits=q.trim()?await runSearch(q):refRecent();}catch{if(seq===refSearchSeq&&refScreen==='search')host.innerHTML='<p class="empty">연결을 확인하고 다시 검색해 주세요.</p>';return;}
  if(seq!==refSearchSeq||refScreen!=='search')return;refSearchHits=hits;
 }
 if(category==='최근 검색')refSearchHits=refRecent();
 if(category==='주소')refSearchHits=refSearchHits.filter(p=>p.kind==='주소');
 host.innerHTML=refSearchHits.slice(0,refSample?4:40).map((p,i)=>`<button class="search-result" data-ref-hit="${i}">${refIcon('location_on')}<span class="row-copy"><strong>${esc(p.name)}</strong><small>${esc([refHitDist(p),p.sub||p.kind||'서울 장소'].filter(Boolean).join(' · '))}</small></span>${i?'':refIcon('north_east').replace('class="mi"','class="mi arrow"')}</button>`).join('')||'<p class="empty">검색 결과가 없어요.</p>';
 if(!refSample&&q.trim())host.insertAdjacentHTML('beforeend','<button class="recent-row" data-ref-action="public-search"><span class="row-copy"><strong>가게·건물 더 찾기</strong><small>누르면 검색어를 외부 장소검색에 보내요. GPS는 보내지 않아요.</small></span></button>');
 if(!refSample&&!q.trim()&&refPick==='from')host.insertAdjacentHTML('afterbegin',`<button class="search-result" data-ref-action="gps">${refIcon('my_location')}<span class="row-copy"><strong>내 현재 위치</strong><small>GPS로 출발 위치 연결</small></span></button>`);
}
function refChoose(p){
 if(refSearchFrom==='home'){refPlace=p;refShow('home');return;}
 if(refSearchFrom==='route'){state[refPick]={...p,sub:p.sub||p.kind||''};state.routes=null;state.tripKey=null;state.fixedRoute=null;state.focus='jjuk';state.mode='actual';if(p.source!=='kakao')store.set('recent',[p,...store.get('recent',[]).filter(v=>v.name!==p.name)].slice(0,6));refFind();return;}
 state[refPick]={...p,sub:p.sub||p.kind||''};state.routes=null;state.tripKey=null;state.fixedRoute=null;state.dep=0;state.focus='jjuk';state.mode='actual';
 if(p.source!=='kakao')store.set('recent',[p,...store.get('recent',[]).filter(v=>v.name!==p.name)].slice(0,6));refShow('home');
}
async function refFind(){
 if(refSample){refShow('walking');return;}
 if(!state.from){refLocateStart();return;}
 if(!state.to){refPick='to';state.pick='to';refShow('search');return;}
 const btn=refRoot.querySelector('.find');if(btn){btn.disabled=true;btn.textContent='길을 찾고 있어요…';}
 refFindError=null;
 try{await refData();applyPace();state.budget=store.get('referenceBudget',readProfile().budgetSeconds/60)*60;if(state.mode==='actual'&&(!state.routes||state.tripKey!==tripKeyNow()))BASE=kstSec();state.dep=refNavigating||refRerouting?0:refDep;await computeTrip();
  if(state.error){refRerouting=false;logRouteSearch();refFindError={...state.error,retry:state.error.kind==='network'};refNavigating=false;refShow('home');return;}
  logRouteSearch();if(refRerouting){refRerouting=false;refNavigating=true;refPaused=false;refProgress=null;refFollow=true;refIgnoreUntil=performance.now()+600;refShow('walking');refToast('내 위치에서 다시 찾았어요. 안내를 이어 가요.');return;}refNavigating=false;refShow('walking');}
 catch(e){refFindError={title:'길을 찾지 못했어요',text:e.message,retry:true};refNavigating=false;refShow('home');}
}
function refUpdateProfile(change){const p=readProfile();Object.assign(p,change);writeProfile(p);applyPace();state.routes=null;state.tripKey=null;}
function refGpsHelp(e){
 const inapp=/KAKAOTALK|Instagram|FBAN|FBAV|Barcelona|Threads|NAVER\(inapp|Line\//i.test(navigator.userAgent);
 if(e?.code===1)return '위치 권한이 꺼져 있어요. 주소창의 자물쇠(또는 aA) → 위치 허용 후 다시 눌러 주세요.'+(inapp?' 앱 안 브라우저라면 Safari·Chrome으로 열어 주세요.':'');
 if(inapp)return '앱 안 브라우저에서는 위치가 잘 안 잡혀요. 메뉴(⋯)에서 Safari·Chrome으로 열어 주세요.';
 if(e?.code===2)return '휴대폰 위치 서비스가 꺼져 있어요. 설정에서 켠 뒤 다시 눌러 주세요.';
 return e?.message&&!/^Timeout|^User denied/i.test(e.message)&&/[가-힣]/.test(e.message)?e.message:'아직 위치를 받지 못했어요. 탁 트인 곳에서 다시 눌러 주세요.';
}
let refMeMarker=null;
function refCenterHome(ll,zoom=16){
 refHomeCenter=ll;
 if(refNaverHandle&&refRoot.dataset.mapProvider==='naver'){refNaverHandle.setCurrent?.(ll);refNaverHandle.center(ll,zoom);}
 else if(map){refMeMarker?.remove();refMeMarker=new maplibregl.Marker({element:el('m-me','')}).setLngLat(ll).addTo(map);refMarkers.push(refMeMarker);map.easeTo({center:ll,zoom,duration:400});}
 refRefreshNearby(ll);
}
// 홈의 내 위치 버튼: 대략적인 위치(오차 100m 넘음)도 지도에는 보여 주고, 출발지로는 정확할 때만 쓴다
function refHomeLocate(){
 if(!navigator.geolocation||!window.isSecureContext){refToast('위치는 보안 연결(https) 주소에서만 쓸 수 있어요.');return;}
 const request=++gpsRequest;refToast('내 위치를 찾고 있어요…');
 requestLocation(p=>{if(request!==gpsRequest)return;try{
  const f=readFix(p,1000);gpsFix=f;
  if(f.accuracy<=100&&!state.from){state.from={name:'내 위치',sub:'GPS',ll:[...f.ll],me:true};}
  if(refScreen==='home')refCenterHome(f.ll,f.accuracy>100?15:16);
  refToast(f.accuracy>100?`대략적인 위치예요(오차 약 ${Math.round(f.accuracy)}m). 탁 트인 곳에서 다시 눌러 주세요.`:`내 위치 · 오차 약 ${Math.round(f.accuracy)}m`);
 }catch(e){refToast(refGpsHelp(e));}},e=>{if(request!==gpsRequest)return;refToast(refGpsHelp(e));});
}
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
 },e=>{if(request!==gpsRequest)return;gpsPending=false;gpsError(e);refPick='from';state.pick='from';refShow('search');refToast(refGpsHelp(e)+' 출발지를 직접 골라도 돼요.');});
}
refRoot.addEventListener('keydown',e=>{if(!refSample&&e.target.id==='ref-query'&&e.key==='Enter'){e.preventDefault();document.getElementById('ref-search-submit').click();}});
refRoot.addEventListener('change',async e=>{if(e.target.id!=='ref-poster-photo')return;const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith('image/')||file.size>20*1024*1024){refToast('20MB 이하의 이미지 파일을 골라 주세요.');return;}const url=URL.createObjectURL(file);try{const im=new Image();im.src=url;await im.decode();if(refScreen!=='share')return;refPosterPhoto=im;refPosterSkin='photo';refShow('share');}catch{refToast('사진을 읽지 못했어요. 다른 이미지를 골라 주세요.');}finally{URL.revokeObjectURL(url);}});
refRoot.addEventListener('input',e=>{if(e.target.id==='ref-query')refDoSearch(e.target.value);});
refRoot.addEventListener('toggle',e=>{if(e.target.matches('.route-burden details'))e.target.querySelector('.burden-toggle-label').textContent=e.target.open?'접기':'자세히';if(e.target.matches('.route-itinerary'))requestAnimationFrame(()=>{refFitSheet();map?.resize?.();refNaverHandle?.resize?.();});},true);
refRoot.addEventListener('keydown',e=>{const key=e.target.closest('button')?.dataset.refSignalKey;if(key&&['Enter',' '].includes(e.key)){e.preventDefault();const item=refSignals.find(x=>x.key===key);if(item)refOpenSignal(item);}},true);
refRoot.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.refTheme){const theme=b.dataset.refTheme;if(!['light','asphalt'].includes(theme))return;store.set('referenceTheme',theme);document.documentElement.dataset.theme=theme;refRoot.querySelectorAll('[data-ref-theme]').forEach(n=>n.setAttribute('aria-pressed',n.dataset.refTheme===theme));return;}
 if(b.dataset.refPoster){if(!['asphalt','light','transparent'].includes(b.dataset.refPoster))return;refPosterSkin=b.dataset.refPoster;refRoot.querySelectorAll('[data-ref-poster]').forEach(n=>n.setAttribute('aria-pressed',n===b));refPaintPoster();return;}
 if(b.dataset.refClear){if(['from','to'].includes(b.dataset.refClear)){state[b.dataset.refClear]=null;state.routes=null;state.tripKey=null;refShow('home');}return;}
 // 화면이 바뀐 직후 같은 자리에 생긴 버튼이 두 번째 탭을 받지 않게(걷기 시작 두 번 → 일시정지 방지)
 if(performance.now()<refIgnoreUntil&&['pause','finish','reroute'].includes(b.dataset.refAction))return;
 if(b.dataset.refPick)refFindError=null;
 if(b.dataset.refScreen){if(b.dataset.refScreen!=='settings')refSettingsFromResult=false;refShow(b.dataset.refScreen);return;}
 if(b.dataset.refChip!=null){refPlace=refRecent()[Number(b.dataset.refChip)];refShow('home');return;}
 if(b.dataset.refPick){refSearchFrom=refScreen==='walking'?'route':'form';refPick=b.dataset.refPick;state.pick=refPick;refShow('search');return;}
 if(b.dataset.refEvent!=null){
  const event=refRouteEvents(state.routes?.[state.focus])[Number(b.dataset.refEvent)];if(!event||refNavigating)return;
  refRoot.querySelectorAll('[data-ref-event]').forEach(n=>n.removeAttribute('aria-current'));b.setAttribute('aria-current','step');
  refCloseSignal();
  if(event.kind==='signal')refOpenSignal(refSignalModel(event.raw||{s:'unmapped',dirs:[],at:event.ll}));
  else{if(refNaverHandle&&refRoot.dataset.mapProvider==='naver')refNaverHandle.center(event.ll,17);else map?.easeTo({center:event.ll,zoom:17,duration:250});refToast(event.title+' 위치를 지도에서 보고 있어요.');}
  return;
 }
 if(b.dataset.refDep!=null){refDep=Number(b.dataset.refDep);state.routes=null;state.tripKey=null;if(refSettingsFromResult)refShow('settings');else refFind();return;}
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
 if(a==='home-search'){refFindError=null;refSearchFrom='home';refPick='to';state.pick='to';refShow('search');return;}
 if(a==='place-close'){refPlace=null;refShow('home');return;}
 if(a==='place-to'||a==='place-from'){
  const p=refPlace;refPlace=null;if(!p)return;
  if(p.source!=='kakao')store.set('recent',[p,...store.get('recent',[]).filter(v=>v.name!==p.name)].slice(0,6));
  state[a==='place-to'?'to':'from']={...p,sub:p.sub||p.kind||''};state.routes=null;state.tripKey=null;state.fixedRoute=null;state.focus='jjuk';state.mode='actual';
  if(a==='place-from'&&!state.to){refSearchFrom='route';refPick='to';state.pick='to';refShow('search');return;}
  refFind();return;}
 if(a==='preview-pattern'){refStartReplay();return;}
 if(a==='conditions'){refSettingsFromResult=true;refShow('settings');return;}
 if(a==='back-result'){refSettingsFromResult=false;if(state.routes&&state.tripKey===tripKeyNow())refShow('walking');else{refToast('바뀐 조건으로 길을 다시 찾고 있어요…');refFind();}return;}
 if(a==='share'){const u=new URL(location.origin+location.pathname);if(state.from&&!state.from.me){u.searchParams.set('from',state.from.ll[1].toFixed(5)+','+state.from.ll[0].toFixed(5));u.searchParams.set('fn',state.from.name);}if(state.to){u.searchParams.set('to',state.to.ll[1].toFixed(5)+','+state.to.ll[0].toFixed(5));u.searchParams.set('tn',state.to.name);}
  const text=`${state.to?.name||''}까지 걷는 길 · 쭉고`;try{if(navigator.share){await navigator.share({title:'쭉고',text,url:u.href});}else{await navigator.clipboard.writeText(u.href);refToast('경로 링크를 복사했어요.');}}catch{}return;}
 if(a==='reroute'){const before=state.from;refRerouting=true;rerouteFromGPS();if(state.from===before)refRerouting=false;return;}
 if(a==='find')refFind();
 if(a==='gps'){await refData();refLocateStart();}
 if(a==='swap-find'){[state.from,state.to]=[state.to,state.from];state.routes=null;state.tripKey=null;refFind();return;}
 if(a==='swap'){[state.from,state.to]=[state.to,state.from];state.routes=null;state.tripKey=null;refShow('home');}
 if(a==='more'){refPick='to';state.pick='to';refShow('search');}
 if(a==='clear-query'){const q=document.getElementById('ref-query');q.value='';q.focus();refDoSearch('');}
 if(a==='clear-recent'){store.set('recent',[]);if(refSample)document.getElementById('ref-search-recent').innerHTML='';else refDoSearch('');}
 if(a==='public-search'||a==='search-submit'){
  const q=document.getElementById('ref-query').value.trim();if(q.length<2){refToast('검색어를 두 글자 이상 입력해 주세요.');return;}const seq=++refSearchSeq;b.disabled=true;
  try{const r=await fetch('/api/places?q='+encodeURIComponent(q));const j=await r.json();if(refScreen!=='search'||seq!==refSearchSeq||document.getElementById('ref-query')?.value.trim()!==q)return;if(!r.ok)throw new Error(j.error||'장소검색 연결 실패');const rows=[...refSearchHits];for(const p of j.places||j.results||[])if(!rows.some(v=>v.name===p.name&&distLL(v.ll,p.ll)<30))rows.push(p);refSearchHits=rows;document.getElementById('ref-results').innerHTML=(rows.map((p,i)=>`<button class="search-result" data-ref-hit="${i}">${refIcon('location_on')}<span class="row-copy"><strong>${esc(p.name)}</strong><small>${esc(p.address||p.sub||p.kind||'장소')}</small></span></button>`).join('')||'<p class="empty">서울 지원 범위에서 찾은 장소가 없어요. 동네 이름이나 주소를 더해 보세요.</p>')+`<p class="small">기본 장소 + ${esc(j.source||'외부 장소검색')} · 보행로와 출입구 연결은 별도로 확인해요.</p>`;}catch(err){if(seq===refSearchSeq&&refScreen==='search')refToast(err.message);}finally{b.disabled=false;}
 }
 if(a==='crossing-map'){if(refSample)refShow('walking');else{refPick='to';state.pick='to';refShow('search');}}
 if(a==='pause'){refPaused=!refPaused;if(!refSample){if(refPaused){stopGPS();clearInterval(walkClock);walkClock=null;resumeTrack(walkTrack);}else{renderWalk(false,true);}}b.innerHTML=b.classList.contains('ma-round')?refIcon(refPaused?'play_arrow':'pause'):refIcon(refPaused?'play_arrow':'pause')+`<span>${refPaused?'다시 시작':'일시정지'}</span>`;b.setAttribute('aria-label',refPaused?'다시 시작':'일시정지');refKeepAwake(!refPaused);if(!refSample)refToast(refPaused?'안내를 잠시 멈췄어요. 위치 측정도 멈춰요.':'안내를 다시 시작해요.');}
 if(a==='start'){
  const sr=state.routes?.[state.focus];if(!refSample&&sr&&sr.length>REF_FAR_M&&!confirm(`걷기엔 먼 길이에요(${km(sr.length)}, 약 ${mins(sr.m.walk)}). 그래도 도보 안내를 시작할까요?`))return;
  refIgnoreUntil=performance.now()+600;
  if(!refSample&&state.routes){const route=!state.routes.alt||state.focus==='short'?'fast':'jjukgo';logEvent('selected_route',{trip:state.tripId,route,alternative_available:!!state.routes.alt});state.walkLogPending=route;}
  refNavigating=true;refPaused=false;refProgress=null;refFollow=true;refFollowZoomed=false;refDep=0;refShow('walking');refKeepAwake(true);}
 if(a==='finish'){if(!refSample&&!refNavigating){refShow('home');return;}if(!refSample&&refRoot.querySelector('.ma-end')?.textContent!=='기록 보기'&&!confirm('안내를 끝낼까요? 지금까지 걸은 기록을 보여 드려요.'))return;
  if(!refSample){endWalk();stopGPS();if(!(state.lastWalk?.meters>0)){refNavigating=false;refPaused=false;refShow('walking');refToast('걸은 기록이 없어 경로 화면으로 돌아왔어요.');return;}}if(!refSample){endWalk();stopGPS();}refNavigating=false;refPaused=false;refShow('summary');}
 if(a==='sound'){refSound=!refSound;b.setAttribute('aria-pressed',refSound);b.innerHTML=refIcon(refSound?'volume_up':'volume_off');if(refSound&&!refSample&&'speechSynthesis'in window){speechSynthesis.speak(new SpeechSynthesisUtterance(document.getElementById('ref-instruction').textContent));}}
 if(a==='recenter'&&refScreen==='home'&&!refSample){if(gpsFresh())refCenterHome(gpsFix.ll);else refHomeLocate();return;}
 if(a==='recenter'){refFollow=true;refFollowZoomed=false;refLastFollow=0;}
 if(a==='recenter'&&map){if(!refSample&&!gpsFresh()){refPendingRecenter=true;if(refNavigating&&!refPaused)renderWalk(false,true);else locate(false);}else if(refNaverHandle)refNaverHandle.center(gpsFix.ll,16);else map.easeTo({center:gpsFix?.ll||refFixtureRoute[0],zoom:16.7,duration:300});}
 if(a==='layers'&&refRoute){if(refNaverHandle)refNaverHandle.fitRoute();else{const b=new maplibregl.LngLatBounds(refRoute[0],refRoute[0]);refRoute.forEach(c=>b.extend(c));map.fitBounds(b,{padding:{top:170,bottom:70,left:45,right:70},duration:300});}}
 if(a==='next-crossing'){const next=refSignals.find(x=>!x.raw.nearby);if(next)refOpenSignal(next);else refToast('경로에 연결된 횡단 정보가 없어요. 지도 아이콘에서 주변 신호 위치를 볼 수 있어요.');}
 if(a==='save'){if(refSample)refSave();else refShow('share');}
 if(a==='poster-save')await refSavePoster();
 if(a==='poster-clear-photo'){refPosterPhoto=null;refPosterSkin='asphalt';refShow('share');}
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
 // 홈 지도의 주변 신호 남은 초: 지금·다음 시간대 패턴을 미리 받는다(길을 찾으면 엔진이 경로 시간대로 다시 받는다)
 {const h=Math.floor(kstSec()/3600);const plans=await loadSignalPlans([h,h+1]).catch(()=>null);if(plans&&!state.routes)REAL=plans;}
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
if(!refSample&&!refFrom)navigator.permissions?.query({name:'geolocation'}).then(st=>{
 if(st.state!=='granted')return;
 navigator.geolocation.getCurrentPosition(p=>{try{if(state.from)return;const f=readFix(p,1000);if(f.accuracy>100)return;gpsFix=f;state.from={name:'내 위치',sub:'GPS',ll:[...f.ll],me:true};if(refScreen==='home'&&!refPlace)refCenterHome(f.ll);}catch{}},()=>{},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}).catch(()=>{});
refShow(refParams.get('screen')||(refSample||store.get('seenSplash',false)?'home':'splash'));
if(!refSample&&refFrom&&refTo){
 state.from={name:refParams.get('fn')||'출발',ll:refFrom,sub:''};state.to={name:refParams.get('tn')||'도착',ll:refTo,sub:''};state.mode='actual';
 refFind();
}
setInterval(()=>{
 if(refSample)return;
 refPaintReplay();
 const walkingNow=refScreen==='walking'&&refNavigating&&!!walkTrack,route=state.routes?.[state.focus];
 refProgress=walkingNow&&route&&gpsFresh()?projectOnRoute(route,gpsFix.ll).distance:null;
 if(['walking','summary','home'].includes(refScreen)&&refSignals.length){
  for(const item of refSignals)Object.assign(item,refSignalModel(item.raw));
  refNaverHandle?.updateSignals?.(refSignals);
  for(const{item,elm}of refSignalMarkers){elm.className='signal-disc '+refSignalClass(item)+' estimated';elm.querySelector('.mi').textContent=item.historyLabel&&!item.trusted&&!item.tentative?'history':'directions_walk';}
  if(refSelectedSignal&&refSignalPopup){const e=refSignalPopup.getElement(),n=e.querySelector('[data-signal-value]'),d=e.querySelector('.signal-detail-card p');if(n)n.textContent=refSignalTitle(refSelectedSignal);if(d)d.textContent=refSignalDescription(refSelectedSignal);}
  const next=refSignals.find(x=>!x.raw.nearby&&(refProgress==null||!Number.isFinite(x.raw.d)||x.raw.d>refProgress+3)),out=document.getElementById('ref-next-summary');
  if(next&&out){out.textContent=(Number.isFinite(next.raw.d)&&refProgress!=null?Math.max(0,Math.round(next.raw.d-refProgress))+'m · ':'')+refRowText(next);const disc=out.closest('button').querySelector('.signal-disc');disc.className='signal-disc '+refSignalClass(next);disc.querySelector('.mi').textContent=next.historyLabel&&!next.trusted&&!next.tentative?'history':'directions_walk';}
  else if(out)out.textContent=refNavigating&&refProgress!=null?'이 길에 남은 신호 횡단이 없어요':'경로의 횡단 시간 미확인';
  if(out)out.closest('button').querySelector('.row-copy strong').textContent=next?'다음 횡단보도':'횡단 정보';
 }
 if(refScreen==='home'&&!refSample){const hs=document.getElementById('ref-home-signal'),n=refSignals.filter(x=>x.trusted||x.tentative).length;if(hs)hs.textContent=n?`남은 시간을 아는 신호 ${n}곳 · 아이콘 숫자는 남은 초(예상)`:'지도를 움직여 주변 신호를 찾아보세요 · 실시간 아님';if(refRoot.dataset.mapProvider!=='naver')for(const{item,elm}of refSignalMarkers){const sc=elm.querySelector('.sig-sec');if(sc&&Number.isFinite(item.remainingSeconds))sc.textContent=item.remainingSeconds;}}
 if(document.getElementById('ref-arr'))refPaintArrivals();
 if(gpsFresh()&&refPendingRecenter){if(refNaverHandle)refNaverHandle.center(gpsFix.ll,16);refPendingRecenter=false;}
 if(refScreen==='home'&&state.from){const n=document.getElementById('ref-origin');if(n)n.textContent=state.from.name;}
 const gpsMessage=$('walk-location')?.textContent||$('location-status')?.textContent||$('search-location')?.textContent||'';
 // 위치 알림은 걷는 중에만 띄운다(다른 화면에서 '위치 연결 대기'가 중요한 오류 알림을 덮지 않게)
 if(gpsMessage&&gpsMessage!==refGPSMessage){refGPSMessage=gpsMessage;if(refScreen==='walking'&&refNavigating&&!/GPS 연결|권한|위치|갱신/.test(gpsMessage))refToast(gpsMessage.replace("'위치 다시 연결'을 눌러",'지도 오른쪽 ◎ 버튼을 눌러 다시 연결해'));}
 const reroute=refRoot.querySelector('.ref-reroute'),offRoute=walkingNow&&$('walk-reroute')&&!$('walk-reroute').hidden;
 if(reroute){const was=reroute.style.display;reroute.style.display=offRoute?'':'none';const nc=refRoot.querySelector('.next-crossing');if(nc)nc.style.display=offRoute?'none':'';if(was!==reroute.style.display){refFitSheet();map?.resize?.();}}
 if(walkingNow){
  const basis=document.getElementById('ref-timing-basis');if(basis)basis.textContent=gpsFresh()?'신호 대기 포함 예상':gpsFix?'마지막 위치 기준 예상':'출발지 기준 예상';
  const left=$('w-left')?.textContent,time=$('w-time')?.textContent,sp=$('w-pace')?.textContent;
  const lf=document.getElementById('ref-left');if(left&&left!=='—'&&lf)lf.textContent=left;
  if(refProgress!=null&&!offRoute){const sp=trackSpeed(walkTrack)||SPEED,rem=Math.max(0,route.length-refProgress)/sp+refWaitAhead(route,refProgress,sp);document.getElementById('ref-time').textContent=mins(rem);const ar=document.getElementById('ref-arrival');if(ar)ar.textContent=refClock(rem)+' 도착';}
  if(gpsFresh()&&refNaverHandle)refNaverHandle.setCurrent(gpsFix.ll);
  if(sp&&sp!=='—')document.getElementById('ref-speed').textContent=sp;
  // 위 카드: 가장 가까운 할 일(꺾기 또는 횡단보도). 신호 횡단은 '도착할 때' 예상 문장, 신호 띠와 같은 기준.
  const nl=$('next-label')?.textContent||'',ns=$('next-state')?.textContent||'';
  const head=document.getElementById('ref-next-distance'),line=document.getElementById('ref-instruction');
  const spd=trackSpeed(walkTrack)||SPEED,arrived=nl==='도착';
  const nx=refProgress==null?null:refSignals.find(x=>!x.raw.nearby&&Number.isFinite(x.raw.d)&&x.raw.d>refProgress+3);
  const dist=nx?nx.raw.d-refProgress:Infinity;
  const g=refProgress==null?null:routeGuidance(route,refProgress),turn=g&&/보행로를 따라/.test(g.label)?g:null,turnDist=turn?turn.d-refProgress:Infinity;
  const locErr=!gpsFresh()&&/권한|서비스가 꺼져|못했|끊겨/.test(gpsMessage)?(/권한/.test(gpsMessage)?'위치 권한이 꺼져 있어요. 브라우저 설정에서 허용해 주세요':/서비스가 꺼져/.test(gpsMessage)?'휴대폰 위치 서비스를 켜 주세요':'위치를 받지 못하고 있어요. 지도 오른쪽 ◎ 버튼으로 다시 연결해요'):null;
  if(refPaused){head.textContent='일시정지';line.textContent='다시 시작을 누르면 안내를 이어 가요';}
  else if(offRoute){head.textContent='경로 밖';line.textContent=$('walk-location')?.textContent||'경로에서 벗어났어요. 내 위치에서 다시 찾을 수 있어요.';}
  else if(arrived){head.textContent='도착';line.textContent=ns||'도착지 근처예요';document.getElementById('ref-time').textContent='도착';const bs=refRoot.querySelector('.ma-bar-copy>span');if(bs)bs.textContent=(state.to?.name||'도착지')+' 근처예요';const end=refRoot.querySelector('.ma-end');if(end)end.textContent='기록 보기';}
  else if(refProgress==null){head.textContent=locErr?'위치 연결 필요':'위치 확인 중';line.textContent=locErr||'위치를 잡는 중이에요. 잠시 기다려 주세요.';}
  else if(turn&&turnDist<=300&&turnDist<dist){head.textContent=Math.round(turnDist)+'m 후';line.textContent=turn.label;}
  else if(nx&&dist<=300){head.textContent=Math.round(dist)+'m 후 횡단보도';line.textContent=nx.trusted?'신호는 아래 안내를 보고 건너세요':'신호 시간은 몰라요. 현장 신호를 확인하세요';}
  else if(turn){head.textContent=Math.round(turnDist)+'m 후';line.textContent=turn.label;}
  else{head.textContent='남은 '+km(Math.max(0,route.length-refProgress));line.textContent='경로를 따라 쭉 걸어가세요.';}
  const ti=document.getElementById('ref-turn-icon');
  if(ti){const h=head.textContent,ln=line.textContent;ti.innerHTML=refIcon(h==='일시정지'?'pause':h.startsWith('위치 ')?'location_searching':h==='경로 밖'?'wrong_location':h==='도착'?'flag':/횡단보도$/.test(h)?'directions_walk':/왼쪽/.test(ln)?'turn_left':/오른쪽/.test(ln)?'turn_right':'straight');ti.dataset.state=h.startsWith('위치 ')?'search':h==='경로 밖'?'off':'';}
  if(['m 후','횡단보도','도착','경로 밖'].some(k=>head.textContent.includes(k)))refSpeak(head.textContent+'. '+line.textContent);
  // 신호 띠(300m 안, 패턴이 확인된 신호만). 60m보다 멀면 '도착할 때' 예상, 가까우면 지금 초읽기.
  // 가까워도 남은 초록이 '가는 시간 + 건너는 시간 + 3초'보다 짧으면 숫자 대신 '다음 초록을 기다려요'(서두르지 않게).
  const banner=document.getElementById('ref-signal-banner');
  if(banner){
   const wasHidden=banner.hidden;
   const card=refRoot.querySelector('.ma-turn');if(card)banner.style.top=(card.offsetTop+card.offsetHeight+8)+'px';
   if(nx&&nx.trusted&&dist<=300&&!offRoute&&!arrived&&!refPaused){
    let st,main,sub;
    if(dist<=60){
     const need=nx.raw.len?nx.raw.len/spd:0,make=nx.state==='walk'&&nx.remainingSeconds>=dist/spd+need+3;
     if(nx.state==='walk'&&!make){st='wait';main='다음 초록을 기다려요';sub=`초록 ${nx.remainingSeconds}초 남음 · 건너는 데 약 ${Math.ceil(need)}초`;}
     else{st=nx.state;main=nx.countdown;sub=nx.state==='walk'?'지금 초록':'지금 빨강';}
    }else{
     const at=SIG.now()+dist/spd,v=SIG.verdict(nx.raw,at,spd),p=SIG.predictX(nx.raw,at);
     st=v.kind==='wait'||v.kind==='short'?'wait':v.kind==='unknown'?'':'walk';
     main=v.kind==='go'?'도착 때 건널 수 있어요':v.kind==='green'?'도착 때 초록 예상':v.kind==='short'?'도착 때 초록이 짧아요':v.kind==='wait'?`도착하면 약 ${Math.round(p?.wait||0)}초 대기`:'신호 예상 어려움';
     sub='지금 '+nx.countdown;
    }
    banner.hidden=false;banner.dataset.state=st;
    document.getElementById('ref-banner-main').textContent=main;
    document.getElementById('ref-banner-sub').textContent=`${Math.round(dist)}m 앞 횡단보도 · ${sub} · 예상`;
   }else banner.hidden=true;
   if(wasHidden!==banner.hidden){refFitSheet();map?.resize?.();}
  }
  // 지도가 내 위치를 따라간다(지도 앱처럼). 손으로 지도를 움직이면 멈추고, ◎ 버튼으로 다시 따라간다.
  if(gpsFresh()&&refFollow&&!refPaused&&Date.now()-refLastFollow>2500){
   refLastFollow=Date.now();
   if(refNaverHandle&&refRoot.dataset.mapProvider==='naver')refNaverHandle.center(gpsFix.ll,refFollowZoomed?undefined:17);
   else if(map)map.easeTo({center:gpsFix.ll,zoom:refFollowZoomed?map.getZoom():17,duration:600});
   refFollowZoomed=true;
  }
 }
},1000);
