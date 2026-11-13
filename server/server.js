'use strict';
// 数字人文平台服务端（本地主模式）
// 访客：只读浏览；创始人：凭口令解锁 /api/manage/* 内容管理与发布
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ---------- 零依赖 .env 加载（本地开发便捷；生产用环境变量注入） ----------
(function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const db = require('./db');
const manageAuth = require('./manage-auth');
const ai = require('./ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: (origin, callback) => {
    const allowed = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : [];
    if (!origin || allowed.length === 0 || allowed.includes(origin) || allowed.includes('*')) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: false,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json({ limit: '12mb' }));

// ---------- 工具 ----------
function toInt(v, d = 0) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function now() { return db.prepare("SELECT datetime('now') n").get().n; }

// ==========================================================
// 公开只读 API
// ==========================================================

// ---------- 书库：检索 / 筛选 / 分页 ----------
app.get('/api/books', (req, res) => {
  const { q = '', category = '', tag = '', page = 1, pageSize = 24 } = req.query;
  const clauses = [];
  const params = [];
  if (q) { clauses.push('(title LIKE ? OR author LIKE ? OR tags LIKE ? OR intro LIKE ? OR call_no LIKE ? OR isbn LIKE ?)'); const l = `%${q}%`; params.push(l, l, l, l, l, l); }
  if (category) { clauses.push('category=?'); params.push(category); }
  if (tag) { clauses.push('tags LIKE ?'); params.push(`%${tag}%`); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM books ${where}`).get(...params).c;
  const pp = Math.min(toInt(pageSize, 24), 100);
  const off = (toInt(page, 1) - 1) * pp;
  const rows = db.prepare(`SELECT * FROM books ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pp, off);
  const cats = db.prepare("SELECT DISTINCT category FROM books WHERE category IS NOT NULL AND category<>''").all().map(r => r.category);
  res.json({ total, page: toInt(page, 1), pageSize: pp, books: rows, categories: cats });
});

app.get('/api/categories', (req, res) => {
  const rows = db.prepare("SELECT category, COUNT(*) c FROM books WHERE category IS NOT NULL AND category<>'' GROUP BY category ORDER BY c DESC").all();
  res.json({ categories: rows.map(r => ({ category: r.category, count: r.c })) });
});

// 星空数据：全部书籍（首页知识星空 / 3D 星系）
app.get('/api/stars', (req, res) => {
  const q = req.query.q || '';
  const category = req.query.category || '';
  const clauses = []; const params = [];
  if (q) { clauses.push('(title LIKE ? OR author LIKE ? OR tags LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { clauses.push('category=?'); params.push(category); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`SELECT id, title, author, category, tags, call_no FROM books ${where} ORDER BY id`).all(...params);
  res.json({ stars: rows });
});

// 平台概览（首页数据故事）
app.get('/api/overview', (req, res) => {
  const totalBooks = db.prepare('SELECT COUNT(*) c FROM books').get().c;
  const totalCopies = db.prepare('SELECT COALESCE(SUM(total),0) s FROM books').get().s;
  const worksCount = db.prepare('SELECT COUNT(*) c FROM works WHERE visible=1').get().c;
  const issues = db.prepare('SELECT COUNT(DISTINCT issue_no) c FROM works WHERE visible=1').get().c;
  const postsCount = db.prepare('SELECT COUNT(*) c FROM posts WHERE visible=1').get().c;
  const cats = db.prepare("SELECT category, COUNT(*) c FROM books WHERE category IS NOT NULL AND category<>'' GROUP BY category ORDER BY c DESC").all();
  res.json({ totalBooks, totalCopies, worksCount, issues, postsCount, categories: cats });
});

app.get('/api/books/:id', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
  if (!book) return res.status(404).json({ error: '未找到该书' });
  const related = db.prepare('SELECT * FROM books WHERE category=? AND id<>? LIMIT 6').all(book.category, book.id);
  res.json({ book, related });
});

// ---------- 摘星辰：公开读取 ----------
app.get('/api/works', (req, res) => {
  const { issue = '', code = '' } = req.query;
  const clauses = ['visible=1'];
  const params = [];
  if (issue) { clauses.push('issue_no=?'); params.push(toInt(issue, 0)); }
  if (code) { clauses.push('code=?'); params.push(code); }
  const rows = db.prepare(`SELECT id, code, issue_no, title, summary, members, type, payload, cover, tags, org, published_at
    FROM works WHERE ${clauses.join(' AND ')} ORDER BY issue_no DESC, sort DESC, id DESC`).all(...params);
  const issues = db.prepare('SELECT issue_no, COUNT(*) c FROM works WHERE visible=1 GROUP BY issue_no ORDER BY issue_no DESC').all();
  res.json({ works: rows, issues });
});
app.get('/api/works/:id', (req, res) => {
  const w = db.prepare('SELECT * FROM works WHERE id=? AND visible=1').get(req.params.id);
  if (!w) return res.status(404).json({ error: '未找到该作品' });
  const more = db.prepare('SELECT id, code, issue_no, title, cover FROM works WHERE visible=1 AND id<>? AND issue_no=? ORDER BY sort DESC, id DESC LIMIT 4')
    .all(w.id, w.issue_no);
  res.json({ work: w, related: more });
});

// ---------- 资讯：公开读取 ----------
app.get('/api/posts', (req, res) => {
  const { category = '' } = req.query;
  const clauses = ['visible=1'];
  const params = [];
  if (category) { clauses.push('category=?'); params.push(category); }
  const rows = db.prepare(`SELECT id, title, category, summary, cover, source_name, source_url, published_at
    FROM posts WHERE ${clauses.join(' AND ')} ORDER BY published_at DESC, sort DESC, id DESC`).all(...params);
  res.json({ posts: rows });
});
app.get('/api/posts/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id=? AND visible=1').get(req.params.id);
  if (!p) return res.status(404).json({ error: '未找到该资讯' });
  res.json({ post: p });
});

// ---------- 站点元信息 ----------
app.get('/api/meta', (req, res) => {
  const totalBooks = db.prepare('SELECT COUNT(*) c FROM books').get().c;
  const worksCount = db.prepare('SELECT COUNT(*) c FROM works WHERE visible=1').get().c;
  const postsCount = db.prepare('SELECT COUNT(*) c FROM posts WHERE visible=1').get().c;
  res.json({ totalBooks, worksCount, postsCount, version: '2.0.0-dh-platform' });
});

// ==========================================================
// 创始人管理 API
// ==========================================================

app.post('/api/manage/login', (req, res) => {
  const r = manageAuth.login(req.body?.passcode, req.ip);
  if (r.error) return res.status(401).json(r);
  res.json(r);
});

// 摘星辰作品 CRUD
const WORK_FIELDS = ['code', 'issue_no', 'title', 'summary', 'members', 'type', 'payload', 'cover', 'tags', 'org', 'sort', 'visible'];
function cleanWork(b, old) {
  const o = old || {};
  return {
    code: b.code ?? o.code ?? '',
    issue_no: toInt(b.issue_no ?? o.issue_no, 1),
    title: (b.title ?? o.title ?? '').trim(),
    summary: b.summary ?? o.summary ?? '',
    members: b.members ?? o.members ?? '',
    type: ['html', 'image', 'video', 'link'].includes(b.type) ? b.type : (o.type || 'link'),
    payload: b.payload ?? o.payload ?? '',
    cover: b.cover ?? o.cover ?? '',
    tags: b.tags ?? o.tags ?? '',
    org: b.org ?? o.org ?? '数文拾光协会',
    sort: toInt(b.sort ?? o.sort, 0),
    visible: b.visible != null ? (b.visible ? 1 : 0) : (o.visible != null ? o.visible : 1)
  };
}
app.get('/api/manage/works', manageAuth.requireFounder, (req, res) => {
  res.json({ works: db.prepare('SELECT * FROM works ORDER BY issue_no DESC, sort DESC, id DESC').all() });
});
app.post('/api/manage/works', manageAuth.requireFounder, (req, res) => {
  const w = cleanWork(req.body || {});
  if (!w.title) return res.status(400).json({ error: '作品标题必填' });
  const info = db.prepare(`INSERT INTO works (code,issue_no,title,summary,members,type,payload,cover,tags,org,sort,visible,published_at,updated_at)
    VALUES (@code,@issue_no,@title,@summary,@members,@type,@payload,@cover,@tags,@org,@sort,@visible,datetime('now'),datetime('now'))`).run(w);
  res.json({ work: db.prepare('SELECT * FROM works WHERE id=?').get(info.lastInsertRowid) });
});
app.put('/api/manage/works/:id', manageAuth.requireFounder, (req, res) => {
  const old = db.prepare('SELECT * FROM works WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '未找到该作品' });
  const w = cleanWork(req.body || {}, old);
  if (!w.title) return res.status(400).json({ error: '作品标题必填' });
  db.prepare(`UPDATE works SET code=@code,issue_no=@issue_no,title=@title,summary=@summary,members=@members,type=@type,
    payload=@payload,cover=@cover,tags=@tags,org=@org,sort=@sort,visible=@visible,updated_at=datetime('now') WHERE id=@id`)
    .run({ ...w, id: old.id });
  res.json({ work: db.prepare('SELECT * FROM works WHERE id=?').get(old.id) });
});
app.delete('/api/manage/works/:id', manageAuth.requireFounder, (req, res) => {
  const info = db.prepare('DELETE FROM works WHERE id=?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '未找到该作品' });
  res.json({ ok: true });
});

// 资讯 CRUD
const POST_FIELDS = ['title', 'category', 'summary', 'content', 'cover', 'source_name', 'source_url', 'sort', 'visible'];
function cleanPost(b, old) {
  const o = old || {};
  return {
    title: (b.title ?? o.title ?? '').trim(),
    category: b.category ?? o.category ?? '动态',
    summary: b.summary ?? o.summary ?? '',
    content: b.content ?? o.content ?? '',
    cover: b.cover ?? o.cover ?? '',
    source_name: b.source_name ?? o.source_name ?? '',
    source_url: b.source_url ?? o.source_url ?? '',
    sort: toInt(b.sort ?? o.sort, 0),
    visible: b.visible != null ? (b.visible ? 1 : 0) : (o.visible != null ? o.visible : 1)
  };
}
app.get('/api/manage/posts', manageAuth.requireFounder, (req, res) => {
  res.json({ posts: db.prepare('SELECT * FROM posts ORDER BY published_at DESC, sort DESC, id DESC').all() });
});
app.post('/api/manage/posts', manageAuth.requireFounder, (req, res) => {
  const p = cleanPost(req.body || {});
  if (!p.title) return res.status(400).json({ error: '资讯标题必填' });
  const info = db.prepare(`INSERT INTO posts (title,category,summary,content,cover,source_name,source_url,sort,visible,published_at,created_at,updated_at)
    VALUES (@title,@category,@summary,@content,@cover,@source_name,@source_url,@sort,@visible,
      COALESCE(@published_at, datetime('now')), datetime('now'), datetime('now'))`)
    .run({ ...p, published_at: (req.body && req.body.published_at) || null });
  res.json({ post: db.prepare('SELECT * FROM posts WHERE id=?').get(info.lastInsertRowid) });
});
app.put('/api/manage/posts/:id', manageAuth.requireFounder, (req, res) => {
  const old = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '未找到该资讯' });
  const p = cleanPost(req.body || {}, old);
  if (!p.title) return res.status(400).json({ error: '资讯标题必填' });
  db.prepare(`UPDATE posts SET title=@title,category=@category,summary=@summary,content=@content,cover=@cover,
    source_name=@source_name,source_url=@source_url,sort=@sort,visible=@visible,updated_at=datetime('now') WHERE id=@id`)
    .run({ ...p, id: old.id });
  res.json({ post: db.prepare('SELECT * FROM posts WHERE id=?').get(old.id) });
});
app.delete('/api/manage/posts/:id', manageAuth.requireFounder, (req, res) => {
  const info = db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '未找到该资讯' });
  res.json({ ok: true });
});

// ---------- 文件上传（multipart → public/media/） ----------
const MEDIA_DIR = path.join(__dirname, '../public/media');
const EXT_WHITELIST = { img: ['jpg', 'jpeg', 'png', 'webp', 'gif'], video: ['mp4', 'webm'], file: ['pdf', 'zip', 'html'] };
const EXT_LIMIT = { img: 8, video: 200, file: 50 }; // MB
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const kind = ['img', 'video', 'file'].includes(req.query.kind) ? req.query.kind : 'file';
    const ym = new Date().toISOString().slice(0, 7).replace('-', '');
    const dir = path.join(MEDIA_DIR, kind, ym);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = (path.extname(file.originalname || '').slice(1) || 'bin').toLowerCase();
    const name = Date.now().toString(36) + crypto.randomUUID().slice(0, 6) + '.' + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const kind = ['img', 'video', 'file'].includes(req.query.kind) ? req.query.kind : 'file';
    const ext = (path.extname(file.originalname || '').slice(1) || '').toLowerCase();
    if (!EXT_WHITELIST[kind].includes(ext)) return cb(new Error(`不支持的文件类型 .${ext}（${kind} 允许：${EXT_WHITELIST[kind].join('/')}）`));
    cb(null, true);
  }
});
app.post('/api/manage/upload', manageAuth.requireFounder, (req, res) => {
  const kind = ['img', 'video', 'file'].includes(req.query.kind) ? req.query.kind : 'file';
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: '上传失败：' + err.message });
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const rel = '/media/' + path.relative(MEDIA_DIR, req.file.path).replace(/\\/g, '/');
    res.json({ url: rel, size: req.file.size, kind });
  });
});

// ---------- 一键发布静态版 ----------
app.post('/api/publish', manageAuth.requireFounder, async (req, res) => {
  try {
    const publish = require('./publish'); // 惰性加载：发布模块失败不影响主服务
    const result = await publish.exportStatic();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: '发布失败：' + e.message });
  }
});

// ==========================================================
// AI 助手（检索 / 荐书 / 问答，无借阅）
// ==========================================================
app.post('/api/ai/ask', async (req, res) => {
  const q = (req.body?.question || '').toString().trim();
  try {
    const result = await ai.answer(q);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'AI 服务异常：' + e.message });
  }
});
app.get('/api/ai/status', (req, res) => { res.json(ai.status()); });
app.post('/api/ai/reset', (req, res) => { ai.resetSession(); res.json({ ok: true }); });
app.get('/api/ai/digest/:id', async (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
  if (!book) return res.status(404).json({ error: '未找到该书' });
  try {
    const result = await ai.digest(book);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '导读生成失败：' + e.message });
  }
});
app.get('/api/ai/search', (req, res) => {
  const q = (req.query.q || '').toString();
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 8));
  res.json({ books: ai.searchBooks(q, { limit }) });
});

// ---------- 静态资源（SPA） ----------
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders(res, filePath) {
    if (/\.(js|css|html)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
}));
// 封面走 /covers/<索书号>.jpg：文件缺失时返回 404，前端自动回退占位图
app.get(/^(?!\/api\/|\/covers\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  数文拾光 · 数字人文平台已启动`);
  console.log(`  ▶  http://localhost:${PORT}`);
  console.log(`  管理端：http://localhost:${PORT}/#/manage（口令见 .env 的 FOUNDER_PASSCODE）\n`);
});
