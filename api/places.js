// Explicit search only. Never forward a user's GPS fix to the public geocoder.
const cache=new Map();let lastRequest=0;
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method!=='GET'){res.statusCode=405;return res.end(JSON.stringify({error:'GET only'}));}
  const q=typeof req.query?.q==='string'?req.query.q.trim():'';
  if(q.length<2||q.length>80){res.statusCode=400;return res.end(JSON.stringify({error:'검색어는 2~80자로 입력해 주세요.'}));}
  const kakaoKey=(process.env.KAKAO_REST_API_KEY||'').trim();
  // Kakao results are used for the current request only, never cached as a POI database.
  if(kakaoKey){
    res.setHeader('Cache-Control','no-store');
    if(Date.now()-lastRequest<500){res.statusCode=429;return res.end(JSON.stringify({error:'잠시 후 다시 검색해 주세요.'}));}
    lastRequest=Date.now();
    try{
      const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
      url.search=new URLSearchParams({query:q,size:'15',rect:'126.68,37.39,127.23,37.72'}).toString();
      const r=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json',Authorization:'KakaoAK '+kakaoKey}});
      if(!r.ok){res.statusCode=503;return res.end(JSON.stringify({error:r.status===401?'카카오 검색 키 설정을 확인해야 해요.':r.status===403?'카카오맵 API 사용 설정과 호출 권한을 확인해야 해요.':r.status===429?'카카오 검색 한도에 도달했어요. 기본 검색을 이용해 주세요.':'카카오 장소검색 연결이 늦어져요. 잠시 후 다시 시도해 주세요.'}));}
      const data=await r.json();if(!Array.isArray(data.documents))throw new Error('invalid response');
      const places=data.documents.flatMap(p=>{
        if(!p||typeof p.x!=='string'||typeof p.y!=='string'||!p.x.trim()||!p.y.trim()||typeof p.place_name!=='string'||!p.place_name.trim())return [];
        const ll=[Number(p.x),Number(p.y)];
        if(!ll.every(Number.isFinite)||ll[0]<126.68||ll[0]>127.23||ll[1]<37.39||ll[1]>37.72)return [];
        const address=[p.road_address_name,p.address_name].find(s=>typeof s==='string'&&s.trim())||'';
        return [{name:p.place_name.slice(0,120),ll,kind:typeof p.category_group_name==='string'?p.category_group_name.slice(0,80):'장소',address:address.slice(0,180),sub:address.slice(0,180),source:'kakao'}];
      });
      return res.end(JSON.stringify({places,source:'Kakao Maps',provider:'kakao'}));
    }catch{res.statusCode=503;return res.end(JSON.stringify({error:'카카오 장소검색에 연결하지 못했어요. 기본 검색을 이용하거나 잠시 후 다시 시도해 주세요.'}));}
  }
  const hit=cache.get(q);
  if(hit&&Date.now()-hit.at<600000)return res.end(hit.body);
  if(Date.now()-lastRequest<500){res.statusCode=429;return res.end(JSON.stringify({error:'잠시 후 다시 검색해 주세요.'}));}
  lastRequest=Date.now();
  try {
    const url=new URL('https://photon.komoot.io/api/');url.search=new URLSearchParams({q,limit:'12',bbox:'126.68,37.39,127.23,37.72'}).toString();
    const r=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
    if(!r.ok)throw new Error('provider unavailable');
    const data=await r.json();
    const places=(Array.isArray(data.features)?data.features:[]).flatMap(f=>{
      const ll=f.geometry?.coordinates,p=f.properties||{};
      if(!Array.isArray(ll)||!ll.slice(0,2).every(Number.isFinite)||ll[0]<126.68||ll[0]>127.23||ll[1]<37.39||ll[1]>37.72)return [];
      const name=typeof p.name==='string'?p.name: [p.street,p.housenumber].filter(x=>typeof x==='string').join(' ');
      if(!name)return [];
      return [{name:name.slice(0,120),ll:ll.slice(0,2),kind:({cafe:'카페',restaurant:'음식점',park:'공원',gatehouse:'명소',museum:'박물관',attraction:'명소',hospital:'병원',station:'역'})[p.osm_value]||'장소',address:[p.city,p.district,p.street,p.housenumber].filter(x=>typeof x==='string').join(' ').slice(0,180)}];
    });
    res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=86400');
    const body=JSON.stringify({places,source:'Photon · © OpenStreetMap contributors'});
    if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(q,{at:Date.now(),body});res.end(body);
  }catch{res.statusCode=503;res.end(JSON.stringify({error:'공개 검색 연결이 늦어져요. 기본 검색이나 지도 선택을 이용해 주세요.'}));}
};
