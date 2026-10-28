// Local server required at :8766. Only synthetic GPS coordinates are used.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width:390, height:844 }, permissions:['geolocation'], geolocation:{longitude:126.96664,latitude:37.5658,accuracy:8} });
    const page = await context.newPage();
    const errors=[];page.on('pageerror', e=>errors.push(e.message));
    await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:8766') + '/#result');
    await page.waitForFunction(()=>!!state.sims,{timeout:60000});
    assert.match(await page.locator('#card-jjuk').innerText(), /검출 계단.*지형 오르막/s);
    assert.match(await page.locator('#go-foot').innerText(), /실시간 아님/);
    for(const budget of [60,180,120]) {
      await page.evaluate(b=>{state.budget=b;refreshSims();},budget);
      assert(await page.evaluate(()=>{
        const j=state.sims.jjuk,s=state.sims.short;
        return j.total+j.unknownN*45<=s.total+s.unknownN*45+state.budget+0.1;
      }));
    }
    const shots=process.env.UI_SHOTS;
    if(shots)fs.mkdirSync(shots,{recursive:true});
    await page.evaluate(()=>{state.deadline=33000;renderResult();setSheet('result','full');});
    await page.waitForFunction(()=>map && map.loaded(),{timeout:60000});
    if(shots) await page.screenshot({path:path.join(shots,'walking-result.png')});
    await page.locator('#start-walk').click();
    await page.waitForFunction(()=>document.getElementById('walk-location').textContent.includes('GPS 연결 ·'));
    assert(await page.evaluate(()=>gpsWatch!=null));
    assert.equal(await page.locator('#mapbox .m-sig.stop, #mapbox .m-sig.go').count(),0);
    const subscription=await page.evaluate(()=>gpsWatch);
    await page.locator('#ctl-loc').click();
    assert.equal(await page.evaluate(()=>gpsWatch),subscription);
    const advanced=await page.evaluate(()=>{const r=state.routes[state.same?'jjuk':state.focus];return pointAt(r,15);});
    await context.setGeolocation({longitude:advanced[0],latitude:advanced[1],accuracy:8});
    await page.waitForFunction(()=>document.getElementById('w-stops').textContent!=='0m');
    assert.match(await page.locator('#next-say').innerText(), /실시간 신호는 제공하지 않아요/);
    await page.waitForFunction(()=>map.loaded(),{timeout:60000});
    if(shots) await page.screenshot({path:path.join(shots,'walking-gps.png')});
    const midpoint=await page.evaluate(()=>{const r=state.routes[state.same?'jjuk':state.focus];return pointAt(r,r.length/2);});
    await context.setGeolocation({longitude:midpoint[0],latitude:midpoint[1],accuracy:8});
    await page.waitForFunction(()=>document.getElementById('walk-location').textContent.includes('갑자기'));
    await context.setGeolocation({longitude:127.1,latitude:37.6,accuracy:8});
    await page.waitForFunction(()=>document.getElementById('walk-location').textContent.includes('떨어져'));
    assert.equal(await page.locator('#w-left').innerText(),'—');
    await page.getByRole('button',{name:'그만 걷기',exact:true}).click();
    await page.waitForFunction(()=>gpsWatch===null);
    await page.evaluate(()=>go('home'));
    await page.waitForSelector('[data-locate]');
    await context.setGeolocation({longitude:126.97799,latitude:37.56562,accuracy:8});
    await page.locator('[data-locate]').click();
    await page.waitForFunction(()=>state.from.me===true&&state.from.sub==='GPS');
    await page.waitForFunction(()=>map.loaded(),{timeout:60000});
    assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('126.97799')),false);
    if(shots)await page.screenshot({path:path.join(shots,'walking-home.png')});
    await context.clearPermissions();
    await page.locator('[data-locate]').click();
    await page.waitForFunction(()=>document.getElementById('location-status').textContent.includes('권한'));
    for(const width of [320,390,768]) {
      await page.setViewportSize({width,height:844});
      await page.evaluate(()=>go('result'));
      await page.waitForFunction(()=>!!state.sims);
      assert(await page.evaluate(()=>document.getElementById('sheet-result').scrollWidth<=document.getElementById('phone').clientWidth));
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: real Seoul graph/terrain, budgets, synthetic GPS progress, off-route, permission denial, cleanup, no GPS persistence, responsive views');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
