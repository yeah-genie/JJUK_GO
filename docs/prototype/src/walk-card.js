// Coordinates remain in memory; only an explicit image-save action exports the card.
function appendTrace(tr,fix){
  if(fix.accuracy>PACE.ACC){tr.traceFix=null;return;}
  tr.trace ||= [];const last=tr.traceFix,dt=last?(fix.timestamp-last.timestamp)/1000:0;
  if(last&&dt<=0)return;
  if(last&&distLL(last.ll,fix.ll)>Math.max(30,dt*3+last.accuracy+fix.accuracy)){tr.traceFix=null;return;}
  if(!last||dt>PACE.GAP){tr.trace.push([[...fix.ll]]);}
  else if(distLL(last.ll,fix.ll)>=3){tr.trace[tr.trace.length-1].push([...fix.ll]);}else return;
  tr.traceFix=fix;
  if(tr.trace.reduce((n,s)=>n+s.length,0)>2000)tr.trace=tr.trace.map(s=>s.filter((_,i)=>i===0||i===s.length-1||i%2===0));
}
function walkCardSVG(rec,route){
  const segments=rec?.trace?.filter(s=>s.length>1)||[],actual=segments.length>0;
  const lines=actual?segments:(route?.coords?.length?[route.coords]:[]),pts=lines.flat();
  const xs=pts.map(p=>p[0]*Math.cos(37.55*Math.PI/180)),ys=pts.map(p=>-p[1]);
  const x0=Math.min(...xs),y0=Math.min(...ys),dx=Math.max(...xs)-x0,dy=Math.max(...ys)-y0,scale=pts.length?250/Math.max(dx,dy,1e-7):1;
  const project=p=>[(p[0]*Math.cos(37.55*Math.PI/180)-x0)*scale+40+(250-dx*scale)/2,(-p[1]-y0)*scale+95+(250-dy*scale)/2];
  const paths=lines.map(s=>`<polyline points="${s.map(p=>project(p).map(n=>n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#F6C343" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const endpoints=pts.length?[project(pts[0]),project(pts[pts.length-1])].map((p,i)=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="6" fill="${i?'#F6C343':'#F4F2E9'}" stroke="#242A32" stroke-width="2"/>`).join(''):'';
  const date=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric'}).format(rec?.at?new Date(rec.at):new Date());
  const title=actual?'오늘도 내 걸음으로.':'이 길을 걸어볼까요?';
  const label=actual?'GPS로 기록한 이동 구간':(state.mode==='example'?'예시 경로 · 실제 이동 기록 아님':'계획 경로 · 실제 이동 기록 아님');
  const distance=actual?km(rec.meters):(route?km(route.length):'—');
  const time=actual?dur(rec.elapsedS):state.sims?mins(state.sims[state.focus].total):'—';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="330" height="460" viewBox="0 0 330 460" role="img" aria-label="${label}"><rect width="330" height="460" rx="16" fill="#242A32"/><path d="M24 24h30" stroke="#F6C343" stroke-width="5"/><g font-family="sans-serif" fill="#F4F2E9"><text x="24" y="58" font-size="23" font-weight="700">${title}</text><text x="24" y="80" fill="#B7BEC8" font-size="11">${label}</text>${paths}${endpoints}<path d="M24 368h282" stroke="#46505D"/><text x="24" y="395" font-size="12" fill="#B7BEC8">${actual?'걸은 거리':'경로 거리'}</text><text x="190" y="395" font-size="12" fill="#B7BEC8">${actual?'기록 시간':'예상 시간'}</text><text x="24" y="426" font-size="26" font-weight="700">${distance}</text><text x="190" y="426" font-size="26" font-weight="700">${time}</text><text x="24" y="450" font-size="11" fill="#B7BEC8">${date}</text><text x="265" y="450" font-size="13" font-weight="700">쭉고.</text></g></svg>`;
}
function renderDone(){
  const route=state.routes?.[state.focus],rec=state.lastWalk;
  $('share-card').innerHTML=walkCardSVG(rec,route);
  setText('done-hint',rec?.trace?.some(s=>s.length>1)?'위치가 끊긴 구간은 이어 그리지 않았어요.':'GPS 이동 기록이 없어 계획한 경로만 표시해요.');
}
async function saveWalkCard(){
  const svg=$('share-card').querySelector('svg');if(!svg)return;
  const url=URL.createObjectURL(new Blob([svg.outerHTML],{type:'image/svg+xml;charset=utf-8'}));
  try{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=990;canvas.height=1380;canvas.getContext('2d').drawImage(img,0,0,990,1380);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)throw new Error('export');const download=URL.createObjectURL(blob),a=document.createElement('a');a.href=download;a.download='쭉고-오늘의-걸음.png';a.click();setTimeout(()=>URL.revokeObjectURL(download),10000);setText('done-hint','인증 이미지를 저장했어요.');}catch{setText('done-hint','이미지를 저장하지 못했어요. 카드 화면을 캡처해 주세요.');}finally{URL.revokeObjectURL(url);}
}
