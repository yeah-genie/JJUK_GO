// Structural/build contract only; actual browser evidence is reports/design-qa.md.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../docs/prototype'),src=path.join(root,'src');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),template=fs.readFileSync(path.join(src,'template.html'),'utf8');
const ids=[...template.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'duplicate DOM IDs');
const js=['app.js','screens.js','walking-profile.js','walk-card.js','external-search.js'].map(n=>fs.readFileSync(path.join(src,n),'utf8')).join('\n');
const generatedIds=[...js.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
for(const [,id] of js.matchAll(/\$\(["']([^"']+)["']\)/g))assert(ids.includes(id)||generatedIds.includes(id),'missing DOM ID '+id);
assert(!/\/\*(APP_JS|ASPHALT_UI|WALKING_PROFILE|MAPLIBRE_CSS|ASPHALT_CSS)\*\//.test(html),'unresolved build fragment');
for(const id of ['s-onboarding','s-home','s-result','s-settings','s-walk','settings-manual','manual-speed','start-walk'])assert(ids.includes(id),id);
for(const id of ['s-me','go-card','deadline-hour','pace-chips'])assert(!ids.includes(id),'retired control '+id);
assert(template.indexOf('id="manual-speed"')>template.indexOf('id="settings-manual"'));
assert(!template.match(/id="settings-manual"[^>]*\bopen\b/),'manual menu must start collapsed');
new Function(html.slice(html.lastIndexOf('<script>')+8,html.lastIndexOf('</script>')));
console.log('PASS app shell: complete build, all DOM targets, unique IDs, retired controls absent and manual menu collapsed');
