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
vm.runInContext(app, context);
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
  // A short stair route and a longer level route. A one minute budget rejects the detour.
  G.node.clear(); G.adj.clear();
  G.node.set(1,{x:100,y:100,h:10}); G.node.set(2,{x:200,y:100,h:10}); G.node.set(3,{x:150,y:180,h:10});
  const edges=[{a:1,b:2,len:89,cls:3},{a:1,b:3,len:99,cls:2},{a:3,b:2,len:99,cls:2}];
  for(const e of edges) for(const id of [e.a,e.b]) { if(!G.adj.has(id))G.adj.set(id,[]);G.adj.get(id).push(e); }
  state.src=1;state.dst=2;state.from={ll:fromQ(100,100)};state.to={ll:fromQ(200,100)};
  state.routes={short:routeFor('short',0),dep:0,budget:null};state.budget=60;
  refreshSims(); assert.equal(state.same,true);assert.equal(state.routes.jjuk.stairs,1);
  state.budget=120;refreshSims();assert.equal(state.same,false);assert.equal(state.routes.jjuk.stairs,0);
  const baseProfile=readProfile();writeProfile({...baseProfile,avoidSteps:true});
  assert.equal(routeFor('short',0).stairs,0);assert.equal(routeFor('jjuk',0).stairs,0);
  writeProfile(baseProfile);
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
