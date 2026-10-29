// 기기 내 설정과 보행 요약만 저장한다. 위치 경로는 메모리에만 머문다.
const PACE = { DEFAULT: 1.0, MIN: .2, MAX: 2.2, ACC: 20, WINDOW: 20, GAP: 30 };
const EQUIPMENT = ['stroller', 'walker', 'cane', 'luggage', 'other'];
const PACE_HINTS = ['behind', 'similar', 'ahead', 'unknown'];
let profileCache = null;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const inPaceRange = v => isNum(v) && v >= PACE.MIN && v <= PACE.MAX;
const clampSpeed = v => Math.min(PACE.MAX, Math.max(PACE.MIN, v));
function cleanProfile(value) {
  const p = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const learned = p.learned && typeof p.learned === 'object' ? p.learned : {};
  return { version: 2, onboarded: p.onboarded === true, paceHint: PACE_HINTS.includes(p.paceHint) ? p.paceHint : null,
    equipment: [...new Set(Array.isArray(p.equipment) ? p.equipment.filter(e => EQUIPMENT.includes(e)) : [])], equipmentAnswered:p.equipmentAnswered===true,
    mode: p.mode === 'manual' ? 'manual' : 'auto', autoEnabled: p.autoEnabled !== false, saveSummary: p.saveSummary !== false,
    manualSpeed: inPaceRange(p.manualSpeed) ? p.manualSpeed : PACE.DEFAULT,
    learned: { speed: inPaceRange(learned.speed) ? learned.speed : null,
      seconds: isNum(learned.seconds) && learned.seconds > 0 ? Math.min(learned.seconds, 7200) : 0,
      windows: Number.isInteger(learned.windows) && learned.windows > 0 ? Math.min(learned.windows, 1000) : 0 },
    avoidSteps: p.avoidSteps === true, avoidStepsSet:p.avoidStepsSet===true, budgetSeconds: [0, 120, 180, 300, 600].includes(p.budgetSeconds) ? p.budgetSeconds : 180 };
}
function readProfile() {
  if (!profileCache) profileCache = cleanProfile(store.get('profile', null));
  return cleanProfile(profileCache);
}
function writeProfile(value) {
  profileCache = cleanProfile(value);
  const saved = { ...profileCache, learned: profileCache.saveSummary ? profileCache.learned : {speed:null,seconds:0,windows:0} };
  return store.set('profile', saved);
}
function resetLearning() {
  const p = readProfile(); p.learned = { speed:null, seconds:0, windows:0 }; return writeProfile(p);
}
function selectEquipment(current, selected) {
  if (selected === 'none') return [];
  if (!EQUIPMENT.includes(selected)) return [...current];
  return current.includes(selected) ? current.filter(e => e !== selected) : [...current, selected];
}
function completeOnboarding(hint, equipment, skipped = false, equipmentAnswered = true) {
  const p = readProfile();
  p.onboarded = true;
  if (!skipped) {
    p.paceHint = PACE_HINTS.includes(hint) ? hint : null;
    p.equipment = equipment;
    p.equipmentAnswered = equipmentAnswered;
    if (!p.avoidStepsSet && equipment.some(e => ['stroller','walker'].includes(e))) p.avoidSteps = true;
  }
  return writeProfile(p);
}
function paceProfile() {
  const p = readProfile();
  return { mode: p.mode === 'manual' ? p.manualSpeed : 'auto', speed: p.learned.speed,
    moveS: p.learned.seconds, walks: p.learned.windows };
}
function walkSpeed(p = paceProfile()) { return p.mode === 'auto' ? p.speed || PACE.DEFAULT : clampSpeed(Number(p.mode)); }
function applyPace() { SPEED = walkSpeed(); }
function paceState() {
  const p = readProfile();
  if (p.mode === 'manual') return {kind:'manual', label:'직접 정한 걸음', speed:p.manualSpeed};
  if (!p.autoEnabled) return {kind:'paused', label:'걸음 측정 꺼짐', speed:p.learned.speed};
  if (p.learned.speed) return {kind:'learned', label:'내 걸음 반영', speed:p.learned.speed};
  return {kind:p.learned.seconds ? 'learning':'before', label:p.learned.seconds ? '내 걸음을 알아가는 중':'아직 측정 전', speed:null};
}
const kmh = v => (v * 3.6).toFixed(1) + 'km/h';
const speedText = v => v ? kmh(v) : '—';
const speedHTML = v => v ? `${(v * 3.6).toFixed(1)}<small>km/h</small>` : '—';
function paceText(v) { const n = Math.round(1000 / (v || PACE.DEFAULT)); return `${Math.floor(n/60)}'${String(n%60).padStart(2,'0')}"`; }
const homePaceSub = () => paceState().label;
const loadWalks = () => [];
function newTrack(kind, now = Date.now()) {
  return {kind,start:null,end:now,anchor:null,last:null,moveM:0,moveS:0,stopS:0,stops:0,moving:false,skipped:0,windows:[]};
}
function trackAdd(tr, fix) {
  if (!fix || !Array.isArray(fix.ll) || !fix.ll.every(isNum) || !isNum(fix.timestamp) || !isNum(fix.accuracy) || fix.accuracy < 0) return tr;
  if (tr.start == null) tr.start = fix.timestamp;
  if (tr.last && fix.timestamp <= tr.last.timestamp) return tr;
  tr.end = Math.max(tr.end, fix.timestamp);
  if (fix.accuracy > PACE.ACC) { tr.anchor = null; tr.last = null; tr.skipped++; return tr; }
  if (tr.last && fix.timestamp - tr.last.timestamp > PACE.GAP * 1000) tr.anchor = null;
  tr.last = fix;
  if (!tr.anchor) { tr.anchor = fix; return tr; }
  const a = tr.anchor, dt = (fix.timestamp-a.timestamp)/1000;
  const d = distLL(a.ll, fix.ll), noise = Math.max(4, a.accuracy + fix.accuracy);
  if (dt < PACE.WINDOW) return tr;
  // shortcut: GPS로 분간되지 않는 저속은 오류 속도로 대체하지 않고 관측 시간을 더 기다린다. 현장 보정 필요.
  if (d <= noise && dt < 90) return tr;
  tr.anchor = fix;
  if (d <= noise) { tr.stopS += dt; if (tr.moving) tr.stops++; tr.moving=false; return tr; }
  const v = d/dt;
  if (v > PACE.MAX || v < PACE.MIN) { tr.skipped++; return tr; }
  tr.moveM += d; tr.moveS += dt; tr.moving = true;
  tr.windows.push({v,seconds:dt});
  return tr;
}
const trackTail = () => null;
const trackFlush = tr => tr;
const trackMeters = tr => tr ? tr.moveM : 0;
const trackElapsedS = (tr, now = Date.now()) => tr?.start == null ? 0 : Math.max(0,(now-tr.start)/1000);
function resumeTrack(tr) { if (tr) { tr.anchor=null; tr.last=null; } return tr; }
function median(values) { const a=[...values].sort((a,b)=>a-b), i=Math.floor(a.length/2); return a.length%2 ? a[i] : (a[i-1]+a[i])/2; }
function trackSpeed(tr) {
  if (!tr || tr.moveS < 120 || tr.windows.length < 4) return null;
  const speeds=tr.windows.map(w=>w.v), v=median(speeds);
  const spread=median(speeds.map(s=>Math.abs(s-v)));
  return spread <= Math.max(.15,v*.25) ? v : null;
}
function finishTrack(tr, info = {}, now = Date.now()) {
  if (!tr || tr.start == null) return null;
  const speed=trackSpeed(tr), p=readProfile();
  // 실제 이동 경로와 활동 기록을 남기지 않고 유효 관측 요약만 갱신한다.
  if (p.mode==='auto' && p.autoEnabled && tr.moveS>0) {
    if (speed) {
      const old=p.learned, weight=old.speed ? Math.min(old.seconds,1800) : 0;
      p.learned.speed=Math.round(((old.speed||0)*weight+speed*tr.moveS)/(weight+tr.moveS)*100)/100;
    }
    p.learned.seconds+=tr.moveS; p.learned.windows+=tr.windows.length;
  }
  const saved=writeProfile(p);
  return { at:new Date(tr.start).toISOString(),kind:tr.kind,trip:info.trip||null,to:info.to||null,
    arrived:info.routeLength ? tr.moveM >= info.routeLength*.9 : false,
    elapsedS:Math.max(0,Math.round((now-tr.start)/1000)),moveS:tr.moveS,meters:Math.round(tr.moveM),speed,stops:tr.stops,unsaved:!saved };
}
function arrivalCopy(rec, {estimateS,fromName,toName}) {
  return {partial:!rec.arrived,kind:rec.arrived ? `${toName} 근처의 걷기를 마쳤어요` : `${fromName}에서 걷기를 마쳤어요`,
    compare:`걸은 거리 ${km(rec.meters)}`,hint:rec.unsaved ? '설정을 저장하지 못했어요' : '위치 경로는 저장하지 않았어요'};
}
function resultNote({example,base}) { return `${example?'08:40 예시':clock(base)+' 출발'} · ${paceState().speed ? '내 걸음 기준':'임시 걸음 기준'} · 과거 신호 이력`; }
function setText(id,text) { const e=$(id); if (e && e.textContent!==text) e.textContent=text; }
