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

 let appended,observer,created,markers=[],tileReady,idle,popup,closeButton={},closeCalls=0;
 const window={},document={createElement:()=>({remove(){}}),head:{append(s){appended=s;}}};
 class Size{constructor(width,height){Object.assign(this,{width,height});}}
 class Marker{constructor(o){this.options=o;markers.push(this);}setMap(){}setPosition(p){this.position=p;}setIcon(o){this.options.icon=o;}}
 class Map{constructor(_,o){created=this;this.options=o;this.updates=[];}fitBounds(){}getCenter(){return{lng:()=>127.0163,lat:()=>37.5927};}setSize(s){this.updates.push(s);}setCenter(){}setZoom(){}destroy(){this.destroyed=true;}}
 class ResizeObserver{constructor(fn){this.fn=fn;observer=this;}observe(){}disconnect(){this.disconnected=true;}}
 class InfoWindow{constructor(){popup=this;}setContent(){}open(){this.opened=true;}close(){this.opened=false;}getContentElement(){return{querySelector:s=>s.includes('close-signal')?closeButton:null};}}
 const context={window,document,URLSearchParams,setTimeout,clearTimeout,ResizeObserver};
 vm.runInNewContext(fs.readFileSync(path.join(root,'docs/prototype/reference-ui/naver-map.js'),'utf8'),context);
 await assert.rejects(window.JJUKGO_NAVER.load(''));
 const pending=window.JJUKGO_NAVER.load('public-test');
 assert.match(appended.src,/ncpKeyId=public-test/);
 assert.doesNotMatch(appended.src,/ncpClientId|Secret/);
 window.naver={maps:{Map,Marker,Size,InfoWindow,LatLng:class{constructor(lat,lng){Object.assign(this,{lat,lng});}},Point:class{},Polyline:class{setMap(){}},Event:{once(_,event,fn){tileReady=fn;return{};},addListener(_,event,fn){if(event==='idle')idle=fn;return{};},removeListener(){}}}};
 window[new URL(appended.src).searchParams.get('callback')]();await pending;
 let height=558;
 const host={getBoundingClientRect:()=>({width:390,height}),classList:{add(){},remove(){}}};
 const container={nodeType:1,parentElement:host,clientWidth:390,clientHeight:0};
 let viewport;
 const view=window.JJUKGO_NAVER.render(container,{coords:[[127,37.5],[127.01,37.51]],next:{key:'next',ll:[127,37.5],state:'walk',trusted:false,distanceM:74,remainingSeconds:17,label:'<unsafe>'},endpointHTML:{from:'origin-icon',to:'destination-icon'},onViewportChange:ll=>viewport=ll,signalHTML:()=>'<popup>',onSignalClose:()=>{closeCalls++;view.closeSignal();}});
 assert.equal(created.options.size.height,558);
 assert.match(markers[0].options.icon.content,/signal-disc gray/);
 assert.match(markers[0].options.icon.content,/&lt;unsafe&gt;/);
 assert.doesNotMatch(markers[0].options.icon.content,/횡단 가능/);
 assert.equal(markers[1].options.icon.content,'origin-icon');assert.equal(markers[2].options.icon.content,'destination-icon');
 idle();assert.equal(viewport.join(','),'127.0163,37.5927');
 view.updateSignals([{key:'new-area',ll:[127.0163,37.5927],state:'unknown',label:'New area'}]);
 assert.match(markers.at(-1).options.icon.content,/New area/);
 view.showSignal({ll:[127,37.5]});assert.equal(popup.opened,true);
 closeButton.onclick({preventDefault(){},stopPropagation(){}});assert.equal(closeCalls,1);assert.equal(popup.opened,false);
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
 const historical={observed_samples:1000,test_samples:320,holdout_accuracy:.99,impurity:.01,win:[[10,26]],c:180,xd:[0,null,null,0,null]};
 const historyEngine={now:()=>68400,speed:()=>1,meta:()=>({name:'History'}),direction:x=>x,period:()=>'10/24 19h',plan:()=>historical,confidence:()=>0,predict:()=>{throw Error('Unvalidated phase must not be predicted');}};
 const historyEvidence=ew.JJUKGO_SIGNAL_EVIDENCE.create(historyEngine);
 const history=historyEvidence(crossing);assert.equal(history.historyLabel,'과거 초록 약 16초');assert.equal(history.remainingSeconds,null);assert.equal(history.trusted,false);
 historical.observed_samples=899;assert.equal(historyEvidence(crossing).historyLabel,undefined);
 historical.observed_samples=1000;historical.date='2026-10-24';historical.start=68400;
 const older=ew.JJUKGO_SIGNAL_EVIDENCE.create({...historyEngine,plan:()=>null,history:()=>historical})(crossing);
 assert.equal(older.historyLabel,'과거 초록 약 16초');assert.equal(older.trusted,false);assert.equal(older.remainingSeconds,null);
 assert.match(older.sourceLabel,/10-24 19시/);assert.match(older.sourceLabel,/다른 요일·시간/);
 const facts=JSON.parse(fs.readFileSync(path.join(root,'docs/prototype/reference-ui/signal-facts.json'),'utf8'));
 assert.ok(facts.signals['2705']);assert.doesNotMatch(JSON.stringify(facts),/"(?:ref|day0|xd)":/);
 assert.equal(evidence(crossing).crossingSeconds,12);
 const ui=fs.readFileSync(path.join(root,'docs/prototype/reference-ui/ui.js'),'utf8');
 const rank=ui.match(/pickAlternative=function[\s\S]*?\r?\n};/)[0];
 const route=(steep,gain,walk)=>({m:{steep,gain,walk},steps:[[1,2,{f:[0,0,steep],cls:0}]]});
 const normal=route(200,10,100),gentle=route(90,12,140),rejected=route(0,0,1000);rejected.rejected=true;
 const ranking={pickAlternative:null,refEngineAlternative:()=>normal,G:{node:{get:()=>({h:10})}},store:{get:()=>true},altRejectReason:r=>r.rejected?'budget':null};vm.createContext(ranking);vm.runInContext(ui.match(/function refTerrainKnown[^\r\n]+/)[0],ranking);vm.runInContext(rank,ranking);
 assert.equal(ranking.refTerrainKnown({steps:[[1,2,{cls:0}]]}),true); // Zero-valued f entries are compressed, not missing.
 assert.equal(ranking.refTerrainKnown({steps:[[1,2,{cls:4}]]}),false);
 assert.equal(ranking.pickAlternative(route(300,20,80),[normal,gentle,rejected],180),gentle);
 ranking.store.get=()=>false;assert.equal(ranking.pickAlternative(route(300,20,80),[gentle],180),normal);
 ranking.G.node.get=()=>({h:null});assert.equal(ranking.refTerrainKnown(normal),false);
 const choices=ui.match(/function refRouteOptions[\s\S]*?\r?\n}\r?\n/)[0];
 const routeContext={state:{routes:{alt:true,jjuk:{m:{walk:1080}},short:{m:{walk:900}}},focus:'jjuk'},refSample:false,refNavigating:false,mins:s=>s/60+'분'};
 vm.createContext(routeContext);vm.runInContext(choices,routeContext);
 assert.match(routeContext.refRouteOptions(),/data-ref-route="jjuk" aria-pressed="true"/);
 assert.match(routeContext.refRouteOptions(),/18분/);assert.match(routeContext.refRouteOptions(),/15분/);
 routeContext.state.routes.alt=false;assert.equal(routeContext.refRouteOptions(),'');
 routeContext.state.routes.alt=true;routeContext.refNavigating=true;assert.equal(routeContext.refRouteOptions(),'');
 const collect=ui.match(/function refMakeSignals[\s\S]*?\r?\n}\r?\n/)[0];
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'docs/prototype/seoul/signals.json'),'utf8'));
 const sigmeta=new global.Map(metadata.map(([id,x,y,name])=>[id,{name,ll:[126.58+x/1e5,37.35+y/1e5]}]));
 const collector={SIGMETA:sigmeta,SIG:{now:()=>68400},signalPlan:()=>null,refHistory:()=>null,trustedPlan:()=>null,refSignalModel:x=>x,distLL:(a,b)=>Math.hypot((a[0]-b[0])*88000,(a[1]-b[1])*110540)};
 vm.createContext(collector);vm.runInContext(collect,collector);
 const positions=collector.refMakeSignals({coords:[[127.0163,37.5927]],x:[]});
 assert.ok(positions.some(x=>String(x.s)==='2705'&&x.locationOnly));
 assert.ok(positions.length<=24);assert.ok(positions.every(x=>!x.dir));
 const moved=collector.refMakeSignals({coords:[[126.977,37.566]],x:[]},[127.0163,37.5927]);
 assert.ok(moved.some(x=>String(x.s)==='2705'));
 console.log('PASS reference UI: configuration, SDK, sizing, cleanup, route ends, viewport signals, Sungshin location without timing, historical/live separation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
