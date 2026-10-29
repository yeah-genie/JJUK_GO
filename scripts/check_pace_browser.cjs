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
  if(shots && w===390) await p.screenshot({path:shots+'/pace-home.png'});
  await p.locator('.pace-row').click();
  await p.waitForSelector('#s-me:not([hidden])');
  assert.match(await p.locator('#me-src').innerText(),/보통 속도/);
  await p.locator('[data-free-walk]').click();
  await p.waitForFunction(()=>current==='walk'&&!!walkTrack);
  await p.evaluate(()=>{const m={m:0};__walk([126.97,37.56],m,180,1.1);__walk([126.97,37.56],m,24,0);__walk([126.97,37.56],m,60,1.1);});
  await p.waitForTimeout(1200);
  const live=await p.evaluate(()=>({pace:$('w-pace').textContent,left:$('w-left').textContent,time:$('w-time').textContent,stops:walkTrack.stops,v:trackSpeed(walkTrack)}));
  console.log(w,'free walk live',live);
  assert.equal(await p.evaluate(()=>map.getZoom()),16.5); assert.equal(live.stops,1); assert(Math.abs(live.v-1.1)<0.05);
  if(shots && w===390) await p.screenshot({path:shots+'/pace-free-walk.png'});
  await p.locator('#walk-done').click();
  await p.waitForSelector('#s-me:not([hidden])');
  const me=await p.evaluate(()=>({speed:$('me-speed').textContent,src:$('me-src').textContent,rows:document.querySelectorAll('.wrec').length,ls:JSON.stringify(localStorage)}));
  console.log(w,'me',me.speed,me.src,me.rows);
  assert.equal(me.rows,1); assert(!me.ls.includes('126.9'),'no coords stored');
  assert.match(me.speed,/^(3\.9|4\.0)km\/h$/);
  if(shots && w===390) await p.screenshot({path:shots+'/pace-me.png'});
  // 천천히 선택 → 결과 화면 계산이 바뀐다
  await p.locator('[data-pace="0.9"]').click();
  assert.equal(await p.locator('#me-speed').innerText(),'3.2km/h');
  await p.evaluate(()=>exampleTrip({from:'서대문역',to:'청계광장'}));
  await p.waitForFunction(()=>!!state.sims&&current==='result',{timeout:60000});
  const slow=await p.evaluate(()=>({walk:state.sims.jjuk.walk,len:state.routes.jjuk.length,note:$('result-note').textContent}));
  console.log(w,'slow',slow); assert(Math.abs(slow.walk-slow.len/0.9)<1); assert.match(slow.note,/3\.2km\/h/);
  // 경로 걷기 → 기록 카드
  await p.locator('#start-walk').click();
  await p.waitForFunction(()=>current==='walk'&&!!walkTrack);
  await p.evaluate(()=>{const r=state.routes[state.same?'jjuk':state.focus];
    for(let i=1;i<=60;i++){window.__off+=2000;const ll=pointAt(r,Math.min(r.length,i*2.4));__cb({coords:{longitude:ll[0],latitude:ll[1],accuracy:8},timestamp:Date.now()});}});
  await p.waitForTimeout(800);
  if(shots && w===390) await p.screenshot({path:shots+'/pace-route-walk.png'});
  await p.locator('#walk-done').click();
  await p.waitForSelector('#s-done:not([hidden])');
  const done=await p.evaluate(()=>({t:$('c-time').textContent,tl:$('c-time-l').textContent,w:$('c-wait').textContent,cmp:$('c-compare').textContent,hint:$('done-hint').textContent}));
  console.log(w,'done',done); assert.equal(done.tl,'걸린 시간');
  if(shots && w===390) await p.screenshot({path:shots+'/pace-done.png'});
  // 스크롤바 없음
  const sb=await p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.offsetWidth-e.clientWidth>0 && getComputedStyle(e).overflowY!=='visible').length);
  assert.equal(sb,0,'scrollbars');
  await p.evaluate(()=>go('me')); await p.waitForSelector('#s-me:not([hidden])');
  const ov=await p.evaluate(()=>{const l=document.querySelector('#s-me .list');return [l.scrollWidth<=l.clientWidth, document.querySelectorAll('.wrec').length]});
  console.log(w,'me rows/overflow',ov); assert(ov[0]);
  if(shots && w===360) await p.screenshot({path:shots+'/pace-me-360.png'});
  assert.deepEqual(errs,[]); await c.close();
  }
  console.log('PASS'); await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
