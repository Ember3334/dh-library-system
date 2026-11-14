'use strict';
// 应用核心：状态 / API 客户端 / 路由 / 导航 / 启动（数文拾光 · 数字人文平台 v2.1，无用户系统）
// 三种运行形态：
//   ① 本地完整版（node server/server.js，双击「启动平台.bat」）——全部功能
//   ② 静态发布版（window.STATIC_MODE，公开 GET 走 data/*.json）——只读
//   ③ 离线快照（file:// 双击 index.html，读 window.__SNAPSHOT__）——只读

function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'hidden ' + (type || '');
  t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

function openModal(html) {
  closeModal();
  const mask = document.createElement('div'); mask.className = 'modal-mask'; mask.id = 'modal-mask';
  mask.innerHTML = `<div class="modal">${html}</div>`;
  mask.addEventListener('click', e => { if (e.target === mask) closeModal(); });
  document.body.appendChild(mask);
}
function closeModal() { const m = document.getElementById('modal-mask'); if (m) m.remove(); }

// 封面：有自定义封面用图片；否则按索书号加载 /covers/<索书号>.jpg；缺图时生成设计感书封（零存储）
const COVER_THEMES = {
  '文学类': ['#c2693b', '#e6923c'],
  '艺术类': ['#b5539a', '#e07aa8'],
  '历史': ['#3f7d8c', '#5aa6a8'],
  '思政综合类': ['#9a6a2f', '#c79a3f'],
  'default': ['#7a5a3a', '#a87c45']
};
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// 属性值转义（esc 不转引号，直接拼进属性会被闭合注入）
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function wrapCJK(str, n) { const s = String(str || ''); const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out; }
function coverArtSVG(book) {
  const cat = book.category || 'default';
  const th = COVER_THEMES[cat] || COVER_THEMES.default;
  const uid = 'cg' + (book.id || Math.random().toString(36).slice(2, 7));
  const lines = wrapCJK((book.title || '?').slice(0, 42), 8).slice(0, 4);
  const titleY = 132;
  const titleSvg = lines.map((l, i) => `<text x="24" y="${titleY + i * 42}" font-size="31" font-weight="800" fill="#fff">${esc(l)}</text>`).join('');
  const author = esc((book.author || '').slice(0, 16));
  return `<svg viewBox="0 0 300 420" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(book.title)}">
    <defs><linearGradient id="${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${th[0]}"/><stop offset="1" stop-color="${th[1]}"/></linearGradient></defs>
    <rect width="300" height="420" fill="url(#${uid})"/>
    <rect x="0" y="0" width="9" height="420" fill="rgba(0,0,0,.2)"/>
    <text x="24" y="54" font-size="13" fill="rgba(255,255,255,.82)" letter-spacing="3">${esc(cat)}</text>
    <line x1="24" y1="72" x2="118" y2="72" stroke="rgba(255,255,255,.5)" stroke-width="2"/>
    ${titleSvg}
    <text x="24" y="388" font-size="14" fill="rgba(255,255,255,.92)">${author}</text>
  </svg>`;
}
function coverFallback(img) {
  const ph = document.createElement('div');
  ph.className = 'cover-art';
  // data-* 缺失时兜底，避免 SVG 书封出现「?」
  ph.innerHTML = coverArtSVG({
    id: img.dataset.id,
    title: img.dataset.title || '未知书名',
    author: img.dataset.author || '佚名',
    category: img.dataset.category || ''
  });
  if (img.parentNode) img.parentNode.replaceChild(ph, img);
}
window.coverFallback = coverFallback;

// ==========================================================
// 运行模式
// ==========================================================
window.API_BASE = window.API_BASE || '';
window.STATIC_BASE = window.STATIC_BASE || window.API_BASE;
window.STATIC_MODE = !!window.STATIC_MODE;
// file:// 双击打开：无服务、无 fetch（CORS 拦），数据来自 snapshot.js
window.OFFLINE = location.protocol === 'file:';
const OFFLINE = window.OFFLINE;

function apiUrl(path) { return window.API_BASE + path; }
function assetUrl(p) {
  const s = String(p || '');
  if (/^https?:\/\//i.test(s) || /^data:/i.test(s)) return s;
  if (OFFLINE) return './' + s.replace(/^\//, '');
  if (window.STATIC_MODE) return (window.ASSET_BASE || './') + s.replace(/^\//, '');
  return s;
}
function encPath(p) {
  return String(p || '').split('/').map(seg => encodeURIComponent(seg)).join('/');
}
// 作品/封面等载荷统一出口：站内相对路径逐段编码；外链原样（引号已剔除）
function safePayload(p) {
  const v = String(p || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v.replace(/["'<>]/g, '');
  if (v.startsWith('/')) return encPath(v);
  return '';
}
function coverUrl(callNo) {
  return assetUrl('/covers/' + encodeURIComponent(callNo) + '.jpg');
}
window.apiUrl = apiUrl;
window.assetUrl = assetUrl;
window.safePayload = safePayload;

// ==========================================================
// 站点文案（settings）：启动时拉一次，渲染时读，缺失回落默认值
// ==========================================================
const Settings = {
  data: {},
  load(list) { if (list && typeof list === 'object') this.data = list; },
  get(key, fallback) {
    const v = this.data && this.data[key];
    return (v === undefined || v === null || v === '') ? (fallback === undefined ? '' : fallback) : v;
  },
  list(key, fallbackArr) {
    const v = this.get(key, '');
    const arr = String(v || '').split(',').map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : (fallbackArr || []);
  }
};
window.Settings = Settings;

// 静态/离线模式下的 GET 映射：/api/xxx → data/xxx.json
const STATIC_GET_MAP = {
  '/api/books': 'data/books.json',
  '/api/categories': 'data/categories.json',
  '/api/stars': 'data/stars.json',
  '/api/overview': 'data/overview.json',
  '/api/works': 'data/works.json',
  '/api/posts': 'data/posts.json',
  '/api/meta': 'data/meta.json',
  '/api/settings': 'data/settings.json'
};

const State = {
  manageToken: localStorage.getItem('dh_manage_token') || '',
  setManage(t) { this.manageToken = t; localStorage.setItem('dh_manage_token', t); },
  clearManage() { this.manageToken = ''; localStorage.removeItem('dh_manage_token'); }
};

// 离线快照直读（不发网络请求）
function offlineGet(url, snap) {
  const path = url.split('?')[0];
  const qs = new URLSearchParams(url.split('?')[1] || '');
  if (path === '/api/settings') return { settings: snap.settings || {} };
  if (path === '/api/meta') return snap.meta || {};
  if (path === '/api/overview') return snap.overview || {};
  if (path === '/api/categories') return { categories: snap.categories || [] };
  if (path === '/api/stars') return { stars: snap.stars || [] };
  if (path === '/api/books') return filterStatic('/api/books', url, { books: snap.books || [] });
  if (path.startsWith('/api/books/')) {
    const id = path.split('/')[3];
    const all = snap.books || [];
    const item = all.find(b => String(b.id) === String(id));
    if (!item) throw new Error('未找到该书');
    return { book: item, related: all.filter(b => b.category === item.category && b.id !== item.id).slice(0, 6) };
  }
  if (path === '/api/works') return filterStatic('/api/works', url, { works: snap.works || [], issues: snap.issues || [] });
  if (path.startsWith('/api/works/')) {
    const id = path.split('/')[3];
    const all = snap.works || [];
    const item = all.find(w => String(w.id) === String(id));
    if (!item) throw new Error('未找到该作品');
    return { work: item, related: all.filter(w => w.id !== item.id && w.issue_no === item.issue_no).slice(0, 4) };
  }
  if (path === '/api/posts') return filterStatic('/api/posts', url, { posts: snap.posts || [] });
  if (path.startsWith('/api/posts/')) {
    const id = path.split('/')[3];
    const item = (snap.posts || []).find(p => String(p.id) === String(id));
    if (!item) throw new Error('未找到该资讯');
    return { post: item };
  }
  if (path.startsWith('/api/ai/')) throw new Error('离线快照不含 AI 助手，请双击「启动平台.bat」使用完整版');
  throw new Error('离线快照不支持该操作');
}

const API = {
  async req(method, url, body) {
    // ① 离线快照（file://）：只读，直接从内存取
    if (OFFLINE) {
      if (method !== 'GET') throw new Error('离线只读模式：编辑内容请双击「启动平台.bat」打开完整版');
      if (!window.__SNAPSHOT__) throw new Error('缺少离线快照 data/snapshot.js，请先运行 npm run snapshot');
      return offlineGet(url, window.__SNAPSHOT__);
    }
    // ② 静态发布版：公开 GET 读本地 JSON
    if (window.STATIC_MODE && method === 'GET') {
      const m = Object.keys(STATIC_GET_MAP).find(k => url === k || url.startsWith(k + '?'));
      if (m) {
        const res = await fetch(assetUrl(STATIC_GET_MAP[m]));
        const data = await res.json();
        return filterStatic(m, url, data);
      }
      if (url.startsWith('/api/works/')) {
        const id = url.split('/')[3];
        const res = await fetch(assetUrl('data/works-full.json'));
        const all = await res.json();
        const item = (all.works || []).find(w => String(w.id) === String(id));
        if (!item) throw new Error('未找到该作品');
        return { work: item, related: (all.works || []).filter(w => w.id !== item.id && w.issue_no === item.issue_no).slice(0, 4) };
      }
      if (url.startsWith('/api/posts/')) {
        const id = url.split('/')[3];
        const res = await fetch(assetUrl('data/posts-full.json'));
        const all = await res.json();
        const item = (all.posts || []).find(p => String(p.id) === String(id));
        if (!item) throw new Error('未找到该资讯');
        return { post: item };
      }
      if (url.startsWith('/api/books/')) {
        const id = url.split('/')[3];
        const res = await fetch(assetUrl('data/books-full.json'));
        const all = await res.json();
        const item = (all.books || []).find(b => String(b.id) === String(id));
        if (!item) throw new Error('未找到该书');
        const related = (all.books || []).filter(b => b.category === item.category && b.id !== item.id).slice(0, 6);
        return { book: item, related };
      }
      if (url.startsWith('/api/ai/')) { throw new Error('静态展示版不提供 AI 服务，请访问完整版'); }
      throw new Error('静态展示版不支持该操作');
    }
    // ③ 正常后端
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (State.manageToken) headers['Authorization'] = 'Bearer ' + State.manageToken;
    const res = await fetch(apiUrl(url), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      if (res.status === 401 && State.manageToken) State.clearManage();
      throw new Error(data.error || ('请求失败 (' + res.status + ')'));
    }
    return data;
  },
  books(p = {}) { const qs = new URLSearchParams(p).toString(); return this.req('GET', '/api/books?' + qs); },
  categories() { return this.req('GET', '/api/categories').then(r => r.categories || []); },
  book(id) { return this.req('GET', '/api/books/' + id); },
  overview() { return this.req('GET', '/api/overview'); },
  stars(p) { const qs = new URLSearchParams(p).toString(); return this.req('GET', '/api/stars?' + qs); },
  works(p = {}) { const qs = new URLSearchParams(p).toString(); return this.req('GET', '/api/works' + (qs ? '?' + qs : '')); },
  work(id) { return this.req('GET', '/api/works/' + id); },
  posts(p = {}) { const qs = new URLSearchParams(p).toString(); return this.req('GET', '/api/posts' + (qs ? '?' + qs : '')); },
  post(id) { return this.req('GET', '/api/posts/' + id); },
  settings() { return this.req('GET', '/api/settings').then(r => r.settings || {}); },
  ask(q) { return this.req('POST', '/api/ai/ask', { question: q }); },
  aiStatus() { return this.req('GET', '/api/ai/status'); },
  aiReset() { return this.req('POST', '/api/ai/reset', {}); },
  aiSearch(q, limit) { return this.req('GET', '/api/ai/search?q=' + encodeURIComponent(q) + '&limit=' + (limit || 8)); },
  digest(id) { return this.req('GET', '/api/ai/digest/' + id); },
  // ---- 管理端 ----
  manageLogin(passcode) { return this.req('POST', '/api/manage/login', { passcode }); },
  manageWorks() { return this.req('GET', '/api/manage/works'); },
  saveWork(id, b) { return id ? this.req('PUT', '/api/manage/works/' + id, b) : this.req('POST', '/api/manage/works', b); },
  deleteWork(id) { return this.req('DELETE', '/api/manage/works/' + id); },
  rescanWorks(prune) { return this.req('POST', '/api/manage/works/rescan', { prune: !!prune }); },
  managePosts() { return this.req('GET', '/api/manage/posts'); },
  savePost(id, b) { return id ? this.req('PUT', '/api/manage/posts/' + id, b) : this.req('POST', '/api/manage/posts', b); },
  deletePost(id) { return this.req('DELETE', '/api/manage/posts/' + id); },
  manageSettings() { return this.req('GET', '/api/manage/settings'); },
  saveSettings(patch) { return this.req('PUT', '/api/manage/settings', patch); },
  fetchLink(url) { return this.req('POST', '/api/manage/fetch-link', { url }); },
  mediaList() { return this.req('GET', '/api/manage/media'); },
  deleteMedia(p, force) { return this.req('DELETE', '/api/manage/media?path=' + encodeURIComponent(p) + (force ? '&force=1' : '')); },
  snapshot() { return this.req('POST', '/api/manage/snapshot', {}); },
  // 上传走 XHR 以便显示进度
  upload(file, kind, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl('/api/manage/upload?kind=' + encodeURIComponent(kind || 'file')));
      if (State.manageToken) xhr.setRequestHeader('Authorization', 'Bearer ' + State.manageToken);
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
      }
      xhr.onload = () => {
        let d = {};
        try { d = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(d);
        else reject(new Error(d.error || ('上传失败 (' + xhr.status + ')')));
      };
      xhr.onerror = () => reject(new Error('网络中断，上传失败'));
      xhr.send(fd);
    });
  },
  publish() { return this.req('POST', '/api/publish', {}); }
};

// 静态/离线模式查询过滤（books 支持分页与检索；works/posts 支持 category/issue）
function filterStatic(mapKey, url, data) {
  const qs = new URLSearchParams(url.split('?')[1] || '');
  if (mapKey === '/api/books') {
    let list = data.books || [];
    const q = (qs.get('q') || '').toLowerCase();
    const cat = qs.get('category') || '';
    if (cat) list = list.filter(b => b.category === cat);
    if (q) list = list.filter(b => [b.title, b.author, b.tags, b.intro, b.call_no, b.isbn].some(x => String(x || '').toLowerCase().includes(q)));
    const page = parseInt(qs.get('page') || '1', 10), pp = Math.min(parseInt(qs.get('pageSize') || '24', 10) || 24, 100);
    const cats = [...new Set((data.books || []).map(b => b.category).filter(Boolean))];
    return { total: list.length, page, pageSize: pp, books: list.slice((page - 1) * pp, page * pp), categories: cats };
  }
  if (mapKey === '/api/works') {
    let list = data.works || [];
    if (qs.get('issue')) list = list.filter(w => String(w.issue_no) === qs.get('issue'));
    if (qs.get('code')) list = list.filter(w => w.code === qs.get('code'));
    return { works: list, issues: data.issues || [] };
  }
  if (mapKey === '/api/posts') {
    let list = data.posts || [];
    if (qs.get('category')) list = list.filter(p => p.category === qs.get('category'));
    return { posts: list };
  }
  return data;
}

// 摘星辰星辰代号库
const STAR_CODES = ['少微星', '东壁星', '北极星', '启明星', '织女星', '天狼星', '牵牛星', '心宿星', '文曲星', '北斗星', '南斗星', '轩辕星', '长庚星'];
window.STAR_CODES = STAR_CODES;
window.State = State;

function renderNav() {
  const nav = document.getElementById('nav');
  const userArea = document.getElementById('user-area');
  const hash = location.hash || '#/home';
  const links = [['#/home', '宇宙'], ['#/library', '书库'], ['#/stars', '摘星辰'], ['#/news', '资讯']];
  nav.innerHTML = links.map(([h, t]) => {
    const isActive = hash === h || (h !== '#/home' && hash.startsWith(h));
    return `<a href="${h}" class="${isActive ? 'active' : ''}">${t}</a>`;
  }).join('')
    + `<button class="nav-theme" id="theme-btn" title="切换主题">🌙 深色</button>`
    + (OFFLINE || window.STATIC_MODE ? '' : `<button class="nav-ai" id="nav-ai" title="唤出 AI 助手">✨ AI 助手</button>`);
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) { themeBtn.onclick = toggleTheme; updateThemeBtn(); }
  const navAi = document.getElementById('nav-ai');
  if (navAi) navAi.onclick = () => { if (window.AIWidget) AIWidget.toggle(); };
  if (userArea) {
    if (OFFLINE) userArea.innerHTML = `<span class="offline-badge" title="直接打开的本地文件，数据只读">📴 离线快照</span>`;
    else if (window.STATIC_MODE) userArea.innerHTML = '';
    else userArea.innerHTML = `<a class="manage-link" href="#/manage" title="创始人管理入口">·</a>`;
  }
}

// 站点身份文案（品牌名/副标/浏览器标题）
function applySiteText() {
  const name = Settings.get('site.name', '数文拾光');
  const full = Settings.get('site.nameFull', '数文拾光 · 数字人文协会');
  const tag = Settings.get('site.tagline', '宇宙 · 书库 · 摘星辰 · 资讯');
  const b = document.querySelector('.brand-text strong');
  if (b) b.textContent = full;
  const s = document.querySelector('.brand-text span');
  if (s) s.textContent = tag;
  document.title = name + ' · 数字人文平台';
  const desc = Settings.get('site.description', '');
  if (desc) {
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
    m.content = desc;
    // 分享卡片（微信/Telegram/QQ 等读 og: 标签）
    const og = (prop, val) => {
      let el = document.querySelector(`meta[property="${prop}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
      el.setAttribute('content', val);
    };
    og('og:title', name + ' · 数字人文平台');
    og('og:description', desc);
    og('og:type', 'website');
    og('og:locale', 'zh_CN');
  }
}

function route() {
  renderNav();
  applySiteText();
  const hash = location.hash || '#/home';
  const app = document.getElementById('app');
  app.scrollTop = 0;
  if (window._screenTimer) { clearInterval(window._screenTimer); window._screenTimer = null; }
  if (window.Views && Views.cleanupStars) Views.cleanupStars();
  if (window.Galaxy && Galaxy.destroy) Galaxy.destroy();
  document.body.classList.remove('reader');   // 退出全屏阅读页时清掉布局态
  const run = async (fn) => {
    try { await fn(); }
    catch (e) { app.innerHTML = `<div class="empty">加载失败：${esc(e.message)}<br><a href="#/home">返回首页</a></div>`; }
    finally { paint(); }
  };
  function paint() {
    if (!app) return;
    app.classList.remove('view-in');
    void app.offsetWidth; // 强制重排以重启动画
    app.classList.add('view-in');
  }

  if (hash.startsWith('#/book/')) return run(() => Views.bookDetail(hash.split('/')[2]));
  if (hash.startsWith('#/work/')) return run(() => Views.workDetail(hash.split('/')[2]));
  if (hash.startsWith('#/post/')) return run(() => Views.postDetail(hash.split('/')[2]));
  if (hash === '#/library') return run(Views.library);
  if (hash === '#/stars') return run(Views.starsView);
  if (hash === '#/news') return run(Views.news);
  if (hash === '#/manage') return run(Views.manage);
  return run(Views.home);
}

// 主题：用户手动选择持久化；未选择时跟随系统 prefers-color-scheme
const _sysDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const t = localStorage.getItem('dh_theme') || (_sysDark && _sysDark.matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#1b1510' : '#c2693b';
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = cur;
  localStorage.setItem('dh_theme', cur);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = cur === 'dark' ? '#1b1510' : '#c2693b';
  updateThemeBtn();
  window.dispatchEvent(new CustomEvent('dh:theme', { detail: { theme: cur } }));
}
// 系统主题变化时跟随（仅用户未手动选择过）
if (_sysDark) {
  const onSysTheme = () => {
    if (localStorage.getItem('dh_theme')) return;
    applyTheme(); updateThemeBtn();
    window.dispatchEvent(new CustomEvent('dh:theme', { detail: { theme: document.documentElement.dataset.theme } }));
  };
  if (_sysDark.addEventListener) _sysDark.addEventListener('change', onSysTheme);
  else if (_sysDark.addListener) _sysDark.addListener(onSysTheme);
}
function updateThemeBtn() {
  const b = document.getElementById('theme-btn');
  if (b) b.textContent = document.documentElement.dataset.theme === 'dark' ? '☀ 浅色' : '🌙 深色';
}

async function boot() {
  applyTheme();
  // 先取文案，避免首屏闪默认值（失败也不阻塞）
  try {
    if (OFFLINE) Settings.load((window.__SNAPSHOT__ || {}).settings || {});
    else Settings.load(await API.settings());
  } catch (e) { /* 回落默认值 */ }
  renderNav();
  applySiteText();
  // 静态版/离线版隐藏 AI 入口（无后端 AI 服务）
  if (window.STATIC_MODE || OFFLINE) {
    const fab = document.getElementById('ai-fab');
    if (fab) fab.style.display = 'none';
  } else {
    AIWidget.init();
    API.aiStatus().then(r => {
      const fab = document.getElementById('ai-fab');
      if (fab) fab.title = 'AI 助手（' + (r.online ? '真实模型在线' : '离线规则引擎') + '）';
    }).catch(() => {});
  }
  window.addEventListener('hashchange', route);
  // 全局委托：点击任意图书卡片 → 进入详情页
  document.addEventListener('click', e => {
    const card = e.target.closest('.book-card');
    if (card && card.dataset.id) location.hash = '#/book/' + card.dataset.id;
  });
  route();
}
document.addEventListener('DOMContentLoaded', boot);
