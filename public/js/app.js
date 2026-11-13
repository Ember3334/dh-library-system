'use strict';
// 应用核心：状态 / API 客户端 / 路由 / 导航 / 启动（数字人文平台版，无用户系统）

function colorFor(str) {
  let h = 0; for (let i = 0; i < (str || '?').length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return `linear-gradient(135deg,hsl(${h},68%,56%),hsl(${(h + 48) % 360},68%,46%))`;
}

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
  ph.innerHTML = coverArtSVG({ id: img.dataset.id, title: img.dataset.title, author: img.dataset.author, category: img.dataset.category });
  if (img.parentNode) img.parentNode.replaceChild(ph, img);
}
window.coverFallback = coverFallback;

// 远程后端 / 静态模式配置
// 本地模式：API_BASE 空（同域 localhost:3000），完整功能
// 静态发布版：config.js 注入 window.STATIC_MODE=true，公开 GET 走本地 data/*.json
window.API_BASE = window.API_BASE || '';
window.STATIC_BASE = window.STATIC_BASE || window.API_BASE;
window.STATIC_MODE = !!window.STATIC_MODE;
function apiUrl(path) { return window.API_BASE + path; }
function coverUrl(callNo) {
  // 静态发布版走相对路径（兼容 GitHub Pages 子路径）；本地版同域绝对路径
  if (window.STATIC_MODE) return assetUrl('/covers/' + encodeURIComponent(callNo) + '.jpg');
  return (window.STATIC_BASE || '') + '/covers/' + encodeURIComponent(callNo) + '.jpg';
}
// 静态模式下资源路径相对化（兼容 GitHub Pages 子路径）
function assetUrl(p) {
  if (!window.STATIC_MODE) return p;
  return (window.ASSET_BASE || './') + String(p).replace(/^\//, '');
}
window.apiUrl = apiUrl;
window.coverUrl = coverUrl;
window.assetUrl = assetUrl;

// 静态模式下的 GET 映射：/api/xxx → data/xxx.json
const STATIC_GET_MAP = {
  '/api/books': 'data/books.json',
  '/api/categories': 'data/categories.json',
  '/api/stars': 'data/stars.json',
  '/api/overview': 'data/overview.json',
  '/api/works': 'data/works.json',
  '/api/posts': 'data/posts.json',
  '/api/meta': 'data/meta.json'
};

const State = {
  manageToken: localStorage.getItem('dh_manage_token') || '',
  setManage(t) { this.manageToken = t; localStorage.setItem('dh_manage_token', t); },
  clearManage() { this.manageToken = ''; localStorage.removeItem('dh_manage_token'); }
};

const API = {
  async req(method, url, body) {
    // 静态模式：公开 GET 直接读本地 JSON
    if (window.STATIC_MODE && method === 'GET') {
      const m = Object.keys(STATIC_GET_MAP).find(k => url === k || url.startsWith(k + '?'));
      if (m) {
        // 带查询参数时先全量取回再前端过滤（静态版数据量小，可接受）
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
  managePosts() { return this.req('GET', '/api/manage/posts'); },
  savePost(id, b) { return id ? this.req('PUT', '/api/manage/posts/' + id, b) : this.req('POST', '/api/manage/posts', b); },
  deletePost(id) { return this.req('DELETE', '/api/manage/posts/' + id); },
  upload(file, kind) {
    const fd = new FormData();
    fd.append('file', file);
    const headers = {};
    if (State.manageToken) headers['Authorization'] = 'Bearer ' + State.manageToken;
    return fetch(apiUrl('/api/manage/upload?kind=' + encodeURIComponent(kind || 'file')), { method: 'POST', headers, body: fd })
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || '上传失败');
        return d;
      });
  },
  publish() { return this.req('POST', '/api/publish', {}); }
};

// 静态模式查询过滤（books 支持分页与检索；works/posts 支持 category/issue）
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
const STAR_CODES = ['北极星', '启明星', '织女星', '天狼星', '牵牛星', '东壁星', '心宿星', '文曲星', '北斗星', '南斗星', '轩辕星', '长庚星'];
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
    + `<button class="nav-ai" id="nav-ai" title="唤出 AI 助手">✨ AI 助手</button>`;
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) { themeBtn.onclick = toggleTheme; updateThemeBtn(); }
  const navAi = document.getElementById('nav-ai');
  if (navAi) navAi.onclick = () => { if (window.AIWidget) AIWidget.toggle(); };
  if (userArea) userArea.innerHTML = window.STATIC_MODE ? '' : `<a class="manage-link" href="#/manage" title="创始人管理入口">·</a>`;
}

function route() {
  renderNav();
  const hash = location.hash || '#/home';
  const app = document.getElementById('app');
  app.scrollTop = 0;
  if (window._screenTimer) { clearInterval(window._screenTimer); window._screenTimer = null; }
  if (window.Views && Views.cleanupStars) Views.cleanupStars();
  if (window.Galaxy && Galaxy.destroy) Galaxy.destroy();
  const run = async (fn) => {
    try { await fn(); }
    catch (e) { app.innerHTML = `<div class="empty">加载失败：${e.message}<br><a href="#/home">返回首页</a></div>`; }
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

function applyTheme() { const t = localStorage.getItem('dh_theme') || 'light'; document.documentElement.dataset.theme = t; }
function toggleTheme() {
  const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = cur; localStorage.setItem('dh_theme', cur); updateThemeBtn();
  window.dispatchEvent(new CustomEvent('dh:theme', { detail: { theme: cur } }));
}
function updateThemeBtn() {
  const b = document.getElementById('theme-btn');
  if (b) b.textContent = document.documentElement.dataset.theme === 'dark' ? '☀ 浅色' : '🌙 深色';
}

async function boot() {
  applyTheme();
  renderNav();
  // 静态版隐藏 AI 入口（无后端 AI 服务）
  if (window.STATIC_MODE) {
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
