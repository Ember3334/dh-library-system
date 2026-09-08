'use strict';
// 应用核心：状态 / API 客户端 / 路由 / 导航 / 启动

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

// 远程后端配置：config.js 设置 window.API_BASE；留空表示同域（localhost 或同域名部署）
// 示例：window.API_BASE = 'https://your-app.zeabur.app';
window.API_BASE = window.API_BASE || '';
window.STATIC_BASE = window.STATIC_BASE || window.API_BASE;
function apiUrl(path) { return window.API_BASE + path; }
function coverUrl(callNo) { return (window.STATIC_BASE || '') + '/covers/' + encodeURIComponent(callNo) + '.jpg'; }
window.apiUrl = apiUrl;
window.coverUrl = coverUrl;

const State = {
  token: localStorage.getItem('dh_token') || '',
  user: null,
  set(t, u) { this.token = t; this.user = u; localStorage.setItem('dh_token', t); },
  clear() { this.token = ''; this.user = null; localStorage.removeItem('dh_token'); }
};

const API = {
  async req(method, url, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (State.token) headers['Authorization'] = 'Bearer ' + State.token;
    const res = await fetch(apiUrl(url), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || ('请求失败 (' + res.status + ')'));
    return data;
  },
  books(p = {}) { const qs = new URLSearchParams(p).toString(); return this.req('GET', '/api/books?' + qs); },
  categories() { return this.req('GET', '/api/categories').then(r => r.categories || []); },
  book(id) { return this.req('GET', '/api/books/' + id); },
  createBook(b) { return this.req('POST', '/api/books', b); },
  updateBook(id, b) { return this.req('PUT', '/api/books/' + id, b); },
  deleteBook(id) { return this.req('DELETE', '/api/books/' + id); },
  importBooks(fmt, mode, data) { return this.req('POST', '/api/books/import', { format: fmt, mode, data }); },
  borrow(id) { return this.req('POST', '/api/borrow', { book_id: id }); },
  cancelBorrow(id) { return this.req('POST', '/api/borrow/' + id + '/cancel'); },
  retbook(id) { return this.req('POST', '/api/return/' + id); },
  myBorrows() { return this.req('GET', '/api/my/borrows'); },
  adminLoans(status) { return this.req('GET', '/api/admin/loans' + (status ? ('?status=' + encodeURIComponent(status)) : '')); },
  approveLoan(id) { return this.req('POST', '/api/admin/loans/' + id + '/approve'); },
  rejectLoan(id, reason) { return this.req('POST', '/api/admin/loans/' + id + '/reject', { reason }); },
  pickupLoan(id) { return this.req('POST', '/api/admin/loans/' + id + '/pickup'); },
  uploadCover(id, cover) { return this.req('POST', '/api/books/' + id + '/cover', { cover }); },
  login(u, p) { return this.req('POST', '/api/auth/login', { username: u, password: p }); },
  register(u, p, n, d, s) { return this.req('POST', '/api/auth/register', { username: u, password: p, name: n, dept: d, student_no: s }); },
  me() { return this.req('GET', '/api/auth/me'); },
  stats() { return this.req('GET', '/api/admin/stats'); },
  readers() { return this.req('GET', '/api/admin/readers'); },
  addReader(u, p, n, role, mb) { return this.req('POST', '/api/admin/readers', { username: u, password: p, name: n, role, max_borrow: mb }); },
  updateReader(id, b) { return this.req('PUT', '/api/admin/readers/' + id, b); },
  ask(q) { return this.req('POST', '/api/ai/ask', { question: q }); },
  aiStatus() { return this.req('GET', '/api/ai/status'); },
  aiReset() { return this.req('POST', '/api/ai/reset', {}); },
  aiSearch(q, limit) { return this.req('GET', '/api/ai/search?q=' + encodeURIComponent(q) + '&limit=' + (limit || 8)); },
  digest(id) { return this.req('GET', '/api/ai/digest/' + id); },
  overview() { return this.req('GET', '/api/overview'); },
  activity(n) { return this.req('GET', '/api/activity' + (n ? ('?limit=' + n) : '')); },
  stars(p) { const qs = new URLSearchParams(p).toString(); return this.req('GET', '/api/stars?' + qs); },
  rankings() { return this.req('GET', '/api/rankings'); },
  comments(id) { return this.req('GET', '/api/books/' + id + '/comments'); },
  postComment(id, content) { return this.req('POST', '/api/books/' + id + '/comments', { content }); },
  reviewInsights(id) { return this.req('GET', '/api/books/' + id + '/review-insights'); },
  dh() { return this.req('GET', '/api/dh'); }
};

function renderNav() {
  const nav = document.getElementById('nav');
  const user = document.getElementById('user-area');
  const hash = location.hash || '#/home';
  const u = State.user;
  const isStaff = u && (u.role === '馆员' || u.role === '管理员');
  const links = [['#/home', '星空首页']];
  links.push(['#/rankings', '排行榜'], ['#/dh', '数字人文']);
  if (u) links.push(['#/my', '我的借阅']);
  if (isStaff) {
    links.push(['#/admin', '数据看板'], ['#/screen', '数据大屏'], ['#/admin/loans', '审批台'], ['#/admin/catalog', '编目'], ['#/admin/import', '导入'], ['#/admin/readers', '读者']);
  }
  nav.innerHTML = links.map(([h, t]) => {
    const isActive = hash === h || (h !== '#/admin' && hash.startsWith(h));
    return `<a href="${h}" class="${isActive ? 'active' : ''}">${t}</a>`;
  }).join('')
    + `<button class="nav-theme" id="theme-btn" title="切换主题">🌙 深色</button>`
    + `<button class="nav-ai" id="nav-ai" title="唤出 AI 助手">✨ AI 助手</button>`;
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) { themeBtn.onclick = toggleTheme; updateThemeBtn(); }
  const navAi = document.getElementById('nav-ai');
  if (navAi) navAi.onclick = () => { if (window.AIWidget) AIWidget.toggle(); };

  if (u) {
    const ini = (u.name || u.username || '?').slice(0, 1);
    user.innerHTML = `<div class="user-chip"><div class="avatar">${ini}</div>
      <span>${u.name || u.username}</span><span class="role-badge">${u.role}</span></div>
      <button class="btn ghost sm" id="logout">退出</button>`;
    document.getElementById('logout').onclick = () => { State.clear(); renderNav(); location.hash = '#/home'; };
  } else {
    user.innerHTML = `<a class="btn ghost sm" href="#/login">登录</a><a class="btn sm" href="#/register">注册</a>`;
  }
}

function route() {
  renderNav();
  const hash = location.hash || '#/home';
  const app = document.getElementById('app');
  app.scrollTop = 0;
  if (window._screenTimer) { clearInterval(window._screenTimer); window._screenTimer = null; }
  if (window.Views && Views.cleanupStars) Views.cleanupStars();
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
  if (hash === '#/login') return run(Views.login);
  if (hash === '#/register') return run(Views.register);
  if (hash === '#/admin-login') return run(Views.adminLogin);
  if (hash === '#/rankings') return run(Views.rankings);
  if (hash === '#/dh') return run(Views.dh);
  if (hash === '#/screen') {
    if (!State.user || (State.user.role !== '馆员' && State.user.role !== '管理员')) { toast('需要馆员或管理员权限', 'err'); location.hash = '#/home'; return; }
    return run(Views.screen);
  }
  if (hash === '#/my') { if (!State.user) { location.hash = '#/login'; return; } return run(Views.my); }
  if (hash.startsWith('#/admin')) {
    if (!State.user || (State.user.role !== '馆员' && State.user.role !== '管理员')) {
      toast('需要馆员或管理员权限', 'err'); location.hash = '#/home'; return;
    }
    if (hash === '#/admin/catalog') return run(Views.adminCatalog);
    if (hash === '#/admin/import') return run(Views.adminImport);
    if (hash === '#/admin/readers') return run(Views.adminReaders);
    if (hash === '#/admin/loans') return run(Views.adminLoans);
    return run(Views.admin);
  }
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
  if (State.token) {
    try { const r = await API.me(); State.user = r.user; } catch (e) { State.clear(); }
  }
  renderNav();
  AIWidget.init();
  // AI 在线/离线状态（决定 fab 提示文案与导读能力）
  API.aiStatus().then(r => {
    const fab = document.getElementById('ai-fab');
    if (fab) fab.title = 'AI 助手（' + (r.online ? '真实模型在线' : '离线规则引擎') + '）';
  }).catch(() => {});
  window.addEventListener('hashchange', route);
  // 全局委托：点击任意图书卡片 → 进入详情页（修复首页书籍点不开）
  document.addEventListener('click', e => {
    const card = e.target.closest('.book-card');
    if (card && card.dataset.id) location.hash = '#/book/' + card.dataset.id;
  });
  route();
}
document.addEventListener('DOMContentLoaded', boot);
