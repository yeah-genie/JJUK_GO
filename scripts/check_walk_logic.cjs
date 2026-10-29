// Run without browser or network: node scripts/check_walk_logic.cjs
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { textContent: '', addEventListener() {} });
  return elements.get(id);
};
const context = vm.createContext({
  assert, URL, console, Date, Math, Number, Map, Set, Error, performance,
  document: { baseURI: 'https://jjukgo.test/', getElementById: element, createElement: () => ({}), addEventListener() {} },
  window: { isSecureContext: true }, navigator: {}, maplibregl: { addProtocol() {} },
  addEventListener() {}, clearInterval() {},
});
const app = fs.readFileSync(path.join(__dirname, '../docs/prototype/src/app.js'), 'utf8').replace(/boot\(\);\s*$/, '');
vm.runInContext(app, context);
vm.runInContext(`
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
  // A short stair route and a longer level route. A one minute budget rejects the detour.
  G.node.clear(); G.adj.clear();
  G.node.set(1,{x:100,y:100,h:10}); G.node.set(2,{x:200,y:100,h:10}); G.node.set(3,{x:150,y:180,h:10});
  const edges=[{a:1,b:2,len:89,cls:3},{a:1,b:3,len:99,cls:2},{a:3,b:2,len:99,cls:2}];
  for(const e of edges) for(const id of [e.a,e.b]) { if(!G.adj.has(id))G.adj.set(id,[]);G.adj.get(id).push(e); }
  state.src=1;state.dst=2;state.from={ll:fromQ(100,100)};state.to={ll:fromQ(200,100)};
  state.routes={short:routeFor('short',0),dep:0,budget:null};state.budget=60;
  refreshSims(); assert.equal(state.same,true);assert.equal(state.routes.jjuk.stairs,1);
  state.budget=120;refreshSims();assert.equal(state.same,false);assert.equal(state.routes.jjuk.stairs,0);
  const a=state.sims.jjuk,b=state.sims.short;
  assert(a.total>=b.total);assert(a.total<=b.total+state.budget);
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
  // 걸음 속도: 1.25m/s로 3분 걷고 20초 서고 다시 1분. 위치는 2초마다, 오차 8m, 좌우로 3m 흔들림.
  const kx=111320*Math.cos(37.56*Math.PI/180), t0=1700000000000;
  const at=(m,s,jit=0)=>({ll:[126.97+m/kx,37.56+jit/110540],accuracy:8,timestamp:t0+s*1000});
  let tr=newTrack('free',t0), m=0, s=0, k=0;
  const walk=(secs,v)=>{for(let i=0;i<secs;i+=2){s+=2;m+=v*2;trackAdd(tr,at(m,s,(k++%2?3:-3)));}};
  walk(180,1.25); walk(20,0); walk(60,1.25);
  const v=trackSpeed(tr);
  assert(Math.abs(v-1.25)<0.06,'speed '+v);
  assert.equal(tr.stops,1);
  assert(Math.abs(trackMeters(tr)-300)<15,'moved '+trackMeters(tr));
  // 서 있을 때 GPS가 흔들려도 걸은 거리로 세지 않는다
  let still=newTrack('free',t0);
  for(let i=1;i<=60;i++) trackAdd(still,at(i%2?5:-5,i*2));
  assert.equal(still.moveM,0); assert.equal(trackSpeed(still),null);
  // 오차가 큰 위치, 차량 속도(8m/s)는 빼고, 너무 짧은 걷기는 속도를 내지 않는다
  let car=newTrack('free',t0);
  for(let i=1;i<=60;i++) trackAdd(car,at(i*16,i*2));
  assert.equal(car.moveM,0); assert(car.skipped>0);
  let fuzzy=newTrack('free',t0); trackAdd(fuzzy,{...at(0,1),accuracy:60}); assert.equal(fuzzy.anchor,null);
  let brief=newTrack('free',t0); for(let i=1;i<=20;i++) trackAdd(brief,at(i*2.5,i*2)); assert.equal(trackSpeed(brief),null);
  // 새 기록은 걸은 시간만큼 섞이고, 범위를 벗어나지 않는다
  const p0={mode:'auto',speed:null,moveS:0,walks:0};
  const p1=learnPace(p0,1.0,600); assert.equal(p1.speed,1); assert.equal(p1.walks,1);
  const p2=learnPace(p1,1.4,600); assert.equal(p2.speed,1.2);
  assert.equal(learnPace(p0,9,600).speed,PACE.MAX);
  assert.equal(walkSpeed({mode:'auto',speed:null}),1.2); assert.equal(walkSpeed({mode:0.9}),0.9); assert.equal(walkSpeed(p2),1.2);
  assert.equal(paceText(1.2),String.fromCharCode(49,51,39,53,51,34)); assert.equal(paceText(null),'—');
  // 기록에는 좌표가 없다
  const rec=finishTrack(tr,{to:'청계광장',trip:'k'});
  assert(rec && !JSON.stringify(rec).includes('126.9')); assert.equal(rec.stops,1);
  const short=finishTrack(brief); assert(short && short.speed===null);  // 40초 걷기: 기록은 남기되 속도는 모른다
  assert.equal(finishTrack(newTrack('free',t0)),null);
`,context);
vm.runInContext(`(async()=>{})()`,context).then(()=>console.log('PASS: walking budgets, unknown waits/arrival phase, GPS cancellation/coarse fix, endpoint projection, network retry, pace estimation and walk records')).catch(err=>{console.error(err);process.exitCode=1;});
