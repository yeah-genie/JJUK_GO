// Explicit search only. Never forward a user's GPS fix to the public geocoder.
const cache=new Map();let lastRequest=0;
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method!=='GET'){res.statusCode=405;return res.end(JSON.stringify({error:'GET only'}));}
  const q=typeof req.query?.q==='string'?req.query.q.trim():'';
  if(q.length<2||q.length>80){res.statusCode=400;return res.end(JSON.stringify({error:'검색어는 2~80자로 입력해 주세요.'}));}
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
