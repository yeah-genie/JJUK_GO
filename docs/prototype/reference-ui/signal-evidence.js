/* Existing confidence gates decide whether time values may be displayed. */
(function(root){
 'use strict';
 function replayPhase(pattern,elapsed){
  const cycle=pattern?.cycle,list=pattern?.windows;
  if(!Array.isArray(list)||!list.every(w=>Array.isArray(w)&&w.length===2))return null;
  const windows=list.slice().sort((a,b)=>a[0]-b[0]);
  if(!Number.isFinite(cycle)||cycle<=0||!Number.isFinite(elapsed)||elapsed<0||!windows?.length||!windows.every(([a,b],i)=>Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&a<b&&b<=cycle&&(!i||a>=windows[i-1][1])))return null;
  const gap=windows[0][0]+cycle-windows.at(-1)[1],start=windows[0][0]-Math.min(3,gap);
  const phase=((start+elapsed)%cycle+cycle)%cycle,green=windows.find(([a,b])=>phase>=a&&phase<b);
  return green?{state:'walk',seconds:Math.ceil(green[1]-phase)}:{state:'wait',seconds:Math.ceil((windows.find(([a])=>a>phase)?.[0]??windows[0][0]+cycle)-phase)};
 }
 root.JJUKGO_SIGNAL_EVIDENCE={replayPhase,create(engine){return function build(x){
  const id=x.s??x.id,dirs=x.dir?[x.dir]:x.dirs||[],time=engine.now(),speed=engine.speed();
  const meta=engine.meta(id),direction=x.dir?engine.direction(x.dir):dirs.length?'방향 후보':x.locationOnly?'위치 정보':'방향 미연결';
  const name=meta?.name&&!meta.name.includes('\uFFFD')?meta.name:id==='unmapped'?'신호 횡단보도':'주변 교차로';
  const label=name+' · '+direction;
  const item={key:id+':'+(x.dir||dirs.join(','))+':'+(x.mid||x.at||x.ll).join(','),id,ll:x.mid||x.at||x.ll,label,state:'unknown',trusted:false,remainingSeconds:null,historyLabel:null,historySummary:null,recordedPattern:null,countdown:null,arrival:false,arrivalKind:null,arrivalText:null,crossingLength:null,crossingSeconds:null,geometrySummary:null,canCross:false,statusLabel:'시간 자료 없음',secondsLabel:'현재 신호는 알 수 없어요',sourceLabel:engine.period(),reason:'이 요일·시간의 신호 기록이 없어요',raw:x};
  if(Number.isFinite(x.len)&&x.len>0&&Number.isFinite(speed)&&speed>0){item.crossingLength=Math.round(x.len);item.crossingSeconds=Math.ceil(x.len/speed);item.geometrySummary=`지도상 횡단 약 ${item.crossingLength}m · 걸어서 약 ${item.crossingSeconds}초`;}
  if(!dirs.length){item.reason=x.locationOnly?'위치는 있지만 시간·횡단 방향 정보가 없어요':'횡단 방향 미연결';item.statusLabel=x.locationOnly?'시간 정보 없음':item.statusLabel;if(x.locationOnly)item.sourceLabel='신호 위치 자료 · 현재 시간 정보 없음';return item;}
  const records=dirs.map(d=>engine.plan(id,time,d));
  const qualified=r=>r&&(r.observed_samples||0)>=900&&(r.test_samples||0)>=300&&(r.holdout_accuracy||0)>=.95&&(r.impurity??1)<=.02&&r.c>0&&Math.abs(r.c-Math.round(r.c))<=.06&&r.win?.length&&r.win.every(([a,b])=>a>=0&&b>a&&b<=r.c);
  const otherPeriod=!records.every(qualified),durations=otherPeriod?dirs.map(d=>engine.history?.(id,d)):records;
  const lengths=durations.every(qualified)?durations.flatMap(r=>r.win.map(([a,b])=>b-a)):[];
  if(lengths.length&&durations.length===1)item.recordedPattern={cycle:durations[0].c,windows:durations[0].win};
  if(lengths.length){const lo=Math.round(Math.min(...lengths)),hi=Math.round(Math.max(...lengths));item.historySummary=`기록상 초록 구간 약 ${lo===hi?lo:lo+'–'+hi}초 (이력 추정)`;item.historyLabel=`과거 초록 약 ${lo===hi?lo:lo+'–'+hi}초`;item.statusLabel=item.historyLabel;item.secondsLabel=item.historyLabel+' · 현재 신호 아님';const dates=[...new Set(durations.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(r.start)).map(r=>r.date.slice(5)+' '+Math.floor(r.start/3600)+'시'))];if(dates.length)item.sourceLabel=dates.join(', ')+' 기록으로 추정'+(otherPeriod?' · 다른 요일·시간':'');}
  if(records.every(r=>!r)){if(item.historyLabel)item.reason='다른 시간의 과거 기록이에요. 현재 신호와 남은 시간은 알 수 없어요';else item.sourceLabel='보행 지도 · 이 요일·시간의 신호 기록 없음';return item;}
  if(records.some(r=>!r)){item.reason='방향별 기록 일부 미확인';return item;}
  if(records.some(r=>engine.confidence(r)<=0)){item.reason=records.some(r=>!r.xd?.[0])?'다른 날짜에도 같은지 확인되지 않아 현재 남은 시간은 표시하지 않아요':'날짜별 신호가 일정하지 않아 현재 남은 시간은 표시하지 않아요';return item;}
  const phase=engine.predict(x,time);if(!phase){item.reason='방향별 예상 상태가 달라요';return item;}
  const seconds=phase.walk?phase.rem:phase.wait;
  if(!Number.isFinite(seconds)||seconds<0){item.reason='남은 시간 계산 불가';return item;}
  // 지금 시각 기준 초읽기: 'N초 뒤 빨간불/초록불'. 1초마다 다시 계산된다. 과거 기록 패턴의 예상이라 '(예상)'을 붙인다.
  const left=Math.max(0,Math.ceil(seconds));
  item.state=phase.walk?'walk':'wait';item.trusted=true;item.remainingSeconds=left;
  item.statusLabel=phase.walk?'지금 초록(예상)':'지금 빨강(예상)';
  item.countdown=phase.walk?`${left}초 뒤 빨간불`:`${left}초 뒤 초록불`;
  item.secondsLabel=`${phase.walk?'지금 초록':'지금 빨강'} · ${item.countdown} (예상)`;
  item.reason=x.len?'현장 신호를 함께 확인하세요':'횡단 길이는 아직 미확인이에요';
  item.canCross=false;
  // 경로 위 횡단은 '지금'이 아니라 '내가 도착할 때'의 예상으로 보여 준다(경로의 예상 대기 계산과 같은 기준)
  const arrive=engine.arrival?.(x);
  if(Number.isFinite(arrive)){
   const v=engine.verdict(x,arrive,speed);
   // 제목은 지금 기준 초읽기, 설명 줄에 '내가 도착할 때' 예상을 덧붙인다
   if(v.kind!=='unknown'){item.arrival=true;item.arrivalKind=v.kind;item.arrivalText=v.text;item.reason=v.text;item.canCross=v.kind==='go';
    // 경로를 고르는 화면에서는 '내가 도착할 때'가 중요하다: 제목·색을 도착 기준으로(걷는 중 가까운 신호만 지금 초읽기)
    if(engine.preferArrival?.()){const p=engine.predict(x,arrive);item.state=v.kind==='wait'||v.kind==='short'?'wait':'walk';
     item.secondsLabel=v.kind==='go'?'건널 수 있어요(예상)':v.kind==='green'?'도착 때 초록 예상':v.kind==='short'?'도착 때 초록이 짧아요(예상)':`도착하면 약 ${Math.round(p?.wait||0)}초 대기(예상)`;
     item.statusLabel=v.label;item.reason=v.text+' · 지금 신호: '+item.countdown;}}
  }
  return item;
 };}};
})(window);
