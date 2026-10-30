// 화면 상태는 계산·GPS 엔진과 분리한다. 미확인 횡단 여유는 숫자로 만들지 않는다.
let onboardingStep=1, onboardingHint=null, onboardingEquipment=[], onboardingEquipmentKnown=false, onboardingTarget='home', settingsReturn='home', settingsDraft=null;
const EQUIPMENT_LABELS={stroller:'유모차',walker:'보행 보조기',cane:'지팡이',luggage:'무거운 짐',other:'기타'};
const CHECK_MARK='<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
function renderOnboarding() {
  const one=onboardingStep===1;
  $('onboarding-step').innerHTML=`<b>${onboardingStep}</b> / 2`;
  document.querySelectorAll('#onboarding-progress i').forEach((bar,i)=>bar.classList.toggle('on',i<onboardingStep));
  setText('onboarding-title',one?'다른 사람과 걸으면?':'오늘 함께하는 것이 있나요?');
  setText('onboarding-copy',one?'처음 길을 추천할 때 참고해요':'여러 개 골라도 돼요. 이동 조건을 맞추는 데 참고해요.');
  const choices=one?[['behind','조금 뒤처지는 편이에요'],['similar','비슷하게 걷는 편이에요'],['ahead','앞서가는 편이에요'],['unknown','잘 모르겠어요']]:[['none','없음'],...Object.entries(EQUIPMENT_LABELS)];
  const list=$('onboarding-answers');list.setAttribute('role',one?'radiogroup':'group');list.setAttribute('aria-labelledby','onboarding-title');
  list.innerHTML=choices.map(([v,label])=>{const active=one?onboardingHint===v:v==='none'?onboardingEquipmentKnown&&!onboardingEquipment.length:onboardingEquipment.includes(v);return `<button class="answer" role="${one?'radio':'checkbox'}" ${one?'data-pace-hint':'data-equipment'}="${v}" aria-checked="${active}"><span>${label}</span><span class="mark" aria-hidden="true">${active?CHECK_MARK:''}</span></button>`;}).join('');
  $('onboarding-next').disabled=one&&!onboardingHint;
  $('onboarding-back').hidden=one;
  setText('onboarding-next',one?'다음':'시작하기');
  setText('onboarding-hint',one?'걸음 속도는 걷는 동안 맞춰요':'');
  setText('onboarding-note',one?'나중에 설정할 수 있어요':'보조기 종류로 걸음 속도를 단정하지 않아요. 언제든 바꿀 수 있어요.');
}
function finishOnboarding(skip=false) {
  const saved=completeOnboarding(onboardingHint,onboardingEquipment,skip,onboardingEquipmentKnown);
  applyPace(); state.budget=readProfile().budgetSeconds;
  go(onboardingTarget==='onboarding'?'home':onboardingTarget);
  if(!saved) gpsStatus('이 기기에 설정을 저장하지 못했어요. 이번 접속 동안에는 적용돼요.');
  onboardingStep=1;
}
function renderSettings() {
  settingsDraft=readProfile(); const p=settingsDraft,s=paceState();
  $('auto-mode').checked=p.mode==='auto'&&p.autoEnabled; $('manual-mode').checked=p.mode==='manual';
  $('save-summary').checked=p.saveSummary; $('avoid-steps').checked=p.avoidSteps; $('budget-select').value=p.budgetSeconds;
  $('manual-speed').value=p.manualSpeed*3.6; updateManualOutput();
  setText('settings-pace-state',s.label+(s.speed?' · '+kmh(s.speed):''));
  setText('settings-pace-copy',s.speed?'길찾기의 소요 시간에 반영해요. 횡단별 신호 검증은 별도로 필요해요.':'측정 전에는 임시 속도로 소요 시간을 계산해요. 설문 응답은 측정값이 아니에요.');
  setText('equipment-summary',!p.equipmentAnswered?'이동 조건 아직 미응답':p.equipment.length?p.equipment.map(e=>EQUIPMENT_LABELS[e]).join(' · '):'선택한 이동 보조기 없음');
  setText('location-environment',window.isSecureContext&&navigator.geolocation?'이 브라우저는 위치 요청 기능을 제공해요. 위치를 실제로 받을 수 있는지는 권한과 기기 설정에 따라 달라요.':'이 브라우저에서는 위치 기능을 사용할 수 없어요.');
  setText('settings-message',''); $('reset-confirm').hidden=true; $('share-usage').checked=!store.get('nolog',false);
}
function updateManualOutput(){setText('manual-speed-value',Number($('manual-speed').value).toFixed(1)+' km/h');}
function applySettings() {
  const p=readProfile();
  p.mode=$('manual-mode').checked?'manual':'auto';p.autoEnabled=$('auto-mode').checked;
  p.manualSpeed=clampSpeed(Number($('manual-speed').value)/3.6);p.saveSummary=$('save-summary').checked;
  if(p.avoidSteps!==$('avoid-steps').checked)p.avoidStepsSet=true;
  p.avoidSteps=$('avoid-steps').checked;p.budgetSeconds=Number($('budget-select').value);store.set('nolog',!$('share-usage').checked);
  const saved=writeProfile(p);applyPace();state.budget=p.budgetSeconds;state.routes=null;state.tripKey=null;state.fixedRoute=null;state.error=null;
  if(!saved){setText('settings-message','설정을 저장하지 못했어요. 이번 접속 동안에는 적용돼요.');return;}
  go(settingsReturn);
}
function snaps(name){
 const H=phoneH(),sh=$('sheet-'+name),body=sh.querySelector('.sheet-body'),footer=sh.querySelector('.sheet-footer');
 const last=body?[...body.children].filter(c=>!c.hidden&&c.offsetHeight>0).pop():null;
 const content=last?last.offsetTop+last.offsetHeight-body.offsetTop+12:0;
 const wanted=content+(footer?.offsetHeight||76)+2;
 const mid=Math.min(H-(name==='home'?150:112),Math.max(name==='home'?210:230,wanted));
 return {peek:mid,mid,full:mid};
}
function resetHomeSheet(){state.picked=null;if(pickMarker){pickMarker.remove();pickMarker=null;}$('home-intro').hidden=false;$('home-place').hidden=true;$('home-actions').innerHTML='<button class="btn btn-primary" data-locate>내 위치로 출발</button><button class="btn btn-ghost button-small" data-search="from">직접 선택</button>';}
function renderHome(){
  if(!state.picked)resetHomeSheet();setSheet('home','mid');mountMap('map-home');clearDyn();setRoutes(null,null);if(gpsFix)addDyn(el('m-me','<i></i>'),gpsFix.ll);
  setText('home-pace',paceRowText(paceState()));setText('home-origin',state.from?tripLabel(state.from):'출발지를 정해 주세요');
  const recent=store.get('recent',[]).slice(0,2);$('home-chips').chips=recent;document.querySelector('.recent-heading').hidden=!recent.length;
  $('home-chips').innerHTML=recent.map((p,i)=>`<button class="recent-row" data-chip="${i}">${esc(p.name)}<span>›</span></button>`).join('')+'<button class="text-action" data-trip="demo">먼저 예시 길 둘러보기 ›</button>';
  setSheet('home','mid');ready(()=>{if(!state.homeView){map.jumpTo({center:state.from?.ll||DEMO_FROM.ll,zoom:13.7});state.homeView=true;}});
}
// 횡단 여유 숫자는 방향·길이·점멸 의미·날짜 근거가 함께 검증되기 전(PRODUCT_SPEC §6 gate)에는 만들지 않는다.
// 숫자 자리에는 숫자가 없는 이유가 되는 상태만 쓴다. 검증 증거가 생기면 이 함수 앞에 근거 확인을 추가한다.
function marginCellText(ps){return ps.kind==='before'?'측정 전':ps.kind==='learning'?'계산 준비 중':ps.kind==='paused'?'정보 없음':'자료 확인 중';}
function paceRowText(ps){return ps.kind==='before'?'내 걸음 · '+ps.label:ps.label;}
function unknownXingText(sim){const n=sim.xings.filter(x=>!x.known).length;return n?`정보 없는 횡단 ${n}곳`:'';}
// 시트 높이는 내용에 맞추되 지도가 일정 이상 남도록 제한한다. 지도는 시트 위 영역에만 놓인다.
function fitResultSheet(){
  // 내용 높이는 여백까지 포함해 재야 마지막 줄이 버튼 아래로 숨지 않는다(scrollHeight + 손잡이)
  const H=phoneH(),foot=$('result-footer'),sh=$('sheet-result'),grip=sh.querySelector('.grip-area'),body=sh.querySelector('.sheet-body');
  const prev=body.style.flex;body.style.flex='none';let need=2+(foot.hidden?0:foot.offsetHeight)+(grip?grip.offsetHeight:0)+body.scrollHeight;body.style.flex=prev;
  const open=!$('result-options').hidden;setSheet('result',open?'full':'mid',Math.round(Math.min(Math.max(need,190),open?H*.66:H*.62)));   // 펼쳐도 두 길을 지도에서 비교할 수 있게: 시트는 화면의 66%까지, 나머지는 시트 안에서 스크롤
}
function setBasisOpen(open){state.detailOpen=!!open;$('result-options').hidden=!open;$('calc-basis').setAttribute('aria-expanded',String(open));}
const resultBody=()=>$('sheet-result').querySelector('.sheet-body');
async function renderResult(){
  const request=++resultRequest;if(!state.from||!state.to){state.pick=state.to?'from':'to';$('sq').value='';go('search');return;}
  if(state.mode==='actual'&&(!state.routes||state.tripKey!==tripKeyNow())){BASE=nowSeconds();state.routes=null;}
  // 같은 길찾기 안에서는 펼침 상태·읽던 위치를 유지한다(탭 전환, 횡단보도 상세에서 돌아오기). 새 길찾기면 처음부터.
  const sameTrip=!!state.routes&&state.viewTrip===state.tripKey,keepScroll=sameTrip?(state.resultScroll??resultBody().scrollTop):0;state.resultScroll=null;
  if(!sameTrip){state.detailOpen=false;state.condOpen=false;}
  setBasisOpen(sameTrip&&state.detailOpen);
  mountMap('map-result');setText('from-name',tripLabel(state.from));setText('to-name',state.to.name);
  const status=$('result-status'),content=$('result-content');
  if(state.tripKey!==tripKeyNow()){state.routes=null;state.error=null;}
  status.hidden=false;content.hidden=true;$('result-footer').hidden=true;
  if(!state.routes&&!state.error){status.innerHTML=`<b>${state.condNote?'조건을 바꿔 다시 찾고 있어요':'내 걸음에 맞는 길을 찾고 있어요'}</b>${esc(state.condNote||'서울 보행 도로망을 확인하고 있어요.')}`;fitResultSheet();setRoutes(null,null);try{await computeTrip();}catch(e){console.error(e);state.error={title:'경로를 확인하지 못했어요',text:'다른 출입구를 선택하거나 다시 찾아 주세요.'};}if(current!=='result'||request!==resultRequest)return;}else refreshSims();
  if(state.error){logRouteSearch();const k=state.error.kind,retry=k==='network'||!k;
    // 오류마다 다음 행동을 하나만 크게: 연결 문제면 다시 찾기, 지역 밖·너무 가까움·출입구면 장소 다시 고르기
    const pick=state.error.pick||'to',pickLabel=pick==='from'?'출발지 다시 고르기':'도착지 다시 고르기';
    status.innerHTML=`<b>${esc(state.error.title)}</b>${esc(state.error.text)}`+(retry?`<button class="btn btn-primary" data-route-retry>다시 찾기</button>`:`<button class="btn btn-primary" data-pick-again="${pick}">${pickLabel}</button><button class="btn btn-ghost" data-pick-again="${pick==='from'?'to':'from'}">${pick==='from'?'도착지':'출발지'} 바꾸기</button>`);
    setRoutes(null,null);clearDyn();fitResultSheet();return;}
  logRouteSearch();
  status.hidden=true;content.hidden=false;$('result-footer').hidden=false;
  const S=state.sims,ps=paceState(),R=state.routes,B=R.short.m,J=R.jjuk.m;setText('result-pace',paceRowText(ps));
  // 빠른 길 vs 쭉고 길: 걷는 시간과 이동 마찰 원시값만 보여 준다(점수 없음). 쭉고 길은 의미 있는 대안이 있을 때만.
  const WALK=`<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13.5" cy="4" r="2"/><path d="M10 21l2.4-6.2L15 17v4M8 12l2-4.2 4 1.2 2.4 3.4 2.6.6M12.4 14.8 11 9.4"/></svg>`;
  $('route-cards').classList.toggle('one',state.same);
  for(const k of ['jjuk','short']){const c=$('card-'+k),m=R[k].m;c.hidden=k==='short'&&state.same;c.setAttribute('aria-pressed',String(state.same||state.focus===k));c.setAttribute('role','tab');c.setAttribute('aria-selected',String(state.same||state.focus===k));
    c.innerHTML=`${WALK}<span class="tl"><span class="name">${k==='jjuk'&&!state.same?'쭉고 길':'빠른 길'}</span><span class="mins">${mins(m.walk)}</span></span>`;}
  setText('compare-line',state.same?'비슷한 시간 안에 계단·신호 횡단·경사를 줄이는 다른 길이 없어요':compareLine(R.short,R.jjuk));
  {const sm=routeSummary(R.short,state.same?R.short:R.jjuk,state.same?'jjuk':state.focus);$('route-src').hidden=!sm.wait;setText('route-src',planNoteText());$('route-badge').hidden=!sm.badge;setText('route-badge-text',sm.badge);$('route-badge-ico').setAttribute('d',{stairs:'M4 19h4v-4h4v-4h4V7h4',sig:'M9 3h6a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 6.5v.1M12 10.5v.1M12 14.5v.1M12 18v3',steep:'M3 20 10 8l4 6 2-3 5 9z',gain:'M3 20 10 8l4 6 2-3 5 9z',wait:'M6 3h12M6 21h12M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9'}[sm.kind]||'M4 19h4v-4h4v-4h4V7h4');setText('route-headline',sm.headline);
    // 장점과 늘어나는 것을 같은 크기로(작은 회색 한 줄에 단점이 몰리지 않게)
    const chips=[...(sm.pros||[]).map(t=>`<span class="tc pro">${esc(t)}</span>`),...(sm.cons||[]).map(t=>`<span class="tc con">${esc(t)}</span>`)].join('');
    $('route-tradeoffs').innerHTML=chips;$('route-tradeoffs').hidden=!chips;setText('route-sub',chips?'':sm.sub);$('route-sub').hidden=!!chips;}
  // 지표 아이콘(선 아이콘, 글자색을 따름)
  const ic=d=>`<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const MICO={wait:ic('<path d="M6 3h12M6 21h12M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>'),walk:ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),sig:ic('<rect x="8" y="3" width="8" height="15" rx="1.5"/><path d="M12 6.5v.1M12 10.5v.1M12 14.5v.1M12 18v3"/>'),stairs:ic('<path d="M4 19h4v-4h4v-4h4V7h4"/>'),gain:ic('<path d="M3 19 9 9l4 6 3-4 5 8z"/>'),steep:ic('<path d="M4 19h16L20 7z"/>')};
  const waitCell=m=>m.waitKnown?waitText(m.wait):'정보 없음';
  const rows=[['걷는 시간',m=>mins(m.walk),'walk'],['예상 신호 대기',waitCell,'wait'],['신호 횡단',m=>m.sig+'곳','sig'],['확인된 계단',m=>m.stairs+'구간','stairs'],['오르막',m=>Math.round(m.gain)+'m','gain'],['급경사(8% 이상)',m=>Math.round(m.steep/10)*10+'m','steep']];
  const cell=(m,o,k)=>{const v=m[k],w=o?o[k]:v,better=o&&(k==='wait'?(m.waitKnown>0&&o.waitKnown>0&&m.waitUnknown<=o.waitUnknown&&v<w-30):k==='walk'?v<w-30:v<w-(k==='gain'?5:k==='steep'?50:0.5));return `<span${better?' class="better"':''}>`;};
  // 열 머리글은 표를 스크롤해도 위에 붙어 있다(sticky). 신호 횡단 줄은 횡단보도 목록으로 바로 연다.
  $('route-metrics').innerHTML=`<div class="mrow mhead"><span></span>${state.same?'':`<span class="mh-j">${WALK}쭉고 길</span>`}<span>${WALK}빠른 길</span></div>`+rows.map(([label,f,k])=>`<div class="mrow"><span>${k==='sig'?`<button class="mlink" data-go="detail">${MICO[k]}${label} ›</button>`:MICO[k]+label}</span>${state.same?'':`${cell(J,B,k)}${f(J)}</span>`}${cell(B,state.same?null:J,k)}${f(B)}</span></div>`).join('');
  $('route-metrics').classList.toggle('one',state.same);
  const sim=S[state.focus],r=state.routes[state.focus];
  $('unknown-xings').hidden=true;
  setText('result-note','예상 도보 시간 · 신호 대기는 따로 표시'+(state.snapNote?' · '+state.snapNote:''));
  {const wn=(m)=>m.waitTotal?`${m.waitKnown}/${m.waitTotal}곳`:'0곳',shown=state.same?[B]:[J,B];
    // 신호 정보 없음: 신호가 없거나, 있어도 패턴이 확인된 곳이 없으면 그렇게 말한다(0초로 보이지 않게).
    setText('wait-note',shown.every(m=>!m.waitTotal)?'이 길에는 신호 횡단이 없어요.':shown.every(m=>!m.waitKnown)?'이 길의 신호는 아직 패턴이 확인되지 않아 예상 신호 대기를 더하지 않았어요.':state.same?`예상 신호 대기는 신호 패턴이 확인된 곳만 더했어요(확인 ${wn(B)}) · ${planPeriodText()}`:`예상 신호 대기는 신호 패턴이 확인된 곳만 더했어요(쭉고 길 ${wn(J)}, 빠른 길 ${wn(B)}) · ${planPeriodText()}`);}
  setText('route-facts',`거리 ${km(r.length)} · 시간은 걷는 시간만(신호 대기는 따로 표시) · 추가 ${Math.min(state.budget,180)/60}분 이내의 길만 비교`);
  $('cov-note').hidden=true;
  setText('result-safety',`신호 횡단은 서울시 횡단보도 자료(보행등 있음)로 세며 일부만 확인돼 실제보다 적을 수 있어요. 오르막·급경사는 서울시 등고선으로 계산한 추정이고, 계단은 지도에 표시된 곳만 세요. 실제 신호·턱·출입구는 현장에서 확인하고, 건널지는 직접 정해 주세요.${readProfile().avoidSteps?' 계단은 제외했어요.':''}`);
  setRoutes(r,state.same?null:state.routes[state.focus==='jjuk'?'short':'jjuk']);markTrip(null,state.focus,false);
  // 회색 길 위에 이름표: 두 길이 가장 멀리 떨어진 지점(겹치지 않는 곳)에 붙인다
  if(!state.same){const ok=state.focus==='jjuk'?'short':'jjuk',oc=state.routes[ok].coords,fc=r.coords;let best=null,bd=-1;
    const ends=[fc[0],fc[fc.length-1]];for(let i=0;i<oc.length;i++){if(ends.some(e=>distLL(e,oc[i])<90))continue;let m=Infinity;for(let j=0;j<fc.length;j+=Math.max(1,fc.length>>7))m=Math.min(m,distLL(oc[i],fc[j]));if(m>bd){bd=m;best=oc[i];}}
    if(best&&bd>15)addDyn(el('m-label',`<b>${ok==='jjuk'?'쭉고 길':'빠른 길'}</b><span>${mins(state.routes[ok].m.walk)}</span>`),best,{anchor:'bottom',offset:[0,-8]});}
  $('cond-panel').hidden=!state.condOpen;$('adjust-conditions').setAttribute('aria-expanded',String(!!state.condOpen));if(state.condOpen)syncCond();
  state.viewTrip=state.tripKey;state.condNote=null;
  fitResultSheet();resultBody().scrollTop=keepScroll;
  // 탭을 바꿔도 지도는 움직이지 않는다(강조만 바뀜). 새 길찾기일 때만 두 길이 보이게 맞춘다.
  if(state.fitted!==state.tripKey){fit([state.routes.jjuk.coords,state.routes.short.coords]);state.fitted=state.tripKey;}
}
// 조건 조정: 결과 화면 안의 작은 패널. 이 길찾기에 바로 쓰는 조건(계단 피하기, 추가 허용 시간, 적용 중인 걷는 속도)만.
function syncCond(){const p=readProfile(),b=Math.min(180,Math.max(60,p.budgetSeconds||120));$('cond-steps').checked=!!p.avoidSteps;
  document.querySelectorAll('[data-cond-budget]').forEach(x=>{const on=+x.dataset.condBudget===(state.condBudget??b);x.setAttribute('aria-pressed',on);x.setAttribute('aria-checked',on);});
  const ps=paceState();setText('cond-pace',`걷는 속도 시속 ${(SPEED*3.6).toFixed(1)}km · ${ps.speed?'내 걸음에서 측정':'측정 전 임시값'}`);}
function applyCond(){
  const p=readProfile(),budget=state.condBudget??Math.min(180,Math.max(60,p.budgetSeconds||120));
  p.avoidSteps=$('cond-steps').checked;if(p.avoidSteps)p.avoidStepsSet=true;p.budgetSeconds=budget;
  const saved=writeProfile(p);state.budget=budget;state.condBudget=null;state.condOpen=false;
  state.condNote=`${p.avoidSteps?'확인된 계단 피하기':'계단 포함'} · 쭉고 길은 ${budget/60}분 더 걸어도 되는 길까지${saved?'':' (이 기기에 저장하지 못해 이번 접속에만 적용)'}`;
  state.routes=null;state.tripKey=null;state.fixedRoute=null;state.error=null;renderResult();
}
// 횡단보도 목록: 비교표의 '신호 횡단'과 같은 기준(routeCrossings xlist). 어느 길 기준인지 제목에 쓴다.
function renderDetail(){if(!state.routes)return go('home');const k=state.same?'short':state.focus,m=state.routes[k].m,xs=m.xlist||[],other=xs.length-m.sig;
  setText('detail-title',`${state.same?'이 길':k==='jjuk'?'쭉고 길':'빠른 길'}의 횡단보도`);
  $('detail-list').innerHTML=`<p class="detail-sum">신호 횡단 <b>${m.sig}곳</b>${other?` · 그 밖의 횡단 ${other}곳`:''}</p>`+xs.map(x=>`<div class="xing"><span class="${x.sig?'xs':'xo'}" aria-hidden="true">${x.sig?'●':'○'}</span><div><b>${x.sig?'신호 횡단':'횡단(보행등 확인 안 됨)'}${x.big?' · 큰길':''}</b><small>출발 후 약 ${km(x.d)}</small></div></div>`).join('')+'<p class="note">신호 횡단은 서울시 횡단보도 자료에서 보행등이 있는 곳(경로에서 25m 안)이에요. 자료에 없는 곳은 빠질 수 있어요. 과거 신호 기록은 지금 켜진 불이 아니에요.</p>';}
document.addEventListener('click',e=>{
  const t=e.target,p=t.closest('[data-pace-hint]'),q=t.closest('[data-equipment]');
  if(p){onboardingHint=p.dataset.paceHint;renderOnboarding();}if(q){onboardingEquipment=selectEquipment(onboardingEquipment,q.dataset.equipment);onboardingEquipmentKnown=true;renderOnboarding();}
  if(t.closest('#onboarding-next')){if(onboardingStep===1){onboardingStep=2;renderOnboarding();}else finishOnboarding();}
  if(t.closest('#onboarding-skip'))finishOnboarding(true);
  if(t.closest('#onboarding-back')){onboardingStep=1;renderOnboarding();}
  if(t.closest('[data-go="settings"]')){settingsReturn=current==='result'||current==='walk'?current:'home';if(current==='result')state.resultScroll=resultBody().scrollTop;}
  if(t.closest('#settings-back'))go(settingsReturn);
  if(t.closest('#settings-apply'))applySettings();
  if(t.closest('#save-walk-card'))saveWalkCard();
  if(t.closest('#splash-skip')){if(booted)go(pendingScreen||'home');else setText('splash-foot','지도를 준비하고 있어요. 잠시만 기다려 주세요.');}
  if(t.closest('#copy-app-link'))navigator.clipboard?.writeText('https://jjukgo.vercel.app/').then(()=>setText('location-environment','주소를 복사했어요. Chrome·Safari 주소창에 붙여 넣어 주세요.')).catch(()=>setText('location-environment','https://jjukgo.vercel.app/ 주소를 외부 브라우저에서 열어 주세요.'));
  if(t.closest('#external-search'))externalSearch();
  if(t.closest('#edit-onboarding')){const p=readProfile();onboardingHint=p.paceHint;onboardingEquipment=p.equipment;onboardingEquipmentKnown=p.equipmentAnswered;onboardingStep=1;onboardingTarget='settings';go('onboarding');}
  if(t.closest('#reset-learning')){$('reset-confirm').hidden=false;setText('settings-message','');$('reset-confirm').scrollIntoView({block:'nearest'});$('reset-confirm-no').focus();}
  if(t.closest('#reset-confirm-no')){$('reset-confirm').hidden=true;$('reset-learning').focus();}
  if(t.closest('#reset-confirm-yes')){resetLearning();applyPace();state.routes=null;state.tripKey=null;renderSettings();setText('settings-message','맞춰 온 걸음 속도 요약을 지웠어요.');}
  if(t.closest('#calc-basis')){setBasisOpen($('result-options').hidden);fitResultSheet();}
  if(t.closest('#adjust-conditions')){state.condOpen=$('cond-panel').hidden;$('cond-panel').hidden=!state.condOpen;$('adjust-conditions').setAttribute('aria-expanded',String(state.condOpen));if(state.condOpen){syncCond();fitResultSheet();$('cond-panel').scrollIntoView({block:'nearest'});}else fitResultSheet();}
  const cb=t.closest('[data-cond-budget]');if(cb){state.condBudget=+cb.dataset.condBudget;syncCond();}
  if(t.closest('#cond-cancel')){state.condOpen=false;state.condBudget=null;$('cond-panel').hidden=true;$('adjust-conditions').setAttribute('aria-expanded','false');fitResultSheet();}
  if(t.closest('#cond-apply'))applyCond();
  if(t.closest('[data-go="detail"]')&&current==='result')state.resultScroll=resultBody().scrollTop;
  if(t.closest('#layer-toggle')){const b=$('layer-toggle'),on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',on);setText('layer-toggle',on?'횡단 시간 지도 끄기':'횡단 시간 지도');XW.show(on);}
  if(t.closest('#xw-mine')){XW.setSpeed(SPEED);}
});
$('auto-mode').addEventListener('change',()=>{if($('auto-mode').checked)$('manual-mode').checked=false;});
$('manual-mode').addEventListener('change',()=>{if($('manual-mode').checked)$('auto-mode').checked=false;});
$('manual-speed').addEventListener('input',updateManualOutput);
