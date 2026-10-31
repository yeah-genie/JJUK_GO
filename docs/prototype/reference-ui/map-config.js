// Browser-public client ID only. Server-side NAVER_MAP_CLIENT_ID supplies it.
window.JJUKGO_MAP_CONFIG = window.JJUKGO_MAP_CONFIG || {};
window.JJUKGO_MAP_CONFIG_READY = fetch('/api/map-config', {cache:'no-store'})
 .then(r=>{if(!r.ok)throw new Error('Map configuration unavailable');return r.json();})
 .then(c=>{if(typeof c.naverClientId==='string'&&c.naverClientId)window.JJUKGO_MAP_CONFIG.naverClientId=c.naverClientId;return window.JJUKGO_MAP_CONFIG;})
 .catch(()=>window.JJUKGO_MAP_CONFIG);
