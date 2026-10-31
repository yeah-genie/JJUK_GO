const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(require.resolve('../api/places.js'),'utf8');
function fixture(key,fetch){let clock=10000;const context={module:{exports:{}},process:{env:{KAKAO_REST_API_KEY:key}},fetch,URL,URLSearchParams,AbortSignal,Map,Date:{now:()=>clock}};vm.createContext(context);vm.runInContext(code,context);return {next(){clock+=600;},async run(q,method='GET'){const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}};await context.module.exports({method,query:{q}},res);return res;}};}
(async()=>{
 let calls=0;
 const photon=fixture('',async url=>{calls++;assert.equal(url.hostname,'photon.komoot.io');assert(!url.searchParams.has('lat'));return {ok:true,json:async()=>({features:[{geometry:{coordinates:[126.97,37.56]},properties:{name:'광화문'}},{geometry:{coordinates:[129,37]},properties:{name:'범위 밖'}},{geometry:{coordinates:['bad',0]},properties:{name:'오류'}}]})};});
 assert.equal((await photon.run('x')).statusCode,400);let r=await photon.run('광화문');assert.equal(r.body.places.length,1);assert.equal(r.body.places[0].name,'광화문');assert.equal((await photon.run('광화문')).statusCode,200);assert.equal(calls,1);assert.equal((await photon.run('다른 장소')).statusCode,429);
 let status=200,bad=false,kcalls=0;
 const kakao=fixture('fixture-key',async(url,options)=>{kcalls++;assert.equal(url.hostname,'dapi.kakao.com');assert.equal(url.searchParams.get('query'),'성신여대');assert.equal(url.searchParams.get('rect'),'126.68,37.39,127.23,37.72');assert(!url.searchParams.has('x'));assert(!url.searchParams.has('y'));assert(!url.href.includes('fixture-key'));assert.equal(options.headers.Authorization,'KakaoAK fixture-key');if(bad)throw new Error('fixture-key');return {ok:status===200,status,json:async()=>({documents:[{place_name:'성신여자대학교',x:'127.02',y:'37.59',road_address_name:'서울 성북구 도로',category_group_name:'학교'},{place_name:'범위 밖',x:'129',y:'37.5'},null,{place_name:'좌표 없음',x:'',y:''}]})};});
 assert.equal((await kakao.run('성신여대','POST')).statusCode,405);
 r=await kakao.run('성신여대');assert.equal(r.body.provider,'kakao');assert.equal(r.body.places.length,1);assert.equal(r.body.places[0].address,'서울 성북구 도로');assert.equal(r.body.places[0].source,'kakao');assert.equal(r.headers['Cache-Control'],'no-store');assert(!JSON.stringify(r.body).includes('fixture-key'));
 assert.equal((await kakao.run('성신여대')).statusCode,429);kakao.next();await kakao.run('성신여대');assert.equal(kcalls,2); // No cached Kakao POIs.
 for(const s of [401,403,429,500]){status=s;kakao.next();r=await kakao.run('성신여대');assert.equal(r.statusCode,503);assert(!JSON.stringify(r.body).includes('fixture-key'));}
 bad=true;kakao.next();r=await kakao.run('성신여대');assert.equal(r.statusCode,503);assert(!JSON.stringify(r.body).includes('fixture-key'));
 console.log('PASS places: Photon fallback, Kakao server authorization, Seoul bounds, malformed rows, no GPS forwarding, no Kakao cache, throttle and safe errors');
})().catch(e=>{console.error(e);process.exitCode=1;});
