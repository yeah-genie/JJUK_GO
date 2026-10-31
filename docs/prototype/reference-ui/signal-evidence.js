/* Existing confidence gates decide whether time values may be displayed. */
(function(root){
 'use strict';
 root.JJUKGO_SIGNAL_EVIDENCE={create(engine){return function build(x){
  const id=x.s??x.id,dirs=x.dir?[x.dir]:x.dirs||[],time=engine.now(),speed=engine.speed();
  const meta=engine.meta(id),direction=x.dir?engine.direction(x.dir):dirs.length?'방향 후보':x.locationOnly?'위치 정보':'방향 미연결';
  const name=meta?.name&&!meta.name.includes('\uFFFD')?meta.name:id==='unmapped'?'신호 횡단보도':'주변 교차로';
  const label=name+' · '+direction;
  const item={key:id+':'+(x.dir||dirs.join(','))+':'+(x.mid||x.at||x.ll).join(','),id,ll:x.mid||x.at||x.ll,label,state:'unknown',trusted:false,remainingSeconds:null,statusLabel:'신호 상태 미확인',secondsLabel:'남은 시간 미확인',sourceLabel:engine.period(),reason:'이 시간대 기록 없음',raw:x};
  if(!dirs.length){item.reason=x.locationOnly?'위치는 있지만 시간·횡단 방향 정보가 없어요':'횡단 방향 미연결';item.statusLabel=x.locationOnly?'시간 정보 없음':item.statusLabel;if(x.locationOnly)item.sourceLabel='신호 위치 자료 · 현재 시간 정보 없음';return item;}
  const records=dirs.map(d=>engine.plan(id,time,d));
  if(records.every(r=>!r))return item;
  const lengths=records.filter(r=>r&&(r.observed_samples||0)>=900&&(r.test_samples||0)>=300&&(r.holdout_accuracy||0)>=.95&&(r.impurity??1)<=.02).flatMap(r=>(r.win||[]).map(([a,b])=>b-a)).filter(n=>Number.isFinite(n)&&n>0);
  if(lengths.length){const lo=Math.round(Math.min(...lengths)),hi=Math.round(Math.max(...lengths));item.historySummary=`기록상 초록 구간 약 ${lo===hi?lo:lo+'–'+hi}초 (이력 추정)`;item.statusLabel='신호 기록 있음';}
  if(records.some(r=>!r)){item.reason='방향별 기록 일부 미확인';return item;}
  if(records.some(r=>engine.confidence(r)<=0)){item.reason=records.some(r=>!r.xd?.[0])?'여러 날 비교 자료가 더 필요해요':'날짜별 반복 패턴 검증 부족';return item;}
  const phase=engine.predict(x,time);if(!phase){item.reason='방향별 예상 상태가 달라요';return item;}
  const seconds=phase.walk?phase.rem:phase.wait;
  if(!Number.isFinite(seconds)||seconds<0){item.reason='남은 시간 계산 불가';return item;}
  item.state=phase.walk?'walk':'wait';item.trusted=true;item.remainingSeconds=Math.floor(seconds);
  item.statusLabel=phase.walk?'초록 예상':'대기 예상';
  item.secondsLabel=phase.walk?`초록 예상 · 약 ${item.remainingSeconds}초 남음`:`다음 초록까지 약 ${Math.ceil(seconds)}초`;
  item.reason=x.len?'현장 신호를 함께 확인하세요':'횡단 길이는 아직 미확인이에요';
  item.canCross=!!x.len&&engine.verdict(x,time,speed).kind==='go';
  return item;
 };}};
})(window);
