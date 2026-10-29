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
  setText('settings-message',''); $('reset-confirm').hidden=true;
}
function updateManualOutput(){setText('manual-speed-value',Number($('manual-speed').value).toFixed(1)+' km/h');}
function applySettings() {
  const p=readProfile();
  p.mode=$('manual-mode').checked?'manual':'auto';p.autoEnabled=$('auto-mode').checked;
  p.manualSpeed=clampSpeed(Number($('manual-speed').value)/3.6);p.saveSummary=$('save-summary').checked;
  if(p.avoidSteps!==$('avoid-steps').checked)p.avoidStepsSet=true;
  p.avoidSteps=$('avoid-steps').checked;p.budgetSeconds=Number($('budget-select').value);
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
  const recent=store.get('recent',[]).slice(0,2);$('home-chips').chips=recent;
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
  const H=phoneH(),foot=$('result-footer');let need=2+(foot.hidden?0:foot.offsetHeight);
  for(const c of $('sheet-result').querySelector('.sheet-body').children)if(!c.hidden)need+=c.offsetHeight;
  const open=!$('result-options').hidden;setSheet('result',open?'full':'mid',Math.round(Math.min(Math.max(need,190),open?H-112:H*.62)));
}
function setBasisOpen(open){$('result-options').hidden=!open;$('calc-basis').setAttribute('aria-expanded',String(open));}
async function renderResult(){
  const request=++resultRequest;if(!state.from||!state.to){state.pick=state.to?'from':'to';$('sq').value='';go('search');return;}
  if(state.mode==='actual'&&(!state.routes||state.tripKey!==tripKeyNow())){BASE=nowSeconds();state.routes=null;}
  setBasisOpen(false);
  mountMap('map-result');setText('from-name',tripLabel(state.from));setText('to-name',state.to.name);
  const status=$('result-status'),content=$('result-content');
  if(state.tripKey!==tripKeyNow()){state.routes=null;state.error=null;}
  status.hidden=false;content.hidden=true;$('result-footer').hidden=true;
  if(!state.routes&&!state.error){status.innerHTML='<b>내 걸음에 맞는 길을 찾고 있어요</b>서울 보행 도로망을 확인하고 있어요.';fitResultSheet();setRoutes(null,null);try{await computeTrip();}catch(e){console.error(e);state.error={title:'경로를 확인하지 못했어요',text:'다른 출입구를 선택하거나 다시 찾아 주세요.'};}if(current!=='result'||request!==resultRequest)return;}else refreshSims();
  if(state.error){status.innerHTML=`<b>${esc(state.error.title)}</b>${esc(state.error.text)}<button class="btn btn-ghost" data-route-retry>다시 찾기</button><button class="btn btn-primary" data-search="from">출발지 바꾸기</button>`;setRoutes(null,null);clearDyn();fitResultSheet();return;}
  status.hidden=true;content.hidden=false;$('result-footer').hidden=false;
  const S=state.sims,ps=paceState(),cell=marginCellText(ps);setText('result-pace',paceRowText(ps));
  for(const k of ['jjuk','short']){const c=$('card-'+k),sim=S[k];c.hidden=k==='short'&&state.same;c.setAttribute('aria-pressed',String(state.focus===k));const extra=k==='jjuk'?Math.max(0,Math.round((sim.total-S.short.total)/60)):0;
    c.innerHTML=`<span class="name">${k==='jjuk'?(state.same?'걷기 경로':'여유 있는 길'):'빠른 길'}</span><span class="mins">${mins(sim.total)}${extra?`<small>+${extra}분</small>`:''}</span><span class="margin">${cell}</span>`;}
  const sim=S[state.focus],r=state.routes[state.focus],unk=unknownXingText(sim);
  $('unknown-xings').hidden=!unk;setText('unknown-xings-text',unk);
  setText('result-note',resultNote({example:state.mode==='example',base:BASE})+(state.same?' · 두 후보가 같은 길이에요':''));
  setText('route-facts',`거리 ${km(sim.meters)} · 경로상 신호 ${sim.knownN+sim.unknownN}곳 · 지도에 표시된 계단 ${r.stairs}구간 · 오르막 추정 ${Math.round(r.rise)}m${r.under.length?' · 입체 구간 미확인':''} · 추가 ${state.budget/60}분 이내`);
  $('cov-note').hidden=false;setText('cov-text','횡단 방향·길이·점멸 시간이 함께 검증되지 않아 건널 여유는 표시하지 않아요.');
  setText('result-safety',`미확인 신호는 곳당 45초 대기를 가정해 소요 시간을 추정해요. 실제 신호·출입구·턱은 현장에서 확인해 주세요. 계단은 OSM 표시 구간, 경사는 지형 추정이며 무장애 경로를 보장하지 않아요.${readProfile().avoidSteps?' 확인된 계단은 제외했어요.':''}${state.same?' 조건 안에서 다른 후보를 찾지 못했어요.':''}`);
  setRoutes(r,state.same?null:state.routes[state.focus==='jjuk'?'short':'jjuk']);markTrip(S,state.focus,false);fitResultSheet();
  if(state.fitted!==state.tripKey){fit([state.routes.jjuk.coords,state.routes.short.coords]);state.fitted=state.tripKey;}
}
function renderDetail(){if(!state.sims)return go('home');const xs=state.sims[state.focus].xings;setText('detail-title',`경로의 횡단 정보 ${xs.length}곳`);$('detail-list').innerHTML=xs.map(x=>`<div class="xing"><span>○</span><div><b>${esc(x.name)}</b><small>${x.known?'과거 신호 이력 있음':'신호 정보 미확인'} · 횡단 여유 미확인</small></div></div>`).join('')+'<p class="note">과거 신호 이력은 지금 켜진 불이 아니에요. 횡단 방향·길이·점멸 시간이 검증되기 전에는 남은 초나 건너도 된다는 안내를 하지 않아요.</p>';}
document.addEventListener('click',e=>{
  const t=e.target,p=t.closest('[data-pace-hint]'),q=t.closest('[data-equipment]');
  if(p){onboardingHint=p.dataset.paceHint;renderOnboarding();}if(q){onboardingEquipment=selectEquipment(onboardingEquipment,q.dataset.equipment);onboardingEquipmentKnown=true;renderOnboarding();}
  if(t.closest('#onboarding-next')){if(onboardingStep===1){onboardingStep=2;renderOnboarding();}else finishOnboarding();}
  if(t.closest('#onboarding-skip'))finishOnboarding(true);
  if(t.closest('#onboarding-back')){onboardingStep=1;renderOnboarding();}
  if(t.closest('[data-go="settings"]'))settingsReturn=current==='result'?'result':'home';
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
  if(t.closest('#layer-toggle')){const b=$('layer-toggle'),on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',on);setText('layer-toggle',`횡단 시간 표시 ${on?'켜짐':'꺼짐'}`);XW.show(on);ready(()=>map.setLayoutProperty('sig-all','visibility',on?'visible':'none'));}
  if(t.closest('#xw-mine')){XW.setSpeed(SPEED);}
});
$('auto-mode').addEventListener('change',()=>{if($('auto-mode').checked)$('manual-mode').checked=false;});
$('manual-mode').addEventListener('change',()=>{if($('manual-mode').checked)$('auto-mode').checked=false;});
$('manual-speed').addEventListener('input',updateManualOutput);
