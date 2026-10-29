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
})()`,context).then(()=>console.log('PASS: walking budgets, unknown waits/arrival phase, GPS cancellation/coarse fix, endpoint projection, network retry')).catch(err=>{console.error(err);process.exitCode=1;});
