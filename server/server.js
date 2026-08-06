'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { router: authRouter, requireAuth, requireRole, publicUser } = require('./auth');
const ai = require('./ai');

const app = express();
const PORT = process.env.PORT || 3000;

// 支持静态 HTML/文件协议访问远程后端：默认允许任意来源（演示用），生产可设 CORS_ORIGIN 限制
const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : [];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: false,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json({ limit: '12mb' }));
app.use('/api/auth', authRouter);

// ---------- 工具 ----------
function toInt(v, d = 0) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }

// 标记逾期
function markOverdue() {
  db.prepare(`UPDATE borrows SET status='逾期' WHERE status='借出' AND datetime(due_date) < datetime('now')`).run();
}

// ---------- 图书：检索 / 筛选 / 分页 ----------
app.get('/api/books', (req, res) => {
  const { q = '', category = '', tag = '', available = '', page = 1, pageSize = 24 } = req.query;
  const clauses = [];
  const params = [];
  if (q) { clauses.push('(title LIKE ? OR author LIKE ? OR tags LIKE ? OR intro LIKE ? OR call_no LIKE ? OR isbn LIKE ?)'); const l = `%${q}%`; params.push(l, l, l, l, l, l); }
  if (category) { clauses.push('category=?'); params.push(category); }
  if (tag) { clauses.push('tags LIKE ?'); params.push(`%${tag}%`); }
  if (available === '1') { clauses.push('available>0'); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM books ${where}`).get(...params).c;
  const pp = Math.min(toInt(pageSize, 24), 100);
  const off = (toInt(page, 1) - 1) * pp;
  const rows = db.prepare(`SELECT * FROM books ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pp, off);
  const cats = db.prepare("SELECT DISTINCT category FROM books WHERE category IS NOT NULL AND category<>''").all().map(r => r.category);
  res.json({ total, page: toInt(page, 1), pageSize: pp, books: rows, categories: cats });
});

// ---------- 图书：分类导航（带计数，公开） ----------
app.get('/api/categories', (req, res) => {
  const rows = db.prepare("SELECT category, COUNT(*) c FROM books WHERE category IS NOT NULL AND category<>'' GROUP BY category ORDER BY c DESC").all();
  res.json({ categories: rows.map(r => ({ category: r.category, count: r.c })) });
});

// ---------- 星空数据：返回全部书籍用于首页知识星空（公开） ----------
app.get('/api/stars', (req, res) => {
  const q = req.query.q || '';
  const category = req.query.category || '';
  const clauses = []; const params = [];
  if (q) { clauses.push('(title LIKE ? OR author LIKE ? OR tags LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { clauses.push('category=?'); params.push(category); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`SELECT id, title, author, category, tags, call_no, available, total FROM books ${where} ORDER BY id`).all(...params);
  res.json({ stars: rows });
});

// ---------- 公开排行榜（图书流动数据，匿名化读者） ----------
app.get('/api/rankings', (req, res) => {
  markOverdue();
  // 热门榜：被借次数最多的书
  const hot = db.prepare(`SELECT b.id, b.title, b.author, b.category, COUNT(r.id) c
    FROM books b LEFT JOIN borrows r ON b.id=r.book_id AND r.status IN ('借出','已还','逾期','待取书')
    GROUP BY b.id ORDER BY c DESC LIMIT 10`).all();
  // 冷门榜：被借次数最少的书（只显示 total>0 且有记录的，避免从未被借的新书）
  const cold = db.prepare(`SELECT b.id, b.title, b.author, b.category, COUNT(r.id) c
    FROM books b LEFT JOIN borrows r ON b.id=r.book_id AND r.status IN ('借出','已还','逾期','待取书')
    GROUP BY b.id ORDER BY c ASC, b.id DESC LIMIT 10`).all();
  // 借阅之星：匿名化名
  const readers = db.prepare(`SELECT u.id, u.name, u.dept, COUNT(r.id) c
    FROM users u JOIN borrows r ON u.id=r.user_id AND r.status IN ('借出','已还','逾期','待取书')
    WHERE u.role='读者' GROUP BY u.id ORDER BY c DESC LIMIT 10`).all();
  const masked = readers.map((u, i) => ({
    rank: i + 1,
    displayName: maskName(u.name || u.id),
    dept: u.dept || '数字人文学院',
    count: u.c
  }));
  // 好评榜：按评论情感均分排序
  const reviewTop = db.prepare(`SELECT b.id, b.title, b.author, b.category, ROUND(AVG(c.sentiment),2) avg, COUNT(c.id) n
    FROM books b JOIN comments c ON b.id=c.book_id GROUP BY b.id HAVING n>=1
    ORDER BY avg DESC LIMIT 10`).all();
  res.json({ hot, cold, readers: masked, reviewTop, demo: db.hasDemo });
});

function maskName(name) {
  if (!name) return '数字人文读者';
  if (name.length <= 1) return name + '同学';
  return name[0] + '*'.repeat(Math.max(0, name.length - 2)) + name.slice(-1);
}

// ---------- 公开概览（首页数据故事用，无敏感信息） ----------
app.get('/api/overview', (req, res) => {
  const totalBooks = db.prepare('SELECT COUNT(*) c FROM books').get().c;
  const totalCopies = db.prepare('SELECT COALESCE(SUM(total),0) s FROM books').get().s;
  const availableCopies = db.prepare('SELECT COALESCE(SUM(available),0) s FROM books').get().s;
  const monthBorrow = db.prepare("SELECT COUNT(*) c FROM borrows WHERE borrow_date >= date('now','-30 days')").get().c;
  const cats = db.prepare("SELECT category, COUNT(*) c FROM books WHERE category IS NOT NULL AND category<>'' GROUP BY category ORDER BY c DESC").all();
  res.json({ totalBooks, totalCopies, availableCopies, monthBorrow, categories: cats });
});

// ---------- 公开实时动态（仅书名 + 动作，无用户隐私） ----------
app.get('/api/activity', (req, res) => {
  const limit = Math.min(toInt(req.query.limit, 20), 50);
  const rows = db.prepare(`SELECT r.status, r.request_date, r.pickup_date, b.title, b.category
    FROM borrows r JOIN books b ON b.id=r.book_id ORDER BY r.id DESC LIMIT ?`).all(limit);
  const list = rows.map(r => {
    let action = '发生状态变更';
    if (r.status === '待审批') action = '提交了借阅申请';
    else if (r.status === '待取书') action = '申请已通过，待到馆取书';
    else if (r.status === '借出') action = '已借出';
    else if (r.status === '已还') action = '已归还';
    else if (r.status === '逾期') action = '已逾期';
    else if (r.status === '已拒绝') action = '申请被拒绝';
    const ts = r.pickup_date || r.request_date;
    return { title: r.title, category: r.category, status: r.status, action, ts };
  });
  res.json({ activity: list });
});

// ---------- 图书：单本详情 ----------
app.get('/api/books/:id', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
  if (!book) return res.status(404).json({ error: '未找到该书' });
  const related = db.prepare('SELECT * FROM books WHERE category=? AND id<>? LIMIT 6').all(book.category, book.id);
  res.json({ book, related });
});

// ---------- 图书：新增（馆员+） ----------
app.post('/api/books', requireRole('馆员', '管理员'), (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: '书名必填' });
  const total = toInt(b.total, 1);
  const info = db.prepare(`INSERT INTO books (call_no,isbn,title,author,publisher,year,price,category,tags,cover,location,intro,total,available)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    b.call_no || '', b.isbn || '', b.title, b.author || '', b.publisher || '', b.year || '', b.price || '',
    b.category || '', b.tags || '', b.cover || '', b.location || '', b.intro || '', total, total);
  res.json({ book: db.prepare('SELECT * FROM books WHERE id=?').get(info.lastInsertRowid) });
});

// ---------- 图书：修改（馆员+） ----------
app.put('/api/books/:id', requireRole('馆员', '管理员'), (req, res) => {
  const b = req.body || {};
  const old = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '未找到该书' });
  const title = b.title ?? old.title, author = b.author ?? old.author, publisher = b.publisher ?? old.publisher;
  const year = b.year ?? old.year, category = b.category ?? old.category, tags = b.tags ?? old.tags;
  const cover = b.cover ?? old.cover, location = b.location ?? old.location, intro = b.intro ?? old.intro;
  const call_no = b.call_no ?? old.call_no, price = b.price ?? old.price;
  let total = b.total != null ? toInt(b.total, old.total) : old.total;
  let available = b.available != null ? toInt(b.available, old.available) : old.available;
  // 同步可用量不超过总量
  if (total < available) available = total;
  db.prepare(`UPDATE books SET call_no=?,isbn=?,title=?,author=?,publisher=?,year=?,price=?,category=?,tags=?,cover=?,location=?,intro=?,total=?,available=? WHERE id=?`)
    .run(call_no, b.isbn ?? old.isbn, title, author, publisher, year, price, category, tags, cover, location, intro, total, available, old.id);
  res.json({ book: db.prepare('SELECT * FROM books WHERE id=?').get(old.id) });
});

// ---------- 图书：删除（馆员+） ----------
app.delete('/api/books/:id', requireRole('馆员', '管理员'), (req, res) => {
  const info = db.prepare('DELETE FROM books WHERE id=?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '未找到该书' });
  res.json({ ok: true });
});

// ---------- 图书：批量导入 JSON / CSV（馆员+） ----------
function importRows(rows, mode) {
  const ins = db.prepare(`INSERT INTO books (call_no,isbn,title,author,publisher,year,price,category,tags,cover,location,intro,total,available)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const upd = db.prepare(`UPDATE books SET isbn=?,title=?,author=?,publisher=?,year=?,price=?,category=?,tags=?,cover=?,location=?,intro=?,total=?,available=? WHERE id=?`);
  const getByCall = db.prepare('SELECT * FROM books WHERE call_no=? AND call_no<>\'\'');
  const getByIsbn = db.prepare('SELECT * FROM books WHERE isbn=? AND isbn<>\'\'');
  let added = 0, updated = 0, skipped = 0;
  // 取值：提供了就用提供值，否则沿用原值（用于按索书号更新的「局部更新」）
  const pick = (v, fallback) => (v != null && String(v).trim() !== '') ? String(v).trim() : fallback;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const call_no = (r.call_no || '').trim();
      const isbn = (r.isbn || '').trim();
      // 唯一键优先索书号，其次 ISBN
      const existing = (call_no && getByCall.get(call_no)) || (isbn && getByIsbn.get(isbn)) || null;
      const title = (r.title || '').trim();
      // 新增必须有书名；更新可仅靠索书号/ISBN 定位，书名可省略（沿用原值）
      if (!title && !existing) { skipped++; continue; }
      if (existing) {
        if (mode === 'update') {
          const total = toInt(r.total, existing.total);
          const available = Math.min(existing.available, total);
          upd.run(
            pick(r.isbn, existing.isbn),
            title || existing.title,
            pick(r.author, existing.author),
            pick(r.publisher, existing.publisher),
            pick(r.year, existing.year),
            pick(r.price, existing.price),
            pick(r.category, existing.category),
            pick(r.tags, existing.tags),
            pick(r.cover, existing.cover),
            pick(r.location, existing.location),
            pick(r.intro, existing.intro),
            total, available, existing.id);
          updated++;
        } else {
          skipped++; // 仅新增模式：已存在则跳过，保证幂等
        }
        continue;
      }
      const total = toInt(r.total, 1);
      ins.run(call_no, isbn, title, r.author || '', r.publisher || '', r.year || '', r.price || '',
        r.category || '', r.tags || '', r.cover || '', r.location || '', r.intro || '', total, total);
      added++;
    }
  });
  tx();
  return { added, updated, skipped };
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  // 简单 CSV：支持引号包裹与逗号
  const split = (line) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out;
  };
  const header = split(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = split(line);
    const o = {}; header.forEach((h, i) => o[h] = cells[i] != null ? cells[i].trim() : '');
    return o;
  });
}

app.post('/api/books/import', requireRole('馆员', '管理员'), (req, res) => {
  const { format = 'json', mode = 'add', data } = req.body || {};
  let rows = [];
  try {
    if (format === 'csv') rows = parseCSV(String(data || ''));
    else rows = Array.isArray(data) ? data : JSON.parse(data);
  } catch (e) { return res.status(400).json({ error: '解析失败：' + e.message }); }
  if (!Array.isArray(rows)) return res.status(400).json({ error: '数据格式应为数组' });
  const result = importRows(rows, mode);
  res.json({ ok: true, ...result });
});

// ---------- 借阅：提交借阅申请（读者本人，两步流程第一步） ----------
// 状态机：待审批 →（审批通过）待取书[扣库存] →（到馆取书）借出 → 已还 / 逾期
//                        ↘（拒绝）已拒绝            ↘（待审批时可取消）已取消
app.post('/api/borrow', requireAuth, (req, res) => {
  const uid = req.user.uid;
  const bookId = toInt(req.body?.book_id);
  if (!bookId) return res.status(400).json({ error: '缺少 book_id' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const book = db.prepare('SELECT * FROM books WHERE id=?').get(bookId);
  if (!book) return res.status(404).json({ error: '未找到该书' });
  if (book.available <= 0) return res.status(409).json({ error: '该书的库存为 0，暂不可借' });
  // 进行中的借阅（含待审批/待取书）均计入额度，避免超额预留
  const active = db.prepare("SELECT COUNT(*) c FROM borrows WHERE user_id=? AND status IN ('待审批','待取书','借出','逾期')").get(uid).c;
  if (active >= user.max_borrow) return res.status(409).json({ error: `已达到借阅上限（${user.max_borrow} 本）` });
  const same = db.prepare("SELECT id FROM borrows WHERE user_id=? AND book_id=? AND status IN ('待审批','待取书','借出','逾期')").get(uid, bookId);
  if (same) return res.status(409).json({ error: '你已申请或借阅此书，请勿重复' });
  const due = db.prepare("SELECT datetime('now','+" + ai.BORROW_DAYS + " days') d").get().d;
  const info = db.prepare(`INSERT INTO borrows (user_id,book_id,due_date,status,request_date)
    VALUES (?,?,?,'待审批',datetime('now'))`).run(uid, bookId, due);
  res.json({ record: db.prepare('SELECT * FROM borrows WHERE id=?').get(info.lastInsertRowid) });
});

// ---------- 借阅：读者取消自己的待审批申请 ----------
app.post('/api/borrow/:id/cancel', requireAuth, (req, res) => {
  const uid = req.user.uid;
  const rec = db.prepare('SELECT * FROM borrows WHERE id=?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: '未找到申请记录' });
  if (rec.user_id !== uid) return res.status(403).json({ error: '只能取消自己的申请' });
  if (rec.status !== '待审批') return res.status(400).json({ error: '仅「待审批」状态可取消' });
  db.prepare("UPDATE borrows SET status='已取消' WHERE id=?").run(rec.id);
  res.json({ ok: true });
});

// ---------- 借阅：归还（馆员+ 或 本人） ----------
app.post('/api/return/:id', requireAuth, (req, res) => {
  const uid = req.user.uid, role = req.user.role;
  const rec = db.prepare('SELECT * FROM borrows WHERE id=?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: '未找到借阅记录' });
  if (role === '读者' && rec.user_id !== uid) return res.status(403).json({ error: '只能归还自己的书' });
  if (rec.status === '已还') return res.status(400).json({ error: '该书已归还' });
  db.prepare("UPDATE borrows SET status='已还', return_date=datetime('now') WHERE id=?").run(rec.id);
  db.prepare('UPDATE books SET available=available+1 WHERE id=?').run(rec.book_id);
  res.json({ ok: true });
});

// ---------- 审批台：借阅申请列表（馆员+） ----------
app.get('/api/admin/loans', requireRole('馆员', '管理员'), (req, res) => {
  markOverdue();
  const { status = '' } = req.query;
  const clauses = []; const params = [];
  if (status) { clauses.push('r.status=?'); params.push(status); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`SELECT r.*, b.title, b.author, b.cover, b.category, b.call_no, b.location,
      u.name AS user_name, u.username, u.dept
    FROM borrows r
    JOIN books b ON b.id=r.book_id
    JOIN users u ON u.id=r.user_id
    ${where} ORDER BY r.id DESC`).all(...params);
  res.json({ loans: rows });
});

// ---------- 审批台：审批通过 → 待取书（扣库存，馆员+） ----------
app.post('/api/admin/loans/:id/approve', requireRole('馆员', '管理员'), (req, res) => {
  const id = toInt(req.params.id);
  const rec = db.prepare('SELECT * FROM borrows WHERE id=?').get(id);
  if (!rec) return res.status(404).json({ error: '未找到申请' });
  if (rec.status !== '待审批') return res.status(400).json({ error: '只能审批「待审批」的申请' });
  const book = db.prepare('SELECT * FROM books WHERE id=?').get(rec.book_id);
  if (book.available <= 0) return res.status(409).json({ error: '该书库存不足，无法通过' });
  const now = db.prepare("SELECT datetime('now') n").get().n;
  db.prepare(`UPDATE borrows SET status='待取书', approved_by=?, approved_at=?, due_date=datetime('now','+${ai.BORROW_DAYS} days') WHERE id=?`)
    .run(req.user.uid, now, id);
  db.prepare('UPDATE books SET available=available-1 WHERE id=?').run(rec.book_id);
  res.json({ ok: true, record: db.prepare('SELECT * FROM borrows WHERE id=?').get(id) });
});

// ---------- 审批台：拒绝申请（馆员+） ----------
app.post('/api/admin/loans/:id/reject', requireRole('馆员', '管理员'), (req, res) => {
  const id = toInt(req.params.id);
  const rec = db.prepare('SELECT * FROM borrows WHERE id=?').get(id);
  if (!rec) return res.status(404).json({ error: '未找到申请' });
  if (rec.status !== '待审批') return res.status(400).json({ error: '只能拒绝「待审批」的申请' });
  const now = db.prepare("SELECT datetime('now') n").get().n;
  db.prepare(`UPDATE borrows SET status='已拒绝', reject_reason=?, approved_by=?, approved_at=? WHERE id=?`)
    .run((req.body?.reason || '').toString().slice(0, 200), req.user.uid, now, id);
  res.json({ ok: true });
});

// ---------- 审批台：到馆确认取书 → 借出（借期自取书日起算，馆员+） ----------
app.post('/api/admin/loans/:id/pickup', requireRole('馆员', '管理员'), (req, res) => {
  const id = toInt(req.params.id);
  const rec = db.prepare('SELECT * FROM borrows WHERE id=?').get(id);
  if (!rec) return res.status(404).json({ error: '未找到申请' });
  if (rec.status !== '待取书') return res.status(400).json({ error: '只能对「待取书」确认取书' });
  db.prepare(`UPDATE borrows SET status='借出', pickup_date=datetime('now'), due_date=datetime('now','+${ai.BORROW_DAYS} days') WHERE id=?`).run(id);
  res.json({ ok: true, record: db.prepare('SELECT * FROM borrows WHERE id=?').get(id) });
});


// ---------- 我的借阅 ----------
app.get('/api/my/borrows', requireAuth, (req, res) => {
  markOverdue();
  const uid = req.user.uid;
  const rows = db.prepare(`SELECT r.*, b.title, b.author, b.cover, b.category
    FROM borrows r JOIN books b ON b.id=r.book_id WHERE r.user_id=? ORDER BY r.id DESC`).all(uid);
  const now = db.prepare("SELECT datetime('now') n").get().n;
  const list = rows.map(r => ({ ...r, isOverdue: (r.status === '借出' || r.status === '逾期') && r.due_date < now }));
  res.json({ borrows: list });
});

// ---------- 管理：统计看板 ----------
app.get('/api/admin/stats', requireRole('馆员', '管理员'), (req, res) => {
  markOverdue();
  const stat = (sql) => db.prepare(sql).get();
  const totalBooks = stat('SELECT COUNT(*) c FROM books').c;
  const totalCopies = stat('SELECT COALESCE(SUM(total),0) s FROM books').s;
  const availableCopies = stat('SELECT COALESCE(SUM(available),0) s FROM books').s;
  const borrowed = stat("SELECT COUNT(*) c FROM borrows WHERE status IN ('借出','逾期')").c;
  const overdue = stat("SELECT COUNT(*) c FROM borrows WHERE status='逾期'").c;
  const pending = stat("SELECT COUNT(*) c FROM borrows WHERE status='待审批'").c;
  const pickup = stat("SELECT COUNT(*) c FROM borrows WHERE status='待取书'").c;
  const totalUsers = stat("SELECT COUNT(*) c FROM users").c;
  const readers = stat("SELECT COUNT(*) c FROM users WHERE role='读者'").c;
  const librarians = stat("SELECT COUNT(*) c FROM users WHERE role IN ('馆员','管理员')").c;
  const returned = stat("SELECT COUNT(*) c FROM borrows WHERE status='已还'").c;
  // 借阅状态分布（供环形图）
  const breakdown = db.prepare("SELECT status, COUNT(*) c FROM borrows GROUP BY status").all();

  // 近 14 天借阅趋势
  const trend = db.prepare(`SELECT date(borrow_date) d, COUNT(*) c FROM borrows
    WHERE borrow_date >= date('now','-13 days') GROUP BY d ORDER BY d`).all();
  const trendMap = {}; trend.forEach(t => trendMap[t.d] = t.c);
  const days = []; const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, count: trendMap[key] || 0 });
  }

  // 分类分布
  const cats = db.prepare("SELECT category, COUNT(*) c FROM books WHERE category IS NOT NULL AND category<>'' GROUP BY category ORDER BY c DESC").all();
  // 热门书目 Top10
  const topBooks = db.prepare(`SELECT b.id,b.title,b.author,COUNT(*) c FROM borrows r JOIN books b ON b.id=r.book_id
    GROUP BY b.id ORDER BY c DESC LIMIT 10`).all();
  // 逾期率
  const overdueRate = (borrowed + returned) > 0 ? (overdue / Math.max(1, (borrowed + returned))) * 100 : 0;

  res.json({
    kpi: { totalBooks, totalCopies, availableCopies, borrowed, overdue, pending, pickup, totalUsers, readers, librarians, returned, overdueRate: +overdueRate.toFixed(1) },
    trend: days, categories: cats, topBooks, breakdown
  });
});

// ---------- 管理：读者列表 ----------
app.get('/api/admin/readers', requireRole('馆员', '管理员'), (req, res) => {
  const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM borrows r WHERE r.user_id=u.id AND r.status IN ('借出','逾期')) active
    FROM users u ORDER BY u.id DESC`).all();
  res.json({ readers: rows.map(publicUser) });
});
// 新建读者/馆员账号
app.post('/api/admin/readers', requireRole('管理员'), (req, res) => {
  const { username, password, name, dept, student_no, role = '读者', max_borrow = 5 } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '账号和密码必填' });
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(409).json({ error: '账号已存在' });
  const { salt, hash } = require('./crypto').hashPassword(password);
  const info = db.prepare(`INSERT INTO users (username,password_hash,salt,role,name,dept,student_no,max_borrow)
    VALUES (?,?,?,?,?,?,?,?)`).run(username, hash, salt, role, name || username, dept || '', student_no || '', toInt(max_borrow, 5));
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid)) });
});
// 修改读者（角色/额度）
app.put('/api/admin/readers/:id', requireRole('管理员'), (req, res) => {
  const { role, max_borrow } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '未找到用户' });
  if (role) db.prepare('UPDATE users SET role=? WHERE id=?').run(role, u.id);
  if (max_borrow != null) db.prepare('UPDATE users SET max_borrow=? WHERE id=?').run(toInt(max_borrow, u.max_borrow), u.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
});

// ---------- 图书评论（公开读取，登录可发） ----------
app.get('/api/books/:id/comments', (req, res) => {
  const rows = db.prepare(`SELECT c.id, c.content, c.user_name, c.sentiment, c.tags, c.created_at
    FROM comments c WHERE c.book_id=? ORDER BY c.id DESC`).all(req.params.id);
  res.json({ comments: rows });
});
app.post('/api/books/:id/comments', requireAuth, (req, res) => {
  const uid = req.user.uid;
  const bookId = toInt(req.params.id);
  const content = String(req.body?.content || '').trim().slice(0, 500);
  if (!content) return res.status(400).json({ error: '评论内容不能为空' });
  const user = db.prepare('SELECT name, role FROM users WHERE id=?').get(uid);
  const display = user && user.role === '读者' ? maskName(user.name || '') : (user?.name || '馆员');
  // 离线简单情感分析
  const sentiment = analyzeSentiment(content);
  const tags = extractTags(content).join(',');
  const info = db.prepare(`INSERT INTO comments (book_id,user_id,user_name,content,sentiment,tags)
    VALUES (?,?,?,?,?,?)`).run(bookId, uid, display, content, sentiment, tags);
  const row = db.prepare('SELECT * FROM comments WHERE id=?').get(info.lastInsertRowid);
  res.json({ comment: row });
});

// ---------- 评论 AI 洞察（公开） ----------
app.get('/api/books/:id/review-insights', (req, res) => {
  const bookId = toInt(req.params.id);
  const agg = db.prepare(`SELECT COUNT(*) n, ROUND(AVG(sentiment),2) avg, SUM(CASE WHEN sentiment>0.2 THEN 1 ELSE 0 END) pos,
    SUM(CASE WHEN sentiment<-0.2 THEN 1 ELSE 0 END) neg
    FROM comments WHERE book_id=?`).get(bookId);
  const tagRows = db.prepare(`SELECT tags FROM comments WHERE book_id=? AND tags<>''`).all(bookId);
  const tagMap = {};
  tagRows.forEach(r => r.tags.split(',').forEach(t => { if (t.trim()) tagMap[t.trim()] = (tagMap[t.trim()] || 0) + 1; }));
  const topTags = Object.entries(tagMap).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ tag: k, count: v }));
  res.json({ ...agg, topTags });
});

function analyzeSentiment(text) {
  const pos = /好|棒|不错|推荐|喜欢|精彩|有用|帮助|深入|清晰|经典|必读|赞|爱|受益/.test(text);
  const neg = /差|烂|失望|难懂|枯燥|混乱|无用|错|不好|不建议|垃圾|失望|后悔/.test(text);
  if (pos && !neg) return 0.8;
  if (neg && !pos) return -0.6;
  return 0.0;
}
function extractTags(text) {
  const dict = ['数字人文', '文本挖掘', 'GIS', '知识图谱', 'Python', 'R', '可视化', '历史', '文学', '艺术',
    '跨学科', '入门', '经典', '理论', '方法', '工具', '案例', '编程', '数据', '社科'];
  return dict.filter(t => text.includes(t));
}

// ---------- 数字人文分析（公开） ----------
app.get('/api/dh', (req, res) => {
  markOverdue();
  // 1) 分类借阅热度
  const catHeat = db.prepare(`SELECT b.category, COUNT(r.id) borrow_count, COUNT(DISTINCT r.user_id) reader_count
    FROM books b LEFT JOIN borrows r ON b.id=r.book_id AND r.status IN ('借出','已还','逾期','待取书')
    WHERE b.category IS NOT NULL AND b.category<>'' GROUP BY b.category ORDER BY borrow_count DESC`).all();
  // 2) 借阅时间序列（近 90 天）
  const ts = db.prepare(`SELECT date(request_date) d, COUNT(*) c FROM borrows
    WHERE request_date >= date('now','-89 days') GROUP BY d ORDER BY d`).all();
  const tsMap = {}; ts.forEach(t => tsMap[t.d] = t.c);
  const trend90 = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    trend90.push({ date: key, count: tsMap[key] || 0 });
  }
  // 3) 高频标签（来自 books.tags）
  const tagRows = db.prepare(`SELECT tags FROM books WHERE tags<>''`).all();
  const tagCount = {};
  tagRows.forEach(r => r.tags.split(',').forEach(t => { const k = t.trim(); if (k) tagCount[k] = (tagCount[k] || 0) + 1; }));
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => ({ tag: k, count: v }));
  // 4) 读者-书籍网络（最近 50 条成功借阅）
  const edges = db.prepare(`SELECT u.name reader, b.title book, b.category, r.status
    FROM borrows r JOIN users u ON u.id=r.user_id JOIN books b ON b.id=r.book_id
    WHERE r.status IN ('借出','已还','逾期','待取书') ORDER BY r.id DESC LIMIT 80`).all();
  const nodes = [];
  const nodeSet = new Set();
  const links = [];
  edges.forEach(e => {
    const rn = maskName(e.reader || '读者');
    const bn = '《' + e.book + '》';
    if (!nodeSet.has(rn)) { nodeSet.add(rn); nodes.push({ id: rn, type: 'reader', group: 1 }); }
    if (!nodeSet.has(bn)) { nodeSet.add(bn); nodes.push({ id: bn, type: 'book', group: 2, category: e.category }); }
    links.push({ source: rn, target: bn, status: e.status });
  });
  // 5) 作者分布
  const authorTop = db.prepare(`SELECT author, COUNT(*) c FROM books WHERE author IS NOT NULL AND author<>''
    GROUP BY author ORDER BY c DESC LIMIT 15`).all();
  res.json({ catHeat, trend90, topTags, network: { nodes, links }, authorTop, demo: db.hasDemo });
});

// ---------- 站点元信息（前端判断演示数据标注） ----------
app.get('/api/meta', (req, res) => {
  const totalBooks = db.prepare('SELECT COUNT(*) c FROM books').get().c;
  res.json({ demo: db.hasDemo, totalBooks, version: '1.0.0' });
});

// ---------- AI 助手 ----------
app.post('/api/ai/ask', requireAuth, async (req, res) => {
  const q = (req.body?.question || '').toString().trim();
  try {
    const result = await ai.answer(q, { uid: req.user.uid });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'AI 服务异常：' + e.message });
  }
});
// AI 在线/离线状态（混合模式：配置 LLM_API_URL + LLM_API_KEY 即在线）
app.get('/api/ai/status', (req, res) => {
  const online = !!(process.env.LLM_API_URL && process.env.LLM_API_KEY);
  res.json({ online, mode: online ? 'llm' : 'rule' });
});
// AI 导读（单本书，RAG + 离线模板）
app.get('/api/ai/digest/:id', requireAuth, async (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
  if (!book) return res.status(404).json({ error: '未找到该书' });
  try {
    const result = await ai.digest(book, { uid: req.user.uid });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '导读生成失败：' + e.message });
  }
});

// ---------- 图书：封面上传（馆员+） ----------
// 支持：dataURL（解码写文件到 public/covers/）、外链 URL、或清空（走 /covers/<索书号>.jpg 默认）
app.post('/api/books/:id/cover', requireRole('馆员', '管理员'), (req, res) => {
  const b = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: '未找到该书' });
  let cover = (req.body && req.body.cover) || '';
  if (typeof cover !== 'string') cover = '';
  if (cover.startsWith('data:')) {
    const m = cover.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: '图片格式不支持，请用 JPG/PNG/WebP' });
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: '图片过大（上限 8MB）' });
    const coversDir = path.join(__dirname, '../public', 'covers');
    if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });
    const safe = (b.call_no || ('book_' + b.id)).replace(/[^A-Za-z0-9._-]/g, '_');
    fs.writeFileSync(path.join(coversDir, safe + '.' + ext), buf);
    cover = '/covers/' + safe + '.' + ext;
  } else if (cover.startsWith('http://') || cover.startsWith('https://') || cover.startsWith('/')) {
    // 外链或站内路径：原样保存
  } else {
    cover = ''; // 清空：前端按索书号加载 /covers/<索书号>.jpg
  }
  db.prepare('UPDATE books SET cover=? WHERE id=?').run(cover, b.id);
  res.json({ ok: true, cover, book: db.prepare('SELECT * FROM books WHERE id=?').get(b.id) });
});

// ---------- 静态资源（SPA） ----------
app.use(express.static(path.join(__dirname, '../public')));
// 封面走 /covers/<索书号>.jpg：文件缺失时返回 404，前端自动回退占位图（不落入 SPA 兜底）
app.get(/^(?!\/api\/|\/covers\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  数字人文学院图书管理系统已启动`);
  console.log(`  ▶  http://localhost:${PORT}`);
  console.log(`  管理员：admin / admin123    馆员：librarian / lib12345\n`);
});
