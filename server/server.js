'use strict';
// 数字人文平台服务端（本地主模式）
// 访客：只读浏览；创始人：凭口令解锁 /api/manage/* 内容管理与发布
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ---------- .env 加载（与 scripts/launch.js 共用同一实现，避免读法不一致） ----------
require('../scripts/env');

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const db = require('./db');
const manageAuth = require('./manage-auth');
const settings = require('./settings');
const validate = require('./validate');
const scanner = require('./works-scanner');
const covers = require('./covers');
const ai = require('./ai');

// 封面注入：covers/ 有真实图片的书补上 cover 字段，前端只对有值的书发 <img>（零 404）
function withCover(b) {
  if (b && !b.cover) { const u = covers.coverUrl(b.call_no); if (u) b.cover = u; }
  return b;
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

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

// ---------- 身份探针 ----------
// 启动器（scripts/launch.js）用它判断某个端口上跑的到底是不是本平台，
// 而不是「端口有监听就当成自己」—— 那会把别人的服务误认成平台。
app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ app: 'dh-platform', port: PORT, ver: require('../package.json').version, pid: process.pid });
});

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
  const rows = db.prepare(`SELECT * FROM books ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pp, off).map(withCover);
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
  const book = withCover(db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id));
  if (!book) return res.status(404).json({ error: '未找到该书' });
  const related = db.prepare('SELECT * FROM books WHERE category=? AND id<>? LIMIT 6').all(book.category, book.id).map(withCover);
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

// ---------- 馆藏图书 CRUD（v2.4：管理端直添数据） ----------
// 不加唯一索引：存量 696 条可能已有重复索书号，加索引会让服务起不来；去重靠查询。
// 索书号字符集刻意收紧（字母/数字/._-），因为它同时用作 public/covers/ 的封面文件名。
const CALL_NO_RE = /^[A-Za-z0-9._\-]{1,32}$/;

function cleanBook(b, old) {
  const o = old || {};
  const callNo = String(b.call_no ?? o.call_no ?? '').trim();
  if (callNo && !CALL_NO_RE.test(callNo)) {
    return { error: '索书号只允许字母、数字、点、下划线、短横线（≤32 位）——它同时用作封面文件名' };
  }
  const total = Math.max(0, toInt(b.total ?? o.total, 1));
  const available = Math.min(Math.max(0, toInt(b.available ?? o.available, total)), total);
  return {
    call_no: callNo,
    isbn: String(b.isbn ?? o.isbn ?? '').trim(),
    title: String(b.title ?? o.title ?? '').trim(),
    author: String(b.author ?? o.author ?? '').trim(),
    publisher: String(b.publisher ?? o.publisher ?? '').trim(),
    year: String(b.year ?? o.year ?? '').trim(),
    price: String(b.price ?? o.price ?? '').trim(),
    category: String(b.category ?? o.category ?? '').trim(),
    tags: String(b.tags ?? o.tags ?? '').trim(),
    cover: validate.assetPath(b.cover ?? o.cover ?? '') || '',
    location: String(b.location ?? o.location ?? '').trim(),
    intro: String(b.intro ?? o.intro ?? ''),
    total, available
  };
}
function bookRow(id) { return withCover(db.prepare('SELECT * FROM books WHERE id=?').get(id)); }

app.get('/api/manage/books', manageAuth.requireFounder, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const page = Math.max(1, toInt(req.query.page, 1));
  const pageSize = Math.min(100, Math.max(5, toInt(req.query.pageSize, 20)));
  let where = '', params = [];
  if (q) {
    const like = '%' + q.replace(/([%_\\])/g, '\\$1') + '%';
    where = `WHERE LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(IFNULL(author,'')) LIKE ? ESCAPE '\\'
      OR LOWER(IFNULL(call_no,'')) LIKE ? ESCAPE '\\' OR LOWER(IFNULL(tags,'')) LIKE ? ESCAPE '\\'`;
    params = [like, like, like, like];
  }
  const total = db.prepare(`SELECT COUNT(*) c FROM books ${where}`).get(...params).c;
  const items = db.prepare(`SELECT * FROM books ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize).map(withCover);
  res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) });
});

app.post('/api/manage/books', manageAuth.requireFounder, (req, res) => {
  const b = cleanBook(req.body || {});
  if (b.error) return res.status(400).json({ error: b.error });
  if (!b.title) return res.status(400).json({ error: '书名必填' });
  if (b.call_no) {
    const dup = db.prepare('SELECT id FROM books WHERE call_no=?').get(b.call_no);
    if (dup) return res.status(409).json({ error: `索书号 ${b.call_no} 已存在（id=${dup.id}），修改请用「编辑」` });
  }
  const info = db.prepare(`INSERT INTO books (call_no,isbn,title,author,publisher,year,price,category,tags,cover,location,intro,total,available)
    VALUES (@call_no,@isbn,@title,@author,@publisher,@year,@price,@category,@tags,@cover,@location,@intro,@total,@available)`).run(b);
  res.json({ book: bookRow(info.lastInsertRowid) });
});

app.put('/api/manage/books/:id', manageAuth.requireFounder, (req, res) => {
  const old = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '未找到该书' });
  const b = cleanBook(req.body || {}, old);
  if (b.error) return res.status(400).json({ error: b.error });
  if (!b.title) return res.status(400).json({ error: '书名必填' });
  if (b.call_no) {
    const dup = db.prepare('SELECT id FROM books WHERE call_no=? AND id<>?').get(b.call_no, old.id);
    if (dup) return res.status(409).json({ error: `索书号 ${b.call_no} 已被 id=${dup.id} 使用` });
  }
  db.prepare(`UPDATE books SET call_no=@call_no,isbn=@isbn,title=@title,author=@author,publisher=@publisher,year=@year,
    price=@price,category=@category,tags=@tags,cover=@cover,location=@location,intro=@intro,total=@total,available=@available
    WHERE id=@id`).run({ ...b, id: old.id });
  res.json({ book: bookRow(old.id) });
});

app.delete('/api/manage/books/:id', manageAuth.requireFounder, (req, res) => {
  const info = db.prepare('DELETE FROM books WHERE id=?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '未找到该书' });
  res.json({ ok: true });
});

// 批量导入：{ rows:[...] } 直接用，或 { text, format:'json'|'csv' } 先解析。
// 幂等：索书号相同 → 更新（不动封面/复本数），否则新增。
const CSV_HEAD = ['索书号', '书名', '作者', '出版社', '年份', '定价', '分类', '标签', '馆藏位置', '简介'];
function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',' || ch === '\t') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
function parseBookRows(body) {
  if (Array.isArray(body.rows)) return { rows: body.rows, errors: [] };
  const text = String(body.text || '');
  if (!text.trim()) return { rows: [], errors: ['内容为空'] };
  if (body.format === 'csv' || (!body.format && !text.trim().startsWith('['))) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const header = parseCsvLine(lines.shift() || '');
    const idx = {};
    header.forEach((h, i) => { const k = CSV_HEAD.indexOf(h.replace(/\s/g, '')); if (k >= 0) idx[CSV_HEAD[k]] = i; });
    if (idx['书名'] === undefined) {
      return { rows: [], errors: [`CSV 首行需含「书名」列。表头示例：${CSV_HEAD.join(',')}`] };
    }
    const pick = (c, name) => idx[name] !== undefined ? (c[idx[name]] || '') : '';
    const rows = [], errors = [];
    lines.forEach((line, ln) => {
      const c = parseCsvLine(line);
      if (!c.some(x => x)) return;
      const title = pick(c, '书名');
      if (!title) { errors.push(`第 ${ln + 2} 行缺少书名，已跳过`); return; }
      rows.push({
        call_no: pick(c, '索书号'), title,
        author: pick(c, '作者'), publisher: pick(c, '出版社'), year: pick(c, '年份'),
        price: pick(c, '定价'), category: pick(c, '分类'), tags: pick(c, '标签'),
        location: pick(c, '馆藏位置'), intro: pick(c, '简介')
      });
    });
    return { rows, errors };
  }
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return { rows: [], errors: ['JSON 需为数组，如 [{"call_no":"I1-01","title":"…"}]'] };
    return { rows: arr, errors: [] };
  } catch (e) { return { rows: [], errors: ['JSON 解析失败：' + e.message] }; }
}

app.post('/api/manage/books/import', manageAuth.requireFounder, (req, res) => {
  const { rows, errors } = parseBookRows(req.body || {});
  let created = 0, updated = 0, skipped = 0;
  const fail = [...errors];
  const ins = db.prepare(`INSERT INTO books (call_no,isbn,title,author,publisher,year,price,category,tags,cover,location,intro,total,available)
    VALUES (@call_no,@isbn,@title,@author,@publisher,@year,@price,@category,@tags,@cover,@location,@intro,@total,@available)`);
  const upd = db.prepare(`UPDATE books SET title=@title,author=@author,publisher=@publisher,year=@year,price=@price,
    category=@category,tags=@tags,location=@location,intro=@intro WHERE id=@id`);
  db.transaction((list) => {
    for (const raw of list) {
      const b = cleanBook(raw);
      if (b.error || !b.title) {
        skipped++;
        if (fail.length < 5) fail.push(`「${String(raw.title || raw.call_no || '(无书名)')}」：${b.error || '缺少书名'}`);
        continue;
      }
      const dup = b.call_no ? db.prepare('SELECT id FROM books WHERE call_no=?').get(b.call_no) : null;
      if (dup) { upd.run({ ...b, id: dup.id }); updated++; }
      else { ins.run(b); created++; }
    }
  })(rows);
  res.json({ created, updated, skipped, errors: fail, total: rows.length });
});

// 图书封面专用通道：直接落 public/covers/<索书号>.<ext>，写完即时刷新索引
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = (path.extname(file.originalname || '').slice(1) || '').toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return cb(new Error('封面只支持 jpg / png / webp'));
    if (file.mimetype && !/^image\/(jpeg|png|webp)$/i.test(file.mimetype)) return cb(new Error('封面内容类型不匹配'));
    cb(null, true);
  }
});
app.post('/api/manage/books/cover', manageAuth.requireFounder, (req, res) => {
  const callNo = String(req.query.call_no || '').trim();
  if (!CALL_NO_RE.test(callNo)) {
    return res.status(400).json({ error: '需先填写合法索书号（字母/数字/._-，≤32 位）再上传封面' });
  }
  coverUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: '封面上传失败：' + (err.code === 'LIMIT_FILE_SIZE' ? '超过 5MB' : err.message) });
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const head = req.file.buffer.subarray(0, 16);
    const isImg = (head[0] === 0xFF && head[1] === 0xD8)                    // jpg
      || (head[0] === 0x89 && head[1] === 0x50)                             // png
      || (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP');
    if (!isImg) return res.status(400).json({ error: '文件内容与图片类型不符，已拒绝' });
    const ext = (path.extname(req.file.originalname || '').slice(1) || 'jpg').toLowerCase().replace('jpeg', 'jpg');
    fs.mkdirSync(covers.COVERS_DIR, { recursive: true });
    // 同索书号换格式时清掉旧文件，避免索引歧义
    for (const f of fs.readdirSync(covers.COVERS_DIR)) {
      if (f.startsWith(callNo + '.') && f.toLowerCase() !== `${callNo}.${ext}`) {
        try { fs.unlinkSync(path.join(covers.COVERS_DIR, f)); } catch (e) {}
      }
    }
    fs.writeFileSync(path.join(covers.COVERS_DIR, `${callNo}.${ext}`), req.file.buffer);
    covers.invalidate();
    res.json({ url: `/covers/${callNo}.${ext}`, size: req.file.size, call_no: callNo });
  });
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

// ---------- HTML 作品直传（v2.4：上传即建 public/works/<期号-代号-标题>/ 目录） ----------
// 只收创始人上传；阅读页始终以 iframe sandbox 运行。
// 安全说明：/works/*.html 与站点同源（与手工放置的目录一致），不做额外隔离——README 有注明。
const WORKS_DIR = path.join(__dirname, '../public/works');
const workHtmlUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 21 },
  fileFilter(req, file, cb) {
    const ext = (path.extname(file.originalname || '').slice(1) || '').toLowerCase();
    if (file.fieldname === 'file') {
      if (!['html', 'htm'].includes(ext)) return cb(new Error('作品主文件只支持 .html / .htm'));
      if (file.mimetype && !/^text\/html/i.test(file.mimetype) && file.mimetype !== 'application/octet-stream') {
        return cb(new Error('主文件内容类型需为 text/html'));
      }
    } else if (file.fieldname === 'assets') {
      if (/[\\/\u0000-\u001f]/.test(file.originalname || '')) return cb(new Error('资源文件名不允许包含路径分隔符'));
    }
    cb(null, true);
  }
});

function slugify(s, max = 40) {
  return String(s || '')
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[.\-_]+|[.\-_]+$/g, '')
    .slice(0, max) || '未命名';
}

app.post('/api/manage/works/upload-html', manageAuth.requireFounder, (req, res) => {
  workHtmlUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'assets', maxCount: 20 }])(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: '上传失败：' + (err.code === 'LIMIT_FILE_SIZE' ? '超过 20MB 上限' : err.message) });
    }
    const main = req.files && req.files.file && req.files.file[0];
    if (!main) return res.status(400).json({ error: '未收到 HTML 主文件' });
    const head = main.buffer.subarray(0, 2048).toString('utf-8').toLowerCase();
    if (!(/<!doctype html/.test(head) || /<html[\s>]/.test(head) || /<meta[\s>]/.test(head) || /<script[\s>]/.test(head))) {
      return res.status(400).json({ error: '文件不像 HTML（头部缺少 doctype / html / meta / script），已拒绝' });
    }
    const body = req.body || {};
    const title = String(body.title || '').trim()
      || ((head.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i) || [])[1] || '').trim()
      || '未命名作品';
    const code = String(body.code || '').trim();
    const issue = Math.max(1, Math.min(99, toInt(body.issue_no, 1)));

    // 目录名与扫描器约定一致：NN-代号-标题（重名自动 -2、-3）
    const base = `${String(issue).padStart(2, '0')}-${slugify(code || '未名星', 20)}-${slugify(title)}`;
    let dir = base, seq = 2;
    while (fs.existsSync(path.join(WORKS_DIR, dir))) dir = `${base}-${seq++}`;

    const destDir = path.join(WORKS_DIR, dir);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, 'index.html'), main.buffer);
    const savedAssets = [];
    if ((req.files.assets || []).length) {
      const assetsDir = path.join(destDir, 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });
      for (const f of req.files.assets) {
        const name = String(f.originalname || '').replace(/[\\/\u0000-\u001f]/g, '_');
        fs.writeFileSync(path.join(assetsDir, name), f.buffer);
        savedAssets.push('assets/' + name);
      }
    }
    const meta = {
      code, issue_no: issue, title,
      summary: String(body.summary || ''),
      members: String(body.members || ''),
      tags: String(body.tags || ''),
      published_at: body.published_at || new Date().toISOString().slice(0, 10),
      mode: body.mode === 'window' ? 'window' : 'embed',
      sort: toInt(body.sort, 10),
      visible: (body.visible === '0' || body.visible === 0 || body.visible === 'false') ? 0 : 1
    };
    fs.writeFileSync(path.join(destDir, 'work.json'), JSON.stringify(meta, null, 2), 'utf-8');

    let scanResult = null;
    try { scanResult = scanner.scan({}); } catch (e) { scanResult = { error: e.message }; }
    const sourceKey = `works/${dir}/index.html`.replace(/\\/g, '/').normalize('NFC');
    const work = db.prepare('SELECT * FROM works WHERE source_key=?').get(sourceKey) || null;
    res.json({ ok: true, dir: 'public/works/' + dir, assets: savedAssets, work, scan: scanResult });
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
    console.error(`    不用手改配置：双击「启动平台.bat」或「数文拾光.vbs」，`);
    console.error(`    启动器会先探测该端口上是不是本平台，不是就自动换到 3001/3002…`);
    console.error(`    想手动停掉占用者：双击「停止平台.bat」\n`);
    process.exit(1);
  }
  throw e;
});
