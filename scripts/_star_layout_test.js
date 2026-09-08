// 一次性冒烟测试：验证知识星空布局算法（坐标有效、不越界、连线可控）
// 运行：node scripts/_star_layout_test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views.js'), 'utf8');
const start = src.indexOf('const STAR_PALETTE');
const end = src.indexOf('function coverBlock');
if (start < 0 || end < 0) throw new Error('未定位到 StarScene 源码');
const code = src.slice(start, end);

function stubCtx() {
  const noop = () => {};
  return new Proxy({
    canvas: null, globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    createRadialGradient: () => ({ addColorStop: noop }),
    setTransform: noop, clearRect: noop, fillRect: noop, beginPath: noop, arc: noop, fill: noop,
    stroke: noop, moveTo: noop, lineTo: noop, drawImage: noop, scale: noop
  }, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => (t[k] = v, true) });
}
function stubCanvas() {
  return { width: 0, height: 0, style: {}, getContext: () => stubCtx(), addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1100, height: 520 }) };
}

const sandbox = {
  console,
  esc: s => String(s || ''),
  performance: { now: () => 0 },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  document: {
    body: {},
    documentElement: { dataset: { theme: 'light' } },
    createElement: tag => {
      if (tag !== 'canvas') return { className: '', style: {}, classList: { add() {}, remove() {} }, innerHTML: '', appendChild() {}, removeChild() {} };
      return stubCanvas();
    }
  },
  getComputedStyle: () => ({ getPropertyValue: () => '#333' }),
  ResizeObserver: class { observe() {} disconnect() {}; constructor(cb) { this.cb = cb; } },
  window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code + '\n;globalThis.__StarScene = StarScene;', sandbox);

const StarScene = sandbox.__StarScene;

// 构造 696 本假书（4 个分类）
const cats = ['文学类', '艺术类', '历史', '思政综合类'];
const books = Array.from({ length: 696 }, (_, i) => ({
  id: i + 1, title: '书' + i, author: '作者' + i, category: cats[i % 4],
  available: i % 3 === 0 ? 0 : 2, total: 3
}));

const stage = { appendChild() {}, removeChild() {} };
const canvas = stubCanvas();
canvas.parentElement = {
  getBoundingClientRect: () => ({ width: 1100, height: 520 }),
  appendChild() {}, removeChild() {}
};

const t0 = Date.now();
const scene = new StarScene(canvas, books);
const cost = Date.now() - t0;

const nodes = scene.nodes;
const bad = nodes.filter(n => !isFinite(n.x) || !isFinite(n.y) || n.x < 0 || n.y < 0 || n.x > scene.w || n.y > scene.h);
let minD = Infinity;
for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
  const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
  if (d < minD) minD = d;
}
console.log('渲染星数:', nodes.length, '/ 馆藏:', books.length);
console.log('画布尺寸:', scene.w + 'x' + scene.h);
console.log('越界/NaN 节点:', bad.length);
console.log('最小星间距:', minD.toFixed(2), 'px');
console.log('连线数:', scene.links.length);
console.log('构建耗时:', cost, 'ms');

// 「换一批」应换出不同的星
const before = scene.nodes.map(n => n.id).join(',');
scene.reseed();
const after = scene.nodes.map(n => n.id).join(',');
console.log('换一批后是否变化:', before !== after);

// 命中检测（注意 reseed 会重建 nodes 数组，需重新取引用）
const probe = scene.nodes[10];
const hit = scene.pick(probe.x + 2, probe.y + 2);
console.log('命中检测可用:', !!hit, hit && hit.book ? hit.book.title : '');

// 小画布 / 空数据
const c2 = stubCanvas();
c2.parentElement = { getBoundingClientRect: () => ({ width: 360, height: 380 }), appendChild() {}, removeChild() {} };
const s2 = new StarScene(c2, []);
console.log('空数据兜底星数:', s2.nodes.length);
const c3 = stubCanvas();
c3.parentElement = { getBoundingClientRect: () => ({ width: 360, height: 380 }), appendChild() {}, removeChild() {} };
const s3 = new StarScene(c3, books.slice(0, 5));
console.log('小样本:', s3.nodes.length, '越界:', s3.nodes.filter(n => n.x < 0 || n.y < 0 || n.x > s3.w || n.y > s3.h).length);

// 移动端画布 + 满量数据
const c4 = stubCanvas();
c4.parentElement = { getBoundingClientRect: () => ({ width: 360, height: 380 }), appendChild() {}, removeChild() {} };
const s4 = new StarScene(c4, books);
let md = Infinity;
for (let i = 0; i < s4.nodes.length; i++) for (let j = i + 1; j < s4.nodes.length; j++) md = Math.min(md, Math.hypot(s4.nodes[i].x - s4.nodes[j].x, s4.nodes[i].y - s4.nodes[j].y));
console.log('移动端 360x380:', s4.nodes.length, '星 越界:', s4.nodes.filter(n => n.x < 0 || n.y < 0 || n.x > s4.w || n.y > s4.h).length, '最小间距:', md.toFixed(1), '连线:', s4.links.length);

// 微星层 / 分组 / 连线上限
console.log('微星层数量:', scene.micro.length, '(应为 3)');
console.log('节点均带分类分组:', nodes.every(n => !!n.group) ? 'yes' : 'NO');
console.log('连线 ≤ 52:', scene.links.length <= 52 ? 'yes (' + scene.links.length + ')' : 'NO (' + scene.links.length + ')');

// 视差后仍能命中：pick 需反算 px/py
scene.px = 10; scene.py = 5;
const p = scene.nodes[20];
const hit2 = scene.pick(p.x + scene.px + 2, p.y + scene.py + 2);
console.log('视差后命中:', !!hit2, hit2 && hit2.id === p.id ? '(坐标正确)' : '(坐标错)');
scene.px = 0; scene.py = 0;

// 主题切换重建（applySky 不应抛错，且 skyLine 随主题变化）
const lineLight = (scene.applySky(), scene.skyLine);
sandbox.document.documentElement.dataset.theme = 'dark';
scene.applySky();
console.log('主题切换 skyLine 变化:', lineLight !== scene.skyLine ? 'yes' : 'NO');

