// Contract checks for provider sizing/fallback and historical/live evidence separation.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path'),root=path.resolve(__dirname,'..');

async function main(){
 const handler=require('../api/map-config.js');
 const previous=process.env.NAVER_MAP_CLIENT_ID;
 for(const [input,expected] of [['',''],['public-test','public-test'],['  public-test  ','public-test'],['<invalid>','']]){
  process.env.NAVER_MAP_CLIENT_ID=input;
  let payload;handler({}, {setHeader(){},end(s){payload=JSON.parse(s);}});
  assert.deepEqual(payload,{naverClientId:expected});
 }
 if(previous===undefined)delete process.env.NAVER_MAP_CLIENT_ID;else process.env.NAVER_MAP_CLIENT_ID=previous;

 let appended,observer,created,markers=[],tileReady,idle;
 const window={},document={createElement:()=>({remove(){}}),head:{append(s){appended=s;}}};
 class Size{constructor(width,height){Object.assign(this,{width,height});}}
 class Marker{constructor(o){this.options=o;markers.push(this);}setMap(){}setPosition(p){this.position=p;}setIcon(o){this.options.icon=o;}}
 class Map{constructor(_,o){created=this;this.options=o;this.updates=[];}fitBounds(){}getCenter(){return{lng:()=>127.0163,lat:()=>37.5927};}setSize(s){this.updates.push(s);}setCenter(){}setZoom(){}destroy(){this.destroyed=true;}}
 class ResizeObserver{constructor(fn){this.fn=fn;observer=this;}observe(){}disconnect(){this.disconnected=true;}}
 const context={window,document,URLSearchParams,setTimeout,clearTimeout,ResizeObserver};
 vm.runInNewContext(fs.readFileSync(path.join(root,'docs/prototype/reference-ui/naver-map.js'),'utf8'),context);
 await assert.rejects(window.JJUKGO_NAVER.load(''));
 const pending=window.JJUKGO_NAVER.load('public-test');
 assert.match(appended.src,/ncpKeyId=public-test/);
 assert.doesNotMatch(appended.src,/ncpClientId|Secret/);
 window.naver={maps:{Map,Marker,Size,LatLng:class{constructor(lat,lng){Object.assign(this,{lat,lng});}},Point:class{},Polyline:class{setMap(){}},Event:{once(_,event,fn){tileReady=fn;return{};},addListener(_,event,fn){if(event==='idle')idle=fn;return{};},removeListener(){}}}};
 window[new URL(appended.src).searchParams.get('callback')]();await pending;
 let height=558;
 const host={getBoundingClientRect:()=>({width:390,height})};
 const container={nodeType:1,parentElement:host,clientWidth:390,clientHeight:0};
 let viewport;
 const view=window.JJUKGO_NAVER.render(container,{coords:[[127,37.5],[127.01,37.51]],next:{key:'next',ll:[127,37.5],state:'walk',trusted:false,distanceM:74,remainingSeconds:17,label:'<unsafe>'},endpointHTML:{from:'origin-icon',to:'destination-icon'},onViewportChange:ll=>viewport=ll});
 assert.equal(created.options.size.height,558);
 assert.match(markers[0].options.icon.content,/signal-disc gray/);
 assert.match(markers[0].options.icon.content,/&lt;unsafe&gt;/);
 assert.doesNotMatch(markers[0].options.icon.content,/횡단 가능/);
 assert.equal(markers[1].options.icon.content,'origin-icon');assert.equal(markers[2].options.icon.content,'destination-icon');
 idle();assert.equal(viewport.join(','),'127.0163,37.5927');
 view.updateSignals([{key:'new-area',ll:[127.0163,37.5927],state:'unknown',label:'New area'}]);
 assert.match(markers.at(-1).options.icon.content,/New area/);
 tileReady();assert.equal(await view.ready,true);
 observer.fn();assert.equal(created.updates.length,0);
 height=500;observer.fn();assert.equal(created.updates.at(-1).height,500);
 view.destroy();assert.equal(created.destroyed,true);assert.equal(observer.disconnected,true);
 height=0;assert.throws(()=>window.JJUKGO_NAVER.render(container),/지도 영역/);

 const dataWindow={fetch:async()=>{throw Error('No network permitted');}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'docs/prototype/reference-ui/data-status.js'),'utf8'),{window:dataWindow,document:{baseURI:'http://localhost/reference-ui/'},URL,AbortSignal});
 const urls=[];
 const data=await dataWindow.JJUKGODataStatus.read(async u=>{urls.push(u);return{ok:true,json:async()=>u.includes('config=1')?{enabled:false,crosswalks:[]}:{source_dates:['20261014','20261027'],signal_count:1732}};});
 assert.equal(data.historical.lastDate,'20261027');assert.equal(data.historical.candidateIntersections,1732);
 assert.equal(data.live.status,'disabled');assert.equal(data.live.eligible,false);
 assert.equal(urls.length,2);assert.ok(urls.every(u=>!u.includes('ids=')));
 const ew={};vm.runInNewContext(fs.readFileSync(path.join(root,'docs/prototype/reference-ui/signal-evidence.js'),'utf8'),{window:ew});
 let score=1,phase={walk:true,rem:17},plans=true;
 const evidence=ew.JJUKGO_SIGNAL_EVIDENCE.create({now:()=>21600,speed:()=>1,meta:()=>({name:'검증 지점'}),direction:x=>x,period:()=>'10/14–10/27 신호 이력',plan:()=>plans?{score}:null,confidence:r=>r.score,predict:()=>phase,verdict:()=>({kind:'go'})});
 const crossing={s:1,dir:'n',len:12,at:[127,37.5]};
 assert.equal(evidence(crossing).remainingSeconds,17);assert.equal(evidence(crossing).trusted,true);
 score=0;assert.equal(evidence(crossing).remainingSeconds,null);assert.equal(evidence(crossing).state,'unknown');
 score=1;phase={walk:false,wait:24};assert.match(evidence(crossing).secondsLabel,/24초/);
 plans=false;assert.equal(evidence(crossing).trusted,false);
 assert.match(evidence({...crossing,dir:null}).reason,/방향 미연결/);
 const positionOnly=evidence({...crossing,dir:null,nearby:true,locationOnly:true});
 assert.equal(positionOnly.statusLabel,'시간 정보 없음');assert.equal(positionOnly.remainingSeconds,null);
 assert.doesNotMatch(positionOnly.sourceLabel,/10\/14/);
 const ui=fs.readFileSync(path.join(root,'docs/prototype/reference-ui/ui.js'),'utf8');
 const collect=ui.match(/function refMakeSignals[\s\S]*?\r?\n}\r?\n/)[0];
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'docs/prototype/seoul/signals.json'),'utf8'));
 const sigmeta=new global.Map(metadata.map(([id,x,y,name])=>[id,{name,ll:[126.58+x/1e5,37.35+y/1e5]}]));
 const collector={SIGMETA:sigmeta,SIG:{now:()=>68400},signalPlan:()=>null,trustedPlan:()=>null,refSignalModel:x=>x,distLL:(a,b)=>Math.hypot((a[0]-b[0])*88000,(a[1]-b[1])*110540)};
 vm.createContext(collector);vm.runInContext(collect,collector);
 const positions=collector.refMakeSignals({coords:[[127.0163,37.5927]],x:[]});
 assert.ok(positions.some(x=>String(x.s)==='2705'&&x.locationOnly));
 assert.ok(positions.length<=24);assert.ok(positions.every(x=>!x.dir));
 const moved=collector.refMakeSignals({coords:[[126.977,37.566]],x:[]},[127.0163,37.5927]);
 assert.ok(moved.some(x=>String(x.s)==='2705'));
 console.log('PASS reference UI: configuration, SDK, sizing, cleanup, route ends, viewport signals, Sungshin location without timing, historical/live separation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
