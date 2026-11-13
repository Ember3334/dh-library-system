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
const settings = require('./settings');
const validate = require('./validate');
const scanner = require('./works-scanner');
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

// 上传限额（MB）：图片 8 / 视频 200 / 其他 50
const UPLOAD_LIMIT_MB = { img: 8, video: 200, file: 50 };

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
  const rows = db.prepare(`SELECT id, code, issue_no, title, summary, members, type, payload, cover, tags, org, published_at, mode
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
  res.json({
    totalBooks, worksCount, postsCount,
    version: '2.1.0-dh-platform',
    uploadLimits: UPLOAD_LIMIT_MB,
    worksDir: 'public/works/'
  });
});

// ---------- 站点文案（公开读，管理端写） ----------
app.get('/api/settings', (req, res) => {
  res.json({ settings: settings.mergedSettings() });
});
app.get('/api/manage/settings', manageAuth.requireFounder, (req, res) => {
  res.json({ settings: settings.mergedSettings(), schema: settings.SCHEMA });
});
app.put('/api/manage/settings', manageAuth.requireFounder, (req, res) => {
  try {
    const saved = settings.saveSettings(req.body || {});
    res.json({ ok: true, saved, settings: settings.mergedSettings() });
  } catch (e) {
    res.status(400).json({ error: '保存失败：' + e.message });
  }
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
function cleanWork(b, old) {
  const o = old || {};
  const type = ['html', 'image', 'video', 'link'].includes(b.type) ? b.type : (o.type || 'link');
  const chk = validate.payload(type, b.payload ?? o.payload ?? '');
  if (chk.error) return { error: chk.error };
  return {
    code: b.code ?? o.code ?? '',
    issue_no: toInt(b.issue_no ?? o.issue_no, 1),
    title: (b.title ?? o.title ?? '').trim(),
    summary: b.summary ?? o.summary ?? '',
    members: b.members ?? o.members ?? '',
    type,
    payload: chk.value,
    cover: validate.assetPath(b.cover ?? o.cover ?? '') || '',
    tags: b.tags ?? o.tags ?? '',
    org: b.org ?? o.org ?? '数文拾光协会',
    sort: toInt(b.sort ?? o.sort, 0),
    visible: b.visible != null ? (b.visible ? 1 : 0) : (o.visible != null ? o.visible : 1),
    // 运行模式：embed = 沙箱内嵌 | window = 只允许新窗口打开（需要 localStorage/模块的复杂作品）
    mode: ['embed', 'window'].includes(b.mode) ? b.mode : (o.mode || 'embed'),
    published_at: b.published_at ?? o.published_at ?? null
  };
}
app.get('/api/manage/works', manageAuth.requireFounder, (req, res) => {
  res.json({ works: db.prepare('SELECT * FROM works ORDER BY issue_no DESC, sort DESC, id DESC').all() });
});
app.post('/api/manage/works', manageAuth.requireFounder, (req, res) => {
  const w = cleanWork(req.body || {});
  if (w.error) return res.status(400).json({ error: w.error });
  if (!w.title) return res.status(400).json({ error: '作品标题必填' });
  const info = db.prepare(`INSERT INTO works (code,issue_no,title,summary,members,type,payload,cover,tags,org,sort,visible,mode,published_at,updated_at)
    VALUES (@code,@issue_no,@title,@summary,@members,@type,@payload,@cover,@tags,@org,@sort,@visible,@mode,
      COALESCE(@published_at, datetime('now')),datetime('now'))`).run(w);
  res.json({ work: db.prepare('SELECT * FROM works WHERE id=?').get(info.lastInsertRowid) });
});
app.put('/api/manage/works/:id', manageAuth.requireFounder, (req, res) => {
  const old = db.prepare('SELECT * FROM works WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '未找到该作品' });
  const w = cleanWork(req.body || {}, old);
  if (w.error) return res.status(400).json({ error: w.error });
  if (!w.title) return res.status(400).json({ error: '作品标题必填' });
  db.prepare(`UPDATE works SET code=@code,issue_no=@issue_no,title=@title,summary=@summary,members=@members,type=@type,
    payload=@payload,cover=@cover,tags=@tags,org=@org,sort=@sort,visible=@visible,mode=@mode,
    published_at=COALESCE(@published_at, published_at), updated_at=datetime('now') WHERE id=@id`)
    .run({ ...w, id: old.id });
  res.json({ work: db.prepare('SELECT * FROM works WHERE id=?').get(old.id) });
});
app.delete('/api/manage/works/:id', manageAuth.requireFounder, (req, res) => {
  const info = db.prepare('DELETE FROM works WHERE id=?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '未找到该作品' });
  res.json({ ok: true });
});

// 重新扫描作品目录（public/works/）
app.post('/api/manage/works/rescan', manageAuth.requireFounder, (req, res) => {
  try {
    const r = scanner.scan({ prune: !!req.body?.prune });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: '扫描失败：' + e.message });
  }
});

// 资讯 CRUD
function cleanPost(b, old) {
  const o = old || {};
  const chk = validate.url(b.source_url ?? o.source_url ?? '', { allowEmpty: true });
  if (chk.error) return { error: chk.error };
  return {
    title: (b.title ?? o.title ?? '').trim(),
    category: b.category ?? o.category ?? '动态',
    summary: b.summary ?? o.summary ?? '',
    content: b.content ?? o.content ?? '',
    cover: validate.assetPath(b.cover ?? o.cover ?? '') || '',
    source_name: b.source_name ?? o.source_name ?? '',
    source_url: chk.value,
    sort: toInt(b.sort ?? o.sort, 0),
    visible: b.visible != null ? (b.visible ? 1 : 0) : (o.visible != null ? o.visible : 1)
  };
}
app.get('/api/manage/posts', manageAuth.requireFounder, (req, res) => {
  res.json({ posts: db.prepare('SELECT * FROM posts ORDER BY published_at DESC, sort DESC, id DESC').all() });
});
app.post('/api/manage/posts', manageAuth.requireFounder, (req, res) => {
  const p = cleanPost(req.body || {});
  if (p.error) return res.status(400).json({ error: p.error });
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
  if (p.error) return res.status(400).json({ error: p.error });
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
// 注意：html 已从媒体白名单移除 —— /media/*.html 与站点同源，能直接读管理 token；
// 作品 HTML 统一走 public/works/ + 阅读页沙箱通道。
const EXT_WHITELIST = {
  img: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  video: ['mp4', 'webm', 'mov'],
  file: ['pdf', 'zip', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md']
};
const MIME_WHITELIST = {
  img: /^image\/(jpeg|png|webp|gif)$/i,
  video: /^video\/(mp4|webm|quicktime)$/i,
  file: /^(application\/(pdf|zip|msword|vnd\.openxmlformats-officedocument\..+|vnd\.ms-(excel|powerpoint))|text\/(plain|markdown))$/i
};

// 魔数嗅探：只按扩展名判断太容易被改名绕过
const MAGIC = [
  { kind: 'jpg', bytes: [0xFF, 0xD8, 0xFF] },
  { kind: 'png', bytes: [0x89, 0x50, 0x4E, 0x47] },
  { kind: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { kind: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { kind: 'zip', bytes: [0x50, 0x4B, 0x03, 0x04] },
  { kind: 'ole', bytes: [0xD0, 0xCF, 0x11, 0xE0] }
];
function sniff(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    if (n < 4) return null;
    const head = buf.subarray(0, Math.min(n, 16));
    if (head.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
    if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
    if (head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3) return 'webm';
    const hit = MAGIC.find(m => m.bytes.every((b, i) => head[i] === b));
    return hit ? hit.kind : null;
  } catch (e) { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (e) {} }
}
const MAGIC_OK = {
  img: ['jpg', 'png', 'gif', 'webp'],
  video: ['mp4', 'webm'],
  file: ['pdf', 'zip', 'ole']
};

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
// multer 的 fileSize 在构造时固化、无法在 fileFilter 里改 → 按 kind 建 3 个实例
function makeUploader(kind) {
  return multer({
    storage,
    limits: { fileSize: UPLOAD_LIMIT_MB[kind] * 1024 * 1024 },
    fileFilter(req, file, cb) {
      const ext = (path.extname(file.originalname || '').slice(1) || '').toLowerCase();
      if (!EXT_WHITELIST[kind].includes(ext)) {
        return cb(new Error(`不支持的文件类型 .${ext || '(无扩展名)'}（${kind} 允许：${EXT_WHITELIST[kind].join('/')}）`));
      }
      if (file.mimetype && !MIME_WHITELIST[kind].test(file.mimetype)) {
        return cb(new Error(`文件内容类型不匹配（${file.mimetype}）`));
      }
      cb(null, true);
    }
  });
}
const UPLOADERS = { img: makeUploader('img'), video: makeUploader('video'), file: makeUploader('file') };

app.post('/api/manage/upload', manageAuth.requireFounder, (req, res) => {
  const kind = ['img', 'video', 'file'].includes(req.query.kind) ? req.query.kind : 'file';
  UPLOADERS[kind].single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `文件超过 ${UPLOAD_LIMIT_MB[kind]}MB 上限（${kind}）`
        : err.message;
      return res.status(400).json({ error: '上传失败：' + msg });
    }
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    // 落盘后再验一次真实类型；不符立即删除
    const actual = sniff(req.file.path);
    if (!MAGIC_OK[kind].includes(actual)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: `文件内容与类型不符（识别为 ${actual || '未知'}），已拒绝` });
    }
    const rel = '/media/' + path.relative(MEDIA_DIR, req.file.path).replace(/\\/g, '/');
    res.json({ url: rel, size: req.file.size, kind, limitMB: UPLOAD_LIMIT_MB[kind] });
  });
});

// ---------- 媒体库 ----------
function walkMedia(dir, base, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMedia(full, base, out);
    else if (ent.isFile() && !ent.name.startsWith('.')) {
      const st = fs.statSync(full);
      out.push({
        path: '/' + path.relative(base, full).replace(/\\/g, '/'),
        size: st.size, mtime: st.mtime.toISOString()
      });
    }
  }
}
function mediaRefs() {
  // 引用计数：works.payload/cover + posts.cover/content/摘要中的路径
  const map = new Map();
  const bump = (txt) => {
    if (!txt) return;
    const m = String(txt).match(/\/media\/[^\s"'<>)\]]+/g) || [];
    m.forEach(p => map.set(decodeURIComponent(p), (map.get(decodeURIComponent(p)) || 0) + 1));
  };
  db.prepare('SELECT payload, cover FROM works').all().forEach(r => { bump(r.payload); bump(r.cover); });
  db.prepare('SELECT cover, content FROM posts').all().forEach(r => { bump(r.cover); bump(r.content); });
  return map;
}
app.get('/api/manage/media', manageAuth.requireFounder, (req, res) => {
  const files = [];
  walkMedia(MEDIA_DIR, path.join(__dirname, '../public'), files);
  const refs = mediaRefs();
  const list = files.map(f => ({ ...f, refs: refs.get(f.path) || 0 })).sort((a, b) => b.mtime.localeCompare(a.mtime));
  res.json({ files: list, totalBytes: list.reduce((a, f) => a + f.size, 0), dir: '/media/' });
});
app.delete('/api/manage/media', manageAuth.requireFounder, (req, res) => {
  const p = String(req.query.path || '');
  if (!p.startsWith('/media/') || p.includes('..')) return res.status(400).json({ error: '非法路径' });
  const full = path.join(path.join(__dirname, '../public'), p.replace(/^\//, ''));
  if (!full.startsWith(MEDIA_DIR) || !fs.existsSync(full)) return res.status(404).json({ error: '文件不存在' });
  const refs = mediaRefs().get(p) || 0;
  if (refs > 0 && req.query.force !== '1') {
    return res.status(409).json({ error: `该文件仍被 ${refs} 处内容引用，确认要删除请加 force=1`, refs });
  }
  fs.unlinkSync(full);
  res.json({ ok: true });
});

// ---------- 资讯辅助录入：抓取网页标题/摘要/来源 ----------
const PRIVATE_IP = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc|fd|fe80)/i;
app.post('/api/manage/fetch-link', manageAuth.requireFounder, async (req, res) => {
  const raw = String(req.body?.url || '').trim();
  const chk = validate.url(raw);
  if (chk.error) return res.status(400).json({ error: chk.error });
  let u;
  try { u = new URL(chk.value); } catch (e) { return res.status(400).json({ error: '链接格式不正确' }); }
  try {
    // 防 SSRF：解析后拒绝内网地址
    const dns = require('dns').promises;
    const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
    if (!addrs.length) return res.status(400).json({ error: '域名解析失败' });
    if (addrs.some(a => PRIVATE_IP.test(a.address))) return res.status(400).json({ error: '不允许抓取内网地址' });

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(u.href, {
      signal: ctl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShuWenDH/2.1; +local)', 'Accept': 'text/html,application/xhtml+xml' }
    });
    clearTimeout(timer);
    if (!r.ok) return res.status(400).json({ error: `目标站点返回 ${r.status}` });
    const ct = r.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) return res.status(400).json({ error: '目标不是网页（' + ct + '）' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 512 * 1024) return res.status(400).json({ error: '页面过大（>512KB）' });

    let html = buf.toString('utf-8');
    const cs = (ct.match(/charset=([\w-]+)/i) || [])[1]
      || (html.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
    if (cs && !/^utf-?8$/i.test(cs)) {
      try { html = new TextDecoder(cs.toLowerCase()).decode(buf); } catch (e) {}
    }
    const pick = (re) => { const m = html.match(re); return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : ''; };
    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i)
      || pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const summary = pick(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']*)["']/i)
      || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["'](?:og:description|description)["']/i);
    const siteName = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
    const pub = pick(/<meta[^>]+(?:property|name)=["'](?:article:published_time|publishdate|pubdate)["'][^>]+content=["']([^"']+)["']/i);
    res.json({
      url: u.href, title, summary: summary.slice(0, 300),
      source_name: siteName || u.hostname.replace(/^www\./, ''),
      published_at: (pub.match(/\d{4}-\d{2}-\d{2}/) || [''])[0]
    });
  } catch (e) {
    res.status(400).json({ error: e.name === 'AbortError' ? '抓取超时（8 秒）' : '抓取失败：' + e.message });
  }
});
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// ---------- 一键发布静态版 ----------
app.post('/api/manage/snapshot', manageAuth.requireFounder, (req, res) => {
  try {
    const snap = require('./snapshot');
    res.json({ ok: true, ...snap.write({ slim: !!req.body?.slim }) });
  } catch (e) {
    res.status(500).json({ error: '生成快照失败：' + e.message });
  }
});

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

// 启动时扫一次作品目录（失败不影响服务）
try {
  const r = scanner.scan();
  if (r.created || r.updated || r.missing) {
    console.log(`[works] 扫描 public/works/：新增 ${r.created} · 更新 ${r.updated} · 缺失 ${r.missing}`);
  }
} catch (e) {
  console.warn('[works] 作品目录扫描失败（不影响启动）：', e.message);
}

const server = app.listen(PORT, () => {
  console.log(`\n  数文拾光 · 数字人文平台已启动`);
  console.log(`  ▶  http://localhost:${PORT}`);
  console.log(`  管理端：http://localhost:${PORT}/#/manage（口令见项目根目录 .env 的 FOUNDER_PASSCODE）`);
  console.log(`  作品目录：public/works/（放入 HTML 后重启即自动上架）\n`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ✗ 端口 ${PORT} 已被占用。`);
    console.error(`    · 可能已有一个「数字人文平台」在跑 → 先打开 http://localhost:${PORT} 看看`);
    console.error(`    · 或关掉占用端口的旧窗口/进程后重试`);
    console.error(`    · 或在本目录 .env 里加一行 PORT=3001 换端口\n`);
    process.exit(1);
  }
  throw e;
});
