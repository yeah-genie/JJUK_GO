// Local server required at :8766. Synthetic GPS only (fake geolocation + shifted clock). Usage: node scripts/check_pace_browser.cjs [screenshot dir]
const { chromium } = require('playwright');
const assert=require('node:assert/strict');
const shots=process.argv[2];
(async()=>{
  const b=await chromium.launch();
  for (const [w,h] of [[390,844],[360,640]]) {
  const c=await b.newContext({viewport:{width:w,height:h}});const p=await c.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  // 가짜 GPS: 시계를 앞당기며 위치를 직접 넣는다(실제 위치 아님)
  await p.addInitScript(()=>{
    window.__off=0; const real=Date.now.bind(Date); Date.now=()=>real()+window.__off;
    Object.defineProperty(window,'isSecureContext',{value:true});
    window.__cb=null;
    Object.defineProperty(navigator,'geolocation',{value:{watchPosition(ok){window.__cb=ok;return 1;},clearWatch(){window.__cb=null;},getCurrentPosition(ok){}}});
    window.__walk=(route,meters,secs,v)=>{ // route: [lon,lat] start, east along
      const kx=111320*Math.cos(route[1]*Math.PI/180);
      for(let s=0;s<secs;s+=2){window.__off+=2000;meters.m+=v*2;
        window.__cb&&window.__cb({coords:{longitude:route[0]+meters.m/kx,latitude:route[1]+((s/2)%2?3:-3)/110540,accuracy:8},timestamp:Date.now()});}
    };
  });
  await p.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:8766') + '/#home');
  await p.waitForSelector('#home-pace',{state:'visible',timeout:60000});
  assert.equal(await p.locator('#home-pace').innerText(),'4.3km/h');
  // 버튼 줄이 화면 안에 있다(Sally 발견 1), 내 걸음 줄 문구(발견 4)
  await p.waitForTimeout(600);
  const homeBtn=await p.evaluate(()=>[...document.querySelectorAll('#home-actions .btn')].map(b=>Math.round(b.getBoundingClientRect().bottom)));
  console.log(w,'home buttons bottom',homeBtn); assert(homeBtn.length===2&&homeBtn.every(v=>v<=h),'home buttons inside viewport');
  assert.equal(await p.locator('#home-pace-sub').innerText(),'기록 없음 · 보통 속도');
  if(shots && w===390) await p.screenshot({path:shots+'/pace-home.png'});
  await p.locator('.pace-row').click();
  await p.waitForSelector('#s-me:not([hidden])');
  assert.match(await p.locator('#me-src').innerText(),/보통 속도/);
  assert.equal(await p.locator('#pace-chips').getAttribute('role'),'group'); assert.equal(await p.locator('#pace-chips').getAttribute('aria-label'),'길찾기에 쓸 속도');
  await p.locator('[data-free-walk]').click();
  await p.waitForFunction(()=>current==='walk'&&!!walkTrack);
  // 걷기 화면: 버튼 줄이 화면 안에, 시연 칩은 ?demo=1 이 없으면 보이지 않는다(발견 1·6)
  const wb=await p.evaluate(()=>({done:Math.round($('walk-done').getBoundingClientRect().bottom),demo:$('walk-demo').getBoundingClientRect().width}));
  console.log(w,'walk button bottom',wb); assert(wb.done<=h,'walk-done inside viewport'); assert.equal(wb.demo,0,'demo chip hidden without ?demo=1');
  await p.evaluate(()=>{const m={m:0};__walk([126.97,37.56],m,180,1.1);__walk([126.97,37.56],m,24,0);__walk([126.97,37.56],m,60,1.1);});
  await p.waitForTimeout(1200);
  const live=await p.evaluate(()=>({pace:$('w-pace').textContent,top:$('next-dist').textContent,leftCol:getComputedStyle($('w-left-col')).display,left:$('w-left').textContent,time:$('w-time').textContent,stops:walkTrack.stops,v:trackSpeed(walkTrack)}));
  console.log(w,'free walk live',live);
  assert.match(live.time,/^\d+분 \d\d초$/); assert.match(live.pace,/km\/h$/);
  assert.equal(await p.evaluate(()=>map.getZoom()),16.5); assert.equal(live.stops,1); assert(Math.abs(live.v-1.1)<0.05);
  if(shots && w===390) await p.screenshot({path:shots+'/pace-free-walk.png'});
  await p.locator('#walk-done').click();
  await p.waitForSelector('#s-me:not([hidden])');
  const me=await p.evaluate(()=>({speed:$('me-speed').textContent,src:$('me-src').textContent,rows:document.querySelectorAll('.wrec').length,ls:JSON.stringify(localStorage)}));
  console.log(w,'me',me.speed,me.src,me.rows);
  assert.equal(me.rows,1); assert(!me.ls.includes('126.9'),'no coords stored');
  assert.equal(live.leftCol,'none','그냥 걷기: 위쪽 카드와 같은 거리를 아래에 또 보이지 않는다');
  assert.match(me.speed,/^(3\.9|4\.0)km\/h$/);
  if(shots && w===390) await p.screenshot({path:shots+'/pace-me.png'});
  // 천천히 선택 → 결과 화면 계산이 바뀐다
  await p.locator('[data-pace="0.9"]').click();
  assert.equal(await p.locator('#me-speed').innerText(),'3.2km/h');
  assert.equal(await p.evaluate(()=>document.activeElement?.dataset?.pace),'0.9','칩을 눌러도 포커스가 유지된다');
  await p.evaluate(()=>exampleTrip({from:'서대문역',to:'청계광장'}));
  await p.waitForFunction(()=>!!state.sims&&current==='result',{timeout:60000});
  const slow=await p.evaluate(()=>({walk:state.sims.jjuk.walk,len:state.routes.jjuk.length,note:$('result-note').textContent}));
  console.log(w,'slow',slow); assert(Math.abs(slow.walk-slow.len/0.9)<1); assert.match(slow.note,/3\.2km\/h/);
  // 경로 걷기 → 기록 카드
  await p.locator('#start-walk').click();
  await p.waitForFunction(()=>current==='walk'&&!!walkTrack);
  // 위치를 다시 연결해도 같은 걷기를 이어간다: 기록은 1건(Winston 결함 1)
  const fixes=(from,to)=>p.evaluate(([from,to])=>{const r=state.routes[state.same?'jjuk':state.focus];
    for(let i=from;i<=to;i++){window.__off+=2000;const ll=pointAt(r,Math.min(r.length,i*2.4));__cb({coords:{longitude:ll[0],latitude:ll[1],accuracy:8},timestamp:Date.now()});}},[from,to]);
  await fixes(1,30);
  await p.evaluate(()=>{window.__t=walkTrack;});
  await p.locator('[data-gps-retry]').click();
  const kept=await p.evaluate(()=>({same:walkTrack===window.__t,saved:JSON.parse(localStorage.getItem('jjukgo:walks')||'[]').length}));
  assert.equal(kept.same,true,'재연결은 같은 걷기'); assert.equal(kept.saved,1,'재연결로 기록이 늘지 않는다(그냥 걷기 1건만)');
  await fixes(31,60);
  await p.waitForTimeout(800);
  // 신호 안내는 처음 5초만 눈에 띄고 이후 회색 한 줄로 줄어든다(Sally 발견 6)
  assert.match(await p.locator('#next-say').innerText(),/실시간 신호는 제공하지 않아요/);
  await p.waitForTimeout(5300);
  assert.equal(await p.locator('#next-say').innerText(),'실시간 신호 정보 없음'); assert(await p.evaluate(()=>$('next-say').classList.contains('soft')));
  if(shots && w===390) await p.screenshot({path:shots+'/pace-route-walk.png'});
  await p.locator('#walk-done').click();
  await p.waitForSelector('#s-done:not([hidden])');
  const done=await p.evaluate(()=>({t:$('c-time').textContent,tl:$('c-time-l').textContent,w:$('c-wait').textContent,cmp:$('c-compare').textContent,hint:$('done-hint').textContent}));
  console.log(w,'done',done); assert.equal(done.tl,'걸린 시간');
  // 경로의 90% 미만만 걸었으니 도착처럼 읽히지 않는다(Sally 발견 3, Winston 결함 8)
  const card=await p.evaluate(()=>({kind:$('card-kind').textContent,recs:JSON.parse(localStorage.getItem('jjukgo:walks')),btn:Math.round($('s-done').querySelector('.btn').getBoundingClientRect().bottom)}));
  console.log(w,'card',card.kind);
  assert.match(card.kind,/^걷기 · 서대문역에서 \d+m$/); assert.doesNotMatch(done.cmp+done.hint+card.kind,/도착/); assert.match(done.cmp,/\(\d+m 구간\)/); assert.match(done.hint,/도중에/);
  assert.equal(card.recs.length,2,'걷기 두 번 = 기록 두 건(재연결이 쪼개지 않았다)');
  assert.equal(card.recs[0].to,null); assert.equal(card.recs[0].arrived,false); assert(card.recs[0].elapsedS>=115&&card.recs[0].elapsedS<=150,'elapsed '+card.recs[0].elapsedS);
  assert(card.btn<=h,'done button inside viewport');
  if(shots && w===390) await p.screenshot({path:shots+'/pace-done.png'});
  // 스크롤바 없음
  const sb=await p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.offsetWidth-e.clientWidth>0 && getComputedStyle(e).overflowY!=='visible').length);
  assert.equal(sb,0,'scrollbars');
  await p.evaluate(()=>go('me')); await p.waitForSelector('#s-me:not([hidden])');
  const ov=await p.evaluate(()=>{const l=document.querySelector('#s-me .list');return [l.scrollWidth<=l.clientWidth, document.querySelectorAll('.wrec').length]});
  console.log(w,'me rows/overflow',ov); assert(ov[0]);
  assert((await p.locator('#walk-list').innerText()).includes('도중에 끝냄'));
  assert.equal(await p.locator('#home-pace-sub').count(),1);
  // 기록 지우기: 한 번 더 눌러야 지워지고, 지운 뒤 포커스는 '그냥 걷기 시작'에
  await p.locator('#walks-clear').click();
  assert.equal(await p.locator('.wrec').count(),2,'첫 번째 누름은 확인만'); assert.match(await p.locator('#walks-clear').innerText(),/한 번 더/);
  await p.locator('#walks-clear').click();
  assert.equal(await p.locator('.wrec').count(),0);
  assert.equal(await p.evaluate(()=>document.activeElement?.hasAttribute('data-free-walk')),true,'지운 뒤 포커스 유지');
  // 걷는 도중 페이지가 사라지면(pagehide) 지금까지를 저장한다. 임시 저장소·좌표는 쓰지 않는다(Winston 결함 5)
  await p.locator('[data-free-walk]').click(); await p.waitForFunction(()=>current==='walk'&&!!walkTrack);
  await p.evaluate(()=>{const m={m:0};__walk([126.97,37.56],m,100,1.2);});
  await p.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  const ph=await p.evaluate(()=>({walks:JSON.parse(localStorage.getItem('jjukgo:walks')||'[]').length,session:sessionStorage.length,keys:Object.keys(localStorage).sort().join(),ls:JSON.stringify(localStorage),active:!!walkTrack}));
  assert.equal(ph.walks,1,'pagehide saved the walk so far'); assert.equal(ph.session,0); assert.equal(ph.active,false); assert(!ph.ls.includes('126.9')&&!ph.ls.includes('37.5'),'no coords');
  assert(!/draft/.test(ph.keys),'no draft key: '+ph.keys);
  if(shots && w===360) await p.screenshot({path:shots+'/pace-me-360.png'});
  assert.deepEqual(errs,[]); await c.close();
  }
  // ?demo=1 이면 움직임 시연 칩이 보인다
  { const c=await b.newContext({viewport:{width:390,height:844}});const p=await c.newPage();
    await p.addInitScript(()=>{Object.defineProperty(window,'isSecureContext',{value:true});Object.defineProperty(navigator,'geolocation',{value:{watchPosition(){return 1;},clearWatch(){},getCurrentPosition(){}}});});
    await p.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:8766') + '/?demo=1#home');
    await p.waitForSelector('#home-pace',{state:'visible',timeout:60000});
    await p.evaluate(()=>{state.freeWalk=true;go('walk');}); await p.waitForFunction(()=>current==='walk');
    assert((await p.locator('#walk-demo').boundingBox())?.width>0,'?demo=1 shows the demo chip'); await c.close(); }
  console.log('PASS'); await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
