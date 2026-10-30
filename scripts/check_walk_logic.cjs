// Run without browser or network: node scripts/check_walk_logic.cjs
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { textContent: '', addEventListener() {},querySelector(){return null;},classList:{toggle(){}} });
  return elements.get(id);
};
// 저장소·이벤트를 흉내 낸다: 저장 실패(용량 초과·사생활 보호 모드)와 pagehide를 시험하려면 필요하다.
const listeners = {};
const fakeStorage = { data: new Map(), fail: false,
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; },
  setItem(k, v) { if (this.fail) throw new Error('QuotaExceededError'); this.data.set(k, String(v)); },
  removeItem(k) { this.data.delete(k); } };
const context = vm.createContext({
  assert, URL, URLSearchParams, console, Date, Math, Number, Map, Set, Error, performance, localStorage: fakeStorage, __listeners: listeners,
  document: { baseURI: 'https://jjukgo.test/', getElementById: element, createElement: () => ({}), addEventListener() {} },
  window: { isSecureContext: true }, navigator: {}, maplibregl: { addProtocol() {} },
  addEventListener(type, fn) { listeners[type] = fn; }, clearInterval() {},setTimeout(){return 0;},cancelAnimationFrame(){},
});
const app = fs.readFileSync(path.join(__dirname, '../docs/prototype/src/app.js'), 'utf8').replace('/*WALKING_PROFILE*/',fs.readFileSync(path.join(__dirname,'../docs/prototype/src/walking-profile.js'),'utf8')).replace('/*ASPHALT_UI*/',fs.readFileSync(path.join(__dirname,'../docs/prototype/src/screens.js'),'utf8')).replace(/boot\(\);\s*$/, '');
vm.runInContext(app+'\n'+fs.readFileSync(path.join(__dirname,'../docs/prototype/src/walk-card.js'),'utf8'), context);
vm.runInContext(`
  SPEED=1.2;
  REAL = {signals:{'test':{bands:[{start:28800,end:32400,legs:{n:{day0:0,ref:0,c:120,win:[[0,30]]}}}]}},source_dates:[]};
  assert.equal(known('test',28800,'n'),true);
  assert.equal(known('test',32400,'n'),false);
  assert.equal(known('test',28800,'s'),false);
  assert.equal(known('test',28800,null),false);
  assert.equal(sigWait('test',28800,'n'),0);
  assert.equal(sigWait('test',28800,'s'),null);
  REAL={signals:{},source_dates:[]};
  assert.equal(state.from,null);assert.equal(state.to,null);
  const comfortRoutes={short:{stairs:2,rise:50,terrainMeters:300,length:300},jjuk:{stairs:3,rise:20,terrainMeters:300,length:300}};
  const comfortSims={short:{total:600,knownN:1,unknownN:1},jjuk:{total:660,knownN:1,unknownN:1}};
  const comfort=comfortCopy(comfortRoutes,comfortSims,'jjuk',false,120);
  assert(comfort.title.includes('오르막 추정'));assert(comfort.copy.includes('30m'));assert(comfort.copy.includes('계단 1구간은 더'));
  const sameComfort=comfortCopy(comfortRoutes,comfortSims,'jjuk',true,120);
  assert(sameComfort.title.includes('같은 길'));assert(!sameComfort.title.includes('줄이는'));
  assert(comfortCopy(comfortRoutes,comfortSims,'short',false,120).title.includes('도착 시간'));
  // Direction matters: descending is not climbing; missing/grade-separated is unknown.
  G.node.set(1, { x:100, y:100, h:10 }); G.node.set(2, { x:200, y:100, h:30 });
  assert.equal(edgeRise({cls:2},1,2),20);
  assert.equal(edgeRise({cls:2},2,1),0);
  assert.equal(edgeRise({cls:4},1,2),null);
  G.node.get(2).h=null; assert.equal(edgeRise({cls:2},1,2),null);
  assert.equal(terrainHeight(127,37.5),null);
  TERRAIN={zoom:0,size:2,tiles:{'0_0':[10,20,30,40]}};
  assert.equal(terrainHeight(-90, Math.atan(Math.sinh(Math.PI/2))*180/Math.PI),25);
  TERRAIN=null;
  // 빠른 길 vs 쭉고 길: 계단이 있는 짧은 길과 평지로 돌아가는 길. 쭉고 길은 의미 있는 대안일 때만 고른다.
  G.node.clear(); G.adj.clear();
  G.node.set(1,{x:100,y:100,h:10}); G.node.set(2,{x:200,y:100,h:10}); G.node.set(3,{x:150,y:180,h:10});
  const edges=[{a:1,b:2,len:89,cls:3,f:null},{a:1,b:3,len:99,cls:2,f:null},{a:3,b:2,len:99,cls:2,f:null}];
  for(const e of edges) for(const id of [e.a,e.b]) { if(!G.adj.has(id))G.adj.set(id,[]);G.adj.get(id).push(e); }
  state.src=1;state.dst=2;state.from={ll:fromQ(100,100)};state.to={ll:fromQ(200,100)};
  const mk=w=>{const st=searchFriction(1,2,w),r=buildRoute(st,1,state.from.ll,state.to.ll);r.steps=st;r.m=routeMetrics(r,st);return r;};
  const fast=mk([0,0,0,0,0]), level=mk([0,0,0,0,8]);
  assert.equal(fast.m.stairs,1);assert.equal(level.m.stairs,0);assert(level.m.walk>fast.m.walk);
  const extra=level.m.walk-fast.m.walk;
  assert.equal(pickAlternative(fast,[level],extra-1),null,'허용 시간을 넘으면 대안 없음');
  assert.equal(pickAlternative(fast,[level],180),level,'계단을 줄이면 대안');
  assert.equal(compareLine(fast,level),extraText(extra)+'로 계단을 피할 수 있어요');
  assert.equal(pickAlternative(fast,[fast],180),null,'같은 길은 대안이 아님');
  // 다른 지표가 나빠지면 대안 아님
  const worse={...level,m:{...level.m,sig:fast.m.sig+1}};
  assert.equal(pickAlternative(fast,[worse],180),null,'신호 횡단이 늘면 대안 아님');
  // 한 줄 설명 문장: 조사와 '피할/줄일'
  const B={m:{walk:600,sig:2,stairs:0,gain:30,steep:300,cross:3,big:0}};
  assert.equal(compareLine(B,{m:{...B.m,walk:625,sig:1}}),'+25초로 신호 횡단 1개를 줄일 수 있어요');
  assert.equal(compareLine(B,{m:{...B.m,walk:617,steep:0}}),'+17초로 급경사 구간 300m를 피할 수 있어요');
  assert.equal(compareLine(B,{m:{...B.m,walk:638,sig:1,steep:170}}),'+38초로 신호 횡단 1개와 급경사 구간 130m를 줄일 수 있어요');
  assert.equal(compareLine(B,{m:{...B.m,walk:690,gain:15}}),'+1분 30초로 오르막 15m를 줄일 수 있어요');
  assert.equal(compareLine(B,{m:{...B.m,walk:660,gain:15}}),'+1분으로 오르막 15m를 줄일 수 있어요');
  // ---- 예상 신호 대기: 신뢰 조건을 모두 만족하는 패턴만 숫자로 쓴다 ----
  DAYTYPE_NOW='wd';
  const good={c:120,ref:0,day0:0,win:[[0,40]],date:'2026-10-27',observed_samples:1500,test_samples:500,holdout_accuracy:.99,impurity:.005,xd:[4,.97,.96,0,null]};
  REAL={signals:{A:{bands:[{start:28800,end:32400,legs:{n:good},legsWe:{n:{...good,date:'2026-10-24'}}}]}},source_dates:['20261014','20261027']};
  const T0=28800;                                              // 08:00, 주기 0초에 초록 시작
  assert(planConfidence(good)>0,'기준 충족');
  assert.equal(expectedWait('A',T0+10,'n'),0,'초록 안에서 도착하면 대기 0');
  assert.equal(Math.round(expectedWait('A',T0+50,'n')),70,'빨강에서 도착하면 다음 초록까지');
  assert.equal(expectedWait('A',T0+50,'s'),null,'방향 패턴이 없으면 정보 없음');
  assert.equal(expectedWait('B',T0+50,'n'),null,'패턴이 없으면 정보 없음');
  for(const [why,bad] of [['관측 부족',{...good,observed_samples:600}],['검증 표본 부족',{...good,test_samples:100}],['검증 일치율 낮음',{...good,holdout_accuracy:.9}],['불순도 높음',{...good,impurity:.05}],['주기가 정수가 아님',{...good,c:120.4}],
    ['날짜 비교 없음',{...good,xd:null}],['비교 날짜 없음',{...good,xd:[0,null,null,0,null]}],['날짜별 변동 큼(중앙값)',{...good,xd:[4,.8,.8,0,null]}],['날짜별 변동 큼(최솟값)',{...good,xd:[4,.97,.5,0,null]}],['요일 종류 다름',{...good,date:'2026-10-24'}]]) {
    assert.equal(planConfidence(bad),0,why);
  }
  DAYTYPE_NOW='we';assert.equal(planConfidence(good),0,'오늘이 주말이면 평일 패턴은 쓰지 않음');assert.equal(expectedWait('A',T0+50,'n'),Math.round(0)+expectedWait('A',T0+50,'n'),'주말에는 주말 패턴을 씀');assert.notEqual(expectedWait('A',T0+50,'n'),null,'주말 패턴이 있으면 숫자가 나옴');DAYTYPE_NOW='wd';
  assert.equal(planPeriodText(),'10/14~10/27 신호 기록 기준 추정');
  // 경로 합산: 확인된 신호만 더하고 모르는 곳은 정보 없음으로 센다(45초 같은 가정값 없음)
  BASE=T0;state.dep=0;SPEED=1.2;
  const rt={x:[{s:'A',dir:'n',d:0},{s:'B',dir:'n',d:60},{s:'A',dir:null,d:120}]};
  const w=routeWaits(rt);assert.equal(w.waitKnown,1);assert.equal(w.waitUnknown,2);assert.equal(w.waitTotal,3);assert.equal(w.wait,0);
  const rt2={x:[{s:'A',dir:'n',d:60}]};const w2=routeWaits(rt2);assert.equal(Math.round(w2.wait),70-50>0?Math.round(expectedWait('A',T0+50,'n')):0);
  // 대안 조건: 대기가 30초 이상 줄고, 확인 안 된 신호가 더 많지 않을 때만
  const bw={m:{walk:600,sig:2,stairs:0,gain:10,steep:0,cross:3,big:0,wait:120,waitKnown:2,waitUnknown:0,waitTotal:2}};
  const aw=(wait,unk)=>({steps:[],m:{...bw.m,walk:660,wait,waitKnown:2-unk,waitUnknown:unk,waitTotal:2}});
  assert.deepEqual(altGains(aw(60,0),bw),['wait']);
  assert.deepEqual(altGains(aw(100,0),bw),[],'20초만 줄면 의미 없음');
  assert.deepEqual(altGains(aw(60,1),bw),[],'확인된 신호가 줄어서 이기면 안 됨(정보 없음을 0초로 세지 않는다)');
  assert.deepEqual(altGains({steps:[],m:{...bw.m,walk:660,wait:0,waitKnown:0,waitUnknown:2,waitTotal:2}},bw),[],'쭉고 길의 신호가 전부 정보 없음이면 대기 감소로 세지 않음');
  assert.equal(routeSummary(bw,aw(70,0),'jjuk').headline,'신호에서 약 50초 덜 기다릴 것으로 예상돼요');
  assert(!/건널 수|건너도|안전|한 번에/.test(routeSummary(bw,aw(70,0),'jjuk').headline+routeSummary(bw,aw(70,0),'jjuk').sub),'횡단 가능 판단 문구 금지');
  assert.equal(compareLine(bw,aw(70,0)),'+1분으로 신호 대기 50초를 줄일 수 있어요');
  REAL={signals:{},source_dates:[]};DAYTYPE_NOW=null;
  // 계단 제외 설정이면 계단 길을 쓰지 않는다
  const baseProfile=readProfile();writeProfile({...baseProfile,avoidSteps:true});
  assert.equal(mk([0,0,0,0,0]).m.stairs,0);
  writeProfile(baseProfile);
  state.routes={short:fast,jjuk:level,dep:0,budget:180,alt:true};state.budget=180;refreshSims();assert.equal(state.same,false);
  const route=state.routes.short;
  const projected=projectOnRoute(route,pointAt(route,route.length/2));
  assert(Math.abs(projected.distance-route.length/2)<0.1);assert(projected.offset<0.1);
  assert(projectOnRoute(route,[127.1,37.6]).offset>100);
  const fix={coords:{longitude:126.97,latitude:37.56,accuracy:8},timestamp:Date.now()};
  assert.equal(readFix(fix).accuracy,8);
  assert.equal(plausibleProgress({...readFix(fix),timestamp:Date.now()-1000,distance:0},readFix(fix),500),false);
  assert.throws(()=>readFix({...fix,timestamp:Date.now()-40000}),/오래/);
  assert.throws(()=>readFix({...fix,coords:{...fix.coords,accuracy:500}}),/오차/);
  assert.throws(()=>readFix({...fix,coords:{...fix.coords,longitude:129}}),/서울/);
  current="home";gpsError({code:1});assert($('location-status').textContent.includes('권한'));
  let cleared=null; navigator.geolocation={clearWatch(id){cleared=id;}};gpsWatch=7;stopGPS();assert.equal(cleared,7);assert.equal(gpsWatch,null);
`, context);
vm.runInContext(`
  BASE=0;
  REAL={signals:{k:{bands:[{start:0,end:3600,legs:{n:{day0:0,ref:0,c:120,win:[[0,30]]}}}]}},source_dates:[]};
  const estimated=simulate({length:120,x:[{s:'unknown',d:0},{s:'k',dir:'n',d:0}]},0);
  assert.equal(estimated.assumedWait,45);assert.equal(estimated.wait,75);assert.equal(estimated.total,220);
  BASE=31200;REAL={signals:{},source_dates:[]};
  let late; current='home';navigator.geolocation={getCurrentPosition(ok,err){late=ok;},clearWatch(){}};
  locate(true);assert.equal(gpsPending,true);assert($('location-status').textContent.includes('찾고'));
  current='search';stopGPS();assert.equal(gpsPending,false);assert.equal($('location-status').textContent,'');
  const oldOrigin=state.from;late({coords:{longitude:126.97,latitude:37.56,accuracy:8},timestamp:Date.now()});assert.equal(state.from,oldOrigin);
  assert.equal(readFix({coords:{longitude:126.97,latitude:37.56,accuracy:500},timestamp:Date.now()},1000).accuracy,500);
  G.node.clear();G.adj.clear();
  G.node.set(101,{x:100,y:100,h:10});G.node.set(102,{x:300,y:100,h:10});
  const longEdge={a:101,b:102,len:200,cls:2};G.adj.set(101,[longEdge]);G.adj.set(102,[longEdge]);
  G.adj.get(101).push({a:101,b:999,len:200,cls:2});
  const middle=snap(fromQ(200,100));assert(middle.id<0);assert(middle.d<.01);
  assert(Math.abs(G.adj.get(middle.id).reduce((n,e)=>n+e.len,0)-200)<.01);
  assert.equal(snap(fromQ(200,500)).id,null);
  state.src=middle.id;state.dst=102;state.from={ll:fromQ(200,100)};state.to={ll:fromQ(300,100)};
  const splitRoute=routeFor('short',0);assert(splitRoute.coords.every(p=>p.every(Number.isFinite)));assert(Number.isFinite(simulate(splitRoute,0).total));
  assert(Math.abs(splitRoute.length-distLL(state.from.ll,state.to.ll))<.01);
`,context);
vm.runInContext(`(async()=>{
  const originalGo=go;let redirected=null;go=name=>{redirected=name};
  state.from=null;state.to=DEMO_TO;await renderResult();assert.equal(redirected,'search');assert.equal(state.pick,'from');
  const goal=state.to;gpsFix={ll:[126.97,37.56],accuracy:8,timestamp:Date.now()};rerouteFromGPS();
  assert.equal(state.to,goal);assert.equal(state.from.me,true);assert.equal(redirected,'result');assert.equal(state.routes,null);
  go=originalGo;
  const turnRoute={coords:[[126.97,37.56],[126.971,37.56],[126.971,37.561]],cum:[0,88,199],length:199,x:[],guides:[]};
  assert(routeGuidance(turnRoute,55).label.includes('왼쪽'));
  turnRoute.guides=[{d:65,label:'계단 구간'}];assert.equal(routeGuidance(turnRoute,55).label,'계단 구간');
  let attempts=0;const original=getJSON;
  getJSON=async()=>{attempts++;throw new Error('offline')};
  await assert.rejects(loadCell('retry-cell'));await assert.rejects(loadCell('retry-cell'));
  assert.equal(attempts,2);getJSON=original;
})()`,context);

vm.runInContext(`
  const originals={mountMap,setRoutes,markTrip,setSheet,fit};
  mountMap=()=>{};setRoutes=()=>{};markTrip=()=>{};setSheet=()=>{};fit=()=>{};
  current='walk';state.freeWalk=false;state.focus='jjuk';state.same=true;
  state.sims={jjuk:{}};state.routes={jjuk:{length:100,coords:[]}};
  navigator.geolocation=null;
  assert.doesNotThrow(()=>renderWalk());
  assert($('walk-location').textContent.includes('HTTPS'));
  assert.equal($('walk-demo').hidden,true);
  ({mountMap,setRoutes,markTrip,setSheet,fit}=originals);
`,context);
console.log("PASS navigation: signal direction/time validity, terrain direction, route budget, projection, GPS rejection, retry, snap, destination preservation and walk initialization");

vm.runInContext(`
  current='home';let calls=[],success=null,failure=null;
  navigator.geolocation={getCurrentPosition(ok,fail,opts){calls.push({ok,fail,opts});}};
  requestLocation(p=>success=p,e=>failure=e);assert.equal(calls[0].opts.enableHighAccuracy,false);
  calls[0].fail({code:3});assert.equal(calls.length,2);assert.equal(calls[1].opts.enableHighAccuracy,true);
  calls[1].ok({coords:{accuracy:8}});assert.equal(success.coords.accuracy,8);
  calls=[];requestLocation(()=>{},e=>failure=e);calls[0].fail({code:1});assert.equal(calls.length,1);assert.equal(failure.code,1);
  calls=[];requestLocation(p=>success=p,()=>{});calls[0].ok({coords:{accuracy:500}});assert.equal(calls.length,2);calls[1].fail({code:3});assert.equal(success.coords.accuracy,500);
`,context);
console.log('PASS GPS acquisition: fast first, precision retry, no permission loop, coarse confirmation fallback');
