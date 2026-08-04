'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { hashPassword } = require('./crypto');

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'library.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');     // 提升并发读写性能，支撑 50+ 并发
db.pragma('busy_timeout = 5000');    // 锁等待，避免并发冲突
db.pragma('foreign_keys = ON');

// ---------- 建表 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT '读者',   -- 读者 / 馆员 / 管理员
  name          TEXT,
  dept          TEXT,
  student_no    TEXT,
  max_borrow    INTEGER NOT NULL DEFAULT 5,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS books (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  call_no    TEXT,        -- 唯一馆藏编号（索书号），如 I1-01
  isbn       TEXT,
  title      TEXT NOT NULL,
  author     TEXT,
  publisher  TEXT,
  year       TEXT,
  price      TEXT,        -- 定价（元）
  category   TEXT,
  tags       TEXT,        -- 逗号分隔
  cover      TEXT,        -- 封面 URL，空则前端按索书号自动加载 /covers/<索书号>.jpg，缺图回退占位
  location   TEXT,        -- 馆藏位置，如 A3-02
  intro      TEXT,
  total      INTEGER NOT NULL DEFAULT 1,
  available  INTEGER NOT NULL DEFAULT 1,
  added_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS borrows (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  book_id    INTEGER NOT NULL REFERENCES books(id),
  borrow_date TEXT NOT NULL DEFAULT (datetime('now')),
  due_date    TEXT NOT NULL,
  return_date TEXT,
  status      TEXT NOT NULL DEFAULT '借出'   -- 借出 / 已还 / 逾期
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id    INTEGER NOT NULL REFERENCES books(id),
  user_id    INTEGER REFERENCES users(id),
  user_name  TEXT,         -- 匿名展示用（如「数字人文爱好者」）
  content    TEXT NOT NULL,
  sentiment  REAL,         -- -1 ~ 1 情感分
  tags       TEXT,         -- AI 提取标签，逗号分隔
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_cat ON books(category);
CREATE INDEX IF NOT EXISTS idx_borrows_user ON borrows(user_id);
CREATE INDEX IF NOT EXISTS idx_borrows_book ON borrows(book_id);
CREATE INDEX IF NOT EXISTS idx_comments_book ON comments(book_id);
`);

// ---------- 迁移：为旧库补列（兼容已存在的 books / borrows 表） ----------
(function migrate() {
  const bcols = db.prepare("PRAGMA table_info(books)").all().map(c => c.name);
  if (!bcols.includes('call_no')) db.exec("ALTER TABLE books ADD COLUMN call_no TEXT");
  if (!bcols.includes('price')) db.exec("ALTER TABLE books ADD COLUMN price TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_books_callno ON books(call_no)");

  // borrows 表：借阅审批流程所需字段
  const rcols = db.prepare("PRAGMA table_info(borrows)").all().map(c => c.name);
  const add = (name, def) => { if (!rcols.includes(name)) db.exec(`ALTER TABLE borrows ADD COLUMN ${name} ${def}`); };
  add('request_date', "TEXT");
  add('approved_by', "INTEGER");
  add('approved_at', "TEXT");
  add('reject_reason', "TEXT");
  add('pickup_date', "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_borrows_status ON borrows(status)");
})();

// ---------- 种子数据 ----------
function seed() {
  const adminCount = db.prepare('SELECT COUNT(*) c FROM users WHERE username=?').get('admin');
  if (adminCount.c === 0) {
    const a = hashPassword('admin123');
    db.prepare(`INSERT INTO users (username,password_hash,salt,role,name,dept,max_borrow)
      VALUES (?,?,?,?,?,?,?)`).run('admin', a.hash, a.salt, '管理员', '系统管理员', '图书馆', 999);
    const l = hashPassword('lib12345');
    db.prepare(`INSERT INTO users (username,password_hash,salt,role,name,dept,max_borrow)
      VALUES (?,?,?,?,?,?,?)`).run('librarian', l.hash, l.salt, '馆员', '图书室馆员', '图书馆', 999);
    console.log('[seed] 已创建管理员 admin/admin123 与馆员 librarian/lib12345');
  }

  const bookCount = db.prepare('SELECT COUNT(*) c FROM books').get();
  if (bookCount.c === 0) {
    let books = [];
    try {
      const raw = fs.readFileSync(path.join(__dirname, '../data', 'seed-books.json'), 'utf-8');
      books = (JSON.parse(raw).books) || [];
    } catch (e) {
      console.warn('[seed] 未找到 data/seed-books.json，跳过书目种子：', e.message);
    }
    if (books.length) {
      const ins = db.prepare(`INSERT INTO books (call_no,isbn,title,author,publisher,year,price,category,tags,cover,location,intro,total,available)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const tx = db.transaction(() => {
        for (const b of books) {
          const total = Number.isFinite(+b.total) ? +b.total : 1;
          const avail = Number.isFinite(+b.available) ? +b.available : total;
          ins.run(b.call_no || '', b.isbn || '', b.title || '', b.author || '', b.publisher || '',
            b.year || '', b.price || '', b.category || '', b.tags || '', b.cover || '',
            b.location || '', b.intro || '', total, avail);
        }
      });
      tx();
      console.log(`[seed] 已导入 ${books.length} 本真实馆藏（数字人文学院图书室）`);
    }
  }
}
seed();

module.exports = db;
