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
  addEventListener(type, fn) { listeners[type] = fn; }, clearInterval() {},
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

// ---------- 팀 보고서 회귀 시험 (Winston 결함 1~5·7·8, Sally 발견 2·3·4·6). 결함별로 따로 실행해 어디가 깨졌는지 보인다 ----------
const section = (name, code) => { try { vm.runInContext(`(()=>{${code}})()`, context); } catch (err) { console.error('FAIL ' + name + ': ' + err.message); process.exitCode = 1; } };
const HEAD = `
  const ls = localStorage; ls.data.clear(); ls.fail = false;
  const kx = 111320 * Math.cos(37.56 * Math.PI / 180), t0 = 1700000000000;
  const at = (m, s) => ({ ll: [126.97 + m / kx, 37.56], accuracy: 8, timestamp: t0 + s * 1000 });
  const stride = (tr, from, secs, m0, v = 1.25) => { let m = m0; for (let i = 2; i <= secs; i += 2) { m += v * 2; trackAdd(tr, at(m, from + i)); } return m; };
  const nop = () => {};
`;
section('W1 재연결은 같은 걷기를 이어간다(기록 1건)', HEAD + `
  const tr = newTrack('route', t0);
  let m = stride(tr, 0, 100, 0);
  resumeTrack(tr);                                    // 위치 다시 연결: 마감하지 않는다
  assert.equal(JSON.parse(ls.getItem('jjukgo:walks') || '[]').length, 0, '재연결에서 기록이 만들어지면 안 된다');
  m = stride(tr, 102, 100, m);                        // 재연결 뒤 이어서 100초
  const rec = finishTrack(tr, { to: '청계광장', routeLength: 200 }, t0 + 202000);
  assert.equal(JSON.parse(ls.getItem('jjukgo:walks')).length, 1);
  assert(rec.meters > 200 && rec.meters < 280, 'meters ' + rec.meters);
  assert(rec.elapsedS >= 198 && rec.elapsedS <= 202, 'elapsed ' + rec.elapsedS);
`);
section('W2 걸린 시간: 화면과 기록이 같은 시계·같은 구간', HEAD + `
  // 첫 위치가 60초 늦게 와도 걸린 시간은 첫 위치부터
  let tr = newTrack('route', t0); stride(tr, 58, 102, 0);                 // 위치가 60초에 처음 온다
  assert.equal(finishTrack(tr, {}, t0 + 160000).elapsedS, 100);
  // 마지막 위치 뒤 40초 동안 위치가 없어도 끝낸 시각까지: 화면에 보이던 시간과 같다
  ls.data.clear(); tr = newTrack('route', t0); stride(tr, 0, 100, 0);
  const shown = trackElapsedS(tr, t0 + 140000);
  assert.equal(finishTrack(tr, {}, t0 + 140000).elapsedS, Math.round(shown));
  assert.equal(trackElapsedS(newTrack('free', t0), t0 + 5000), 0, '위치 전에는 0');
`);
section('W3 저장값이 깨져도 예외 없이 동작', HEAD + `
  for (const bad of ['{"a":1}', '5', '"abc"', '[null]', '[1,"x",{"meters":"a"}]']) {
    ls.data.clear(); ls.setItem('jjukgo:walks', bad);
    const tr = newTrack('free', t0); stride(tr, 0, 100, 0);
    assert.doesNotThrow(() => finishTrack(tr, {}, t0 + 100000), 'walks=' + bad);
    assert.doesNotThrow(() => renderMe(), 'renderMe walks=' + bad);
    assert.equal(loadWalks().length, 1, 'walks=' + bad);
  }
  ls.data.clear(); ls.setItem('jjukgo:walks', '[null]'); assert.deepEqual(loadWalks(), []);
  for (const bad of ['"abc"', '100', '-1', 'null', '0', '{"x":1}']) {
    ls.data.clear(); ls.setItem('jjukgo:pace', '{"mode":"auto","speed":' + bad + ',"moveS":"x","walks":null}');
    const pp = paceProfile();
    assert.equal(pp.speed, null, 'speed ' + bad); assert.equal(pp.walks, 0); assert.equal(pp.moveS, 0);
    assert.equal(walkSpeed(pp), PACE.DEFAULT, 'speed ' + bad);
  }
  assert.equal(walkSpeed({ mode: 'auto', speed: 100 }), PACE.MAX);          // 자동 모드도 범위 안으로
  assert.equal(walkSpeed({ mode: 'auto', speed: -1 }), PACE.MIN);
  assert.equal(walkSpeed({ mode: 'auto', speed: NaN }), PACE.DEFAULT);
  assert.equal(walkSpeed({ mode: 'abc' }), PACE.DEFAULT);
  ls.data.clear(); ls.setItem('jjukgo:pace', '5'); assert.equal(paceProfile().mode, 'auto');
  ls.data.clear(); ls.setItem('jjukgo:pace', '{"mode":99}'); assert.equal(paceProfile().mode, 'auto');
  // finishTrack가 던져도 끝내기는 화면을 막지 않고 GPS를 정리한다
  const original = finishTrack; let cleared = null;
  navigator.geolocation = { clearWatch(id) { cleared = id; } };
  gpsWatch = 9; walkTrack = newTrack('free', t0);
  finishTrack = () => { throw new Error('boom'); };
  const quiet = console.error; console.error = nop;   // 던져진 예외의 로그는 이 시험에서 일부러 가린다
  try { assert.doesNotThrow(() => endWalk()); } finally { finishTrack = original; console.error = quiet; }
  assert.equal(cleared, 9); assert.equal(gpsWatch, null); assert.equal(walkTrack, null);
`);
section('W4 저장 실패를 숨기지 않는다', HEAD + `
  ls.fail = true;
  const tr = newTrack('route', t0); stride(tr, 0, 100, 0);
  const rec = finishTrack(tr, { to: 'A', routeLength: 150 }, t0 + 100000);
  assert.equal(rec.unsaved, true);
  state.lastWalk = rec; state.saveFailed = true; renderMe();
  assert($('me-save').textContent.includes('이 기기에 저장하지 못했어요'));
  assert(!$('me-save').textContent.includes('이 기기에만 저장해요'));
  const copy = arrivalCopy(rec, { estimateS: 1500, fromName: 'A', toName: 'B' });
  assert(copy.hint.includes('이 기기에 저장하지 못했어요'));
  ls.fail = false; state.saveFailed = false;
  const tr2 = newTrack('route', t0); stride(tr2, 0, 100, 0);
  const ok = finishTrack(tr2, { to: 'A', routeLength: 150 }, t0 + 100000);
  assert.equal(!!ok.unsaved, false);
  renderMe(); assert($('me-save').textContent.includes('이 기기에만 저장해요'));
`);
section('W5 pagehide에서 지금까지를 저장한다(좌표 없이)', HEAD + `
  assert.equal(typeof __listeners.pagehide, 'function');
  navigator.geolocation = { clearWatch() {} };
  walkTrack = newTrack('free', t0); stride(walkTrack, 0, 100, 0);
  __listeners.pagehide();
  assert.equal(walkTrack, null);
  const saved = ls.getItem('jjukgo:walks');
  assert.equal(JSON.parse(saved).length, 1); assert(!saved.includes('126.9')); assert(!saved.includes('37.5'));
  assert.deepEqual([...ls.data.keys()].sort(), ['jjukgo:pace', 'jjukgo:walks'].filter(k => ls.data.has(k)).sort(), '다른 임시 저장 키가 없다');
`);
section('W7 접근성: 같은 값은 다시 쓰지 않고, 기록 지우기는 두 번 눌러야 지운다', HEAD + `
  const spy = $('spy-live'); let writes = 0, cur = '';
  Object.defineProperty(spy, 'textContent', { get() { return cur; }, set(v) { writes++; cur = v; } });
  setText('spy-live', '270m'); setText('spy-live', '270m'); setText('spy-live', '270m'); setText('spy-live', '280m');
  assert.equal(writes, 2);
  ls.setItem('jjukgo:walks', JSON.stringify([{ at: new Date(t0).toISOString(), kind: 'free', to: null, elapsedS: 100, moveS: 90, meters: 120, speed: null, stops: 0 }]));
  assert.equal(requestClearWalks(t0), 'armed'); assert.equal(loadWalks().length, 1);
  assert.equal(requestClearWalks(t0 + 6000), 'armed', '5초 넘으면 다시 확인');
  assert.equal(requestClearWalks(t0 + 7000), 'cleared'); assert.equal(loadWalks().length, 0);
`);
section('W8 도중에 끝낸 걷기와 개수 표시', HEAD + `
  let tr = newTrack('route', t0); stride(tr, 0, 100, 0);               // 약 125m
  let rec = finishTrack(tr, { to: '청계광장', trip: 'k', routeLength: 1300 }, t0 + 100000);
  assert.equal(rec.arrived, false); assert.equal(rec.to, null, '90% 미만이면 도착지 이름을 붙이지 않는다');
  ls.data.clear(); tr = newTrack('route', t0); stride(tr, 0, 100, 0);
  rec = finishTrack(tr, { to: '청계광장', trip: 'k', routeLength: 130 }, t0 + 100000);
  assert.equal(rec.arrived, true); assert.equal(rec.to, '청계광장');
  ls.data.clear(); tr = newTrack('free', t0); stride(tr, 0, 100, 0);
  rec = finishTrack(tr, {}, t0 + 100000); assert.equal(rec.arrived, null); assert.equal(rec.to, null);
  // 35번 걸어도 목록은 30건: 화면은 목록 기준으로 센다
  ls.data.clear(); ls.setItem('jjukgo:pace', JSON.stringify({ mode: 'auto', speed: 1.2, moveS: 9000, walks: 35 }));
  ls.setItem('jjukgo:walks', JSON.stringify(Array.from({ length: 30 }, () => ({ at: new Date(t0).toISOString(), kind: 'free', to: null, elapsedS: 100, moveS: 90, meters: 120, speed: 1.2, stops: 0 }))));
  renderMe(); assert(!$('me-src').textContent.includes('35'), $('me-src').textContent); assert($('me-src').textContent.includes('30'));
  assert(!homePaceSub(paceProfile(), loadWalks().length).includes('35'));
  // 프리셋에 없는 모드는 'undefined'가 아니라 직접 설정
  for (const mode of [1.0, 0.7, 1.9]) assert(!homePaceSub({ mode, speed: null, moveS: 0, walks: 0 }, 0).includes('undefined'));
  assert(homePaceSub({ mode: 1.0, speed: null }, 0).includes('직접'));
  assert(homePaceSub({ mode: 0.9, speed: null }, 0).includes('천천히'));
  assert(!/(천천히|빠르게|보통)으로/.test(homePaceSub({ mode: 0.9, speed: null }, 0)));
`);
section('S2 결과 화면 문구와 위계', `
  assert.equal(comfortCopy({}, {}, 'jjuk', true, 120).title, '같은 길이에요');
  assert.equal(comfortCopy({}, {}, 'jjuk', true, 120).copy, '2분 더 걸어도 덜 힘든 길이 없어요.');
  const note = resultNote({ example: true, base: 31200, speed: 1.0833, unknownN: 5 });
  assert.equal(note, '08:40 예시 · 3.9km/h · 신호 45초/곳 가정');
  assert(!note.includes('신호45초') && !note.includes('이력 추정'));
  assert.equal(resultNote({ example: false, base: 31200, speed: 1.2, unknownN: 0 }), '08:40 출발 기준 · 4.3km/h');
`);
section('S3 시간·속도 표기와 도중에 끝낸 도착 카드', `
  const cases = [[0, '0초'], [59, '59초'], [61, '1분 01초'], [121, '2분 01초'], [1572, '26분 12초'], [3600, '1시간 00분'], [3900, '1시간 05분']];
  for (const [s, want] of cases) { assert.equal(dur(s), want); assert.equal(durHTML(s).replace(/<[^>]+>/g, ''), want); }
  assert(!/\\d:\\d\\d/.test(dur(121)));
  const partial = { kind: 'route', arrived: false, to: null, meters: 120, elapsedS: 121, speed: 1.1, stops: 0 };
  const c = arrivalCopy(partial, { estimateS: 1560, fromName: '서대문역', toName: '청계광장' });
  assert.equal(c.kind, '걷기 · 서대문역에서 120m');
  assert.equal(c.compare, '예상 26분 00초 · 실제 2분 01초(120m 구간)');
  assert(!/도착/.test(c.kind + c.compare + c.hint), '도착처럼 읽히면 안 된다');
  assert(c.hint.includes('도중에'));
  const full = arrivalCopy({ ...partial, arrived: true, to: '청계광장', meters: 1300 }, { estimateS: 1560, fromName: '서대문역', toName: '청계광장' });
  assert.equal(full.kind, '걷기 · 서대문역 → 청계광장');
  assert(full.compare.startsWith('예상 26분 00초 · 실제 2분 01초'));
  assert.equal(speedText(1.0833), '3.9km/h'); assert.equal(speedText(null), '—');
`);
section('S4 홈 내 걸음 줄 문구', `
  assert.equal(homePaceSub({ mode: 'auto', speed: null }, 0), '기록 없음 · 보통 속도');
  assert.equal(homePaceSub({ mode: 'auto', speed: 1.1 }, 3), '기록 3번 · 내 속도');
`);
section('S6b 이름 없는 안내는 만들지 않는다', `
  const noName = { coords: [[126.97, 37.56], [126.972, 37.56]], cum: [0, 176], length: 176, x: [{ d: 80 }], guides: [] };
  assert.equal(routeGuidance(noName, 10), null);
`);
section('S6 시연 칩은 ?demo=1 에서만', `
  assert.equal(DEMO_MODE, false);
  assert.equal(parseDemoFlag('?demo=1'), true); assert.equal(parseDemoFlag(''), false); assert.equal(parseDemoFlag('?demo=0'), false);
`);
vm.runInContext(`(async()=>{})()`,context).then(()=>{ if(!process.exitCode) console.log('PASS: walking budgets, unknown waits/arrival phase, GPS cancellation/coarse fix, endpoint projection, network retry, pace estimation and walk records, plus team-report regressions (reconnect, one clock, corrupt storage, save failure, pagehide, a11y, partial walks, result copy)'); }).catch(err=>{console.error(err);process.exitCode=1;});
