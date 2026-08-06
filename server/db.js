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

  // ---------- 演示数据：10 位虚拟读者 + 借阅 + 评论（幂等，供排行榜/分析页展示） ----------
  seedDemo();
}

// 幂等：仅当 demo_01 不存在时才写入，避免重复
function seedDemo() {
  const exist = db.prepare("SELECT COUNT(*) c FROM users WHERE username='demo_01'").get();
  if (exist.c > 0) return;
  const names = ['知行', '拾光', '阅微', '明远', '静好', '清欢', '怀瑾', '书昀', '南风', '见山'];
  const books = db.prepare('SELECT id FROM books ORDER BY id LIMIT 40').all().map(x => x.id);
  if (!books.length) return;

  const insertUser = db.prepare(`INSERT INTO users (username,password_hash,salt,role,name,dept,max_borrow) VALUES (?,?,?,?,?,?,?)`);
  const p = hashPassword('demo123');
  const uids = names.map((nm, i) => {
    const info = insertUser.run('demo_' + String(i + 1).padStart(2, '0'), p.hash, p.salt, '读者', '数文读者·' + nm, '数字人文学院', 8);
    return info.lastInsertRowid;
  });

  const at = (days) => { const d = new Date(Date.now() + days * 86400000); return d.toISOString().slice(0, 19).replace('T', ' '); };
  const statuses = ['已还', '借出', '已还', '待取书', '逾期', '已还'];
  const borrowIns = db.prepare(`INSERT INTO borrows (user_id,book_id,borrow_date,due_date,return_date,status) VALUES (?,?,?,?,?,?)`);
  const counts = [18, 14, 11, 9, 7, 6, 5, 4, 3, 2]; // 借阅之星差距，覆盖热门/冷门/借阅之星三榜

  const txB = db.transaction(() => {
    uids.forEach((uid, i) => {
      const n = counts[i] || 2;
      for (let k = 0; k < n; k++) {
        const bid = books[(i * 3 + k * 2) % books.length];
        const st = statuses[(i + k) % statuses.length];
        const borrowDaysAgo = 5 + ((i * 7 + k * 3) % 40);
        const borrow = at(-borrowDaysAgo);
        const due = at(-borrowDaysAgo + 30);
        const ret = st === '已还' ? at(-borrowDaysAgo + Math.min(25, borrowDaysAgo - 1)) : null;
        borrowIns.run(uid, bid, borrow, due, ret, st);
      }
    });
  });
  txB();

  // 评论（好评榜）：中文读后感 + 正向情感分
  const reviews = [
    ['文笔细腻，考据扎实，读来如与先贤对话。', 0.85, '文笔好,有深度'],
    ['案例丰富，适合入门，框架清晰。', 0.78, '案例丰富,适合入门'],
    ['装帧素雅，内容厚重，值得反复翻阅。', 0.82, '装帧美,耐读'],
    ['视角独特，颠覆了我对这段历史的认识。', 0.9, '视角独特,有深度'],
    ['译笔流畅，思想深刻，强烈推荐。', 0.88, '翻译好,推荐'],
    ['叙述从容，史料翔实，读完很有收获。', 0.8, '史料翔实,有收获'],
    ['图文并茂，把抽象理论讲得通俗。', 0.75, '通俗易懂,图文并茂'],
    ['语言诗意，哲思绵长，余味悠长。', 0.84, '诗意,哲思'],
    ['结构严谨，论证有力，学术价值高。', 0.86, '结构严谨,学术'],
    ['把小人物写活了，烟火气十足。', 0.79, '人物鲜活,烟火气'],
    ['注释详尽，便于深读，做研究很方便。', 0.77, '注释全,研究友好'],
    ['节奏明快，一口气读完不觉得累。', 0.72, '节奏好,易读'],
    ['思想锐利，敢于直面真问题。', 0.83, '思想锐利,敢言'],
    ['田野调查扎实，细节动人。', 0.81, '田野扎实,细节'],
    ['跨学科视野，给人很多启发。', 0.87, '跨学科,启发'],
    ['语言干净，情感克制而深沉。', 0.76, '语言干净,深沉'],
    ['把复杂问题讲简单了，难得。', 0.74, '化繁为简,清晰'],
    ['史料与叙事平衡得很好。', 0.8, '史料,叙事'],
    ['封面设计有巧思，内容也对得起颜值。', 0.78, '设计巧思,物有所值'],
    ['读完对专业理解更深了一层。', 0.85, '增益,专业'],
    ['批判性强，不人云亦云。', 0.82, '批判性,独立'],
    ['温柔又有力量，适合静夜读。', 0.73, '温柔,力量'],
    ['方法论清晰，可操作性强。', 0.79, '方法论,实用'],
    ['引文广博，足见功底。', 0.77, '引文广博,功底'],
    ['把地方文化写得活色生香。', 0.84, '地方文化,鲜活']
  ];
  const insC = db.prepare(`INSERT INTO comments (book_id,user_id,user_name,content,sentiment,tags,created_at) VALUES (?,?,?,?,?,?,?)`);
  const txC = db.transaction(() => {
    reviews.forEach((c, i) => {
      const bid = books[(i * 5 + 3) % books.length];
      const uid = uids[i % uids.length];
      insC.run(bid, uid, '数文读者·' + names[i % names.length], c[0], c[1], c[2], at(-i));
    });
  });
  txC();
  console.log('[seed] 已创建 10 位虚拟读者及演示借阅/评论数据');
}

const hasDemo = db.prepare("SELECT COUNT(*) c FROM users WHERE username='demo_01'").get().c > 0;
db.hasDemo = hasDemo;

seed();

module.exports = db;
