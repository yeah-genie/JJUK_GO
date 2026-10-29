let externalRequest=0;
async function externalSearch(){
  const q=$('sq').value.trim(),ticket=++externalRequest,seq=searchSeq;
  if(q.length<2)return;
  const b=$('external-search');if(b){b.disabled=true;b.textContent='더 찾는 중…';}
  try{
    const r=await fetch('/api/places?q='+encodeURIComponent(q));const data=await r.json();
    if(ticket!==externalRequest||seq!==searchSeq||current!=='search')return;
    if(!r.ok)throw new Error(data.error||'공개 검색을 연결하지 못했어요.');
    const local=$('search-list').results||[],all=[...local];
    for(const p of data.places||[])if(!all.some(x=>x.name===p.name&&distLL(x.ll,p.ll)<30))all.push(p);
    $('search-list').results=all;
    $('search-list').innerHTML=all.map((p,i)=>`<button class="res-item" data-res="${i}"><b>${esc(p.name)}</b><small>${esc(p.address||p.kind||'장소')}</small></button>`).join('')+`<p class="note">${all.length?'검색한 장소를 골라 주세요.':'공개 검색에서도 찾지 못했어요. 주소로 검색하거나 지도에서 골라 주세요.'} Photon · © OpenStreetMap contributors. 보행로 연결은 별도로 확인해요.</p>`;
  }catch(err){if(seq!==searchSeq||current!=='search')return;if(b){b.disabled=false;b.textContent='공개 검색 다시 시도';}setText('search-location',err.message);$('search-location').hidden=false;}
}
