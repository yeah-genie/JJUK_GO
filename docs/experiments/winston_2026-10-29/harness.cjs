// 읽기 전용 분석 하네스: Codex 브랜치 app.js(new.js)를 Node VM에서 돌리고 서울 데이터는 파일에서 읽는다.
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const SEOUL = '/home/user/DeeplearningApplication1/docs/prototype/seoul/';
const D = path.join(__dirname, 'data/');
const elements = new Map();
const element = id => { if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', hidden: false, classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} }, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } }); return elements.get(id); };
const fakeStorage = { data: new Map(), getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }, setItem(k, v) { this.data.set(k, String(v)); }, removeItem(k) { this.data.delete(k); } };
function resolve(url) {
  const p = url.replace('https://jjukgo.test/seoul/', '');
  if (p === 'signal-plans.json') return D + 'plans.json';
  const m = p.match(/^signal-hours\/(\d\d)\.json$/); if (m) return D + 'h' + m[1] + '.json';
  return SEOUL + p;
}
const fetch = async url => { const f = resolve(String(url)); if (!fs.existsSync(f)) return { ok: false, status: 404 }; const t = fs.readFileSync(f, 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(t), text: async () => t }; };
const ctx = vm.createContext({ URL, URLSearchParams, console, Date, Math, Number, Map, Set, Error, performance, fetch, setTimeout, clearTimeout, localStorage: fakeStorage,
  document: { baseURI: 'https://jjukgo.test/', getElementById: element, createElement: () => element('x'), addEventListener() {}, querySelectorAll: () => [], hidden: false },
  window: { isSecureContext: true }, navigator: {}, location: { search: '', hash: '' }, maplibregl: { addProtocol() {} }, addEventListener() {}, clearInterval() {}, atob });
const src = fs.readFileSync(path.join(__dirname, process.env.APP || 'new.js'), 'utf8').replace(/boot\(\);\s*$/, '');
vm.runInContext(src, ctx);
module.exports = { ctx, run: s => vm.runInContext(s, ctx) };
