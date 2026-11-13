'use strict';
// 数据层：数字人文平台
// 保留 books（馆藏展示核心）；新增 works（摘星辰作品）/ posts（资讯）
// 用户体系（users/borrows/comments）已移除：旧库残留表惰性存在，不再读写，可随时回滚 data/library.db.bak-*
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'library.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// ---------- 建表 ----------
db.exec(`
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
  location   TEXT,
  intro      TEXT,
  total      INTEGER NOT NULL DEFAULT 1,
  available  INTEGER NOT NULL DEFAULT 1,
  added_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS works (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT,                -- 星辰代号：北极星/启明星/织女星/天狼星/牵牛星/东壁星…
  issue_no     INTEGER,             -- 期数（第 N 期）
  title        TEXT NOT NULL,
  summary      TEXT,                -- 简介
  members      TEXT,                -- 参与成员，逗号分隔
  type         TEXT NOT NULL DEFAULT 'link',  -- html / image / video / link
  payload      TEXT,                -- html/image/video: /media/... 路径；link: 外链 URL
  cover        TEXT,                -- 封面图（空则前端按代号生成星徽占位）
  tags         TEXT,
  org          TEXT DEFAULT '数文拾光协会',
  published_at TEXT,
  updated_at   TEXT,
  sort         INTEGER DEFAULT 0,
  visible      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  category     TEXT,                -- 动态 / 时事 / 工具 / 学习资源
  summary      TEXT,
  content      TEXT,                -- Markdown 子集
  cover        TEXT,
  source_name  TEXT,
  source_url   TEXT,                -- 「跳转原文」外链
  published_at TEXT,
  created_at   TEXT,
  updated_at   TEXT,
  sort         INTEGER DEFAULT 0,
  visible      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_cat ON books(category);
CREATE INDEX IF NOT EXISTS idx_works_issue ON works(issue_no);
CREATE INDEX IF NOT EXISTS idx_posts_cat ON posts(category);
`);

// ---------- 迁移：为旧库补列（兼容已存在的 books 表） ----------
(function migrate() {
  const bcols = db.prepare("PRAGMA table_info(books)").all().map(c => c.name);
  if (!bcols.includes('call_no')) db.exec("ALTER TABLE books ADD COLUMN call_no TEXT");
  if (!bcols.includes('price')) db.exec("ALTER TABLE books ADD COLUMN price TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_books_callno ON books(call_no)");
})();

// ---------- 种子数据 ----------
function seed() {
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
  seedWorks();
  seedPosts();
}

// 摘星辰作品：仅录入真实成果（数据来自社团活动记录，不编造）
function seedWorks() {
  const cnt = db.prepare('SELECT COUNT(*) c FROM works').get();
  if (cnt.c > 0) return;
  const ins = db.prepare(`INSERT INTO works (code,issue_no,title,summary,members,type,payload,cover,tags,org,published_at,sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction(() => {
    // 第二期 · 东壁星：《九星照黔 · 贵州冬至民俗图谱》（社团真实产出）
    ins.run('东壁星', 2, '九星照黔 · 贵州冬至民俗图谱',
      '贵州九市州冬至民俗图谱：地图拼图闯关 + 六类民俗（地点/民族/食物/仪式/器物/寓意）放射图谱与全域网络图，浅色宣纸国风、单文件零依赖。数据来自项目组两份民俗田野笔记与公开报道整理。',
      '摘星辰第二期项目组', 'link', '', '', '贵州,民俗,可视化,国风',
      '数文拾光协会', '2026-11-13', 20);
  });
  tx();
  console.log('[seed] 已录入摘星辰作品示例（可在 #/manage 编辑或删除）');
}

// 资讯种子：收录真实可查的平台/计划信息
function seedPosts() {
  const cnt = db.prepare('SELECT COUNT(*) c FROM posts').get();
  if (cnt.c > 0) return;
  const ins = db.prepare(`INSERT INTO posts (title,category,summary,content,cover,source_name,source_url,published_at,sort)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction(() => {
    ins.run('摘星辰 · 数字人文可视化实践项目计划简介', '动态',
      '数文拾光协会周期性可视化实践活动：每周一期，小组实操产出带星辰代号的小型可视化作品，统一归集至本平台陈列。',
      [
        '## 项目简介',
        '',
        '「摘星辰」取自李白《夜宿山寺》"危楼高百尺，手可摘星辰"——人文思想如同浩瀚星空，同学们通过数字实践，亲手摘取属于自己的"思想星辰"，把无形的人文思想转化为看得见的可视化作品。',
        '',
        '## 活动信息',
        '',
        '- **主办单位**：贵州师范大学数文拾光 · 数字人文协会',
        '- **活动对象**：协会全体成员',
        '- **活动周期**：2026 年 10 月 26 日 — 12 月 12 日，每周 1 期（线上腾讯会议）',
        '- **活动形式**：小作坊式分组实操，每期 1–2 名成员主力完成小型可视化作品，其余成员观摩学习',
        '',
        '## 星辰代号命名规则',
        '',
        '每件作品完成后由小组讨论选定专属星辰代号：',
        '',
        '- **北极星**：方向、基准 —— 史料梳理、脉络梳理类作品',
        '- **启明星**：开端、新探索 —— 全新选题、初次尝试类作品',
        '- **织女星**：编织、整合 —— 多源素材整合、文本汇编类作品',
        '- **天狼星**：明亮突出 —— 重点专题、热点人文主题作品',
        '- **牵牛星**：联结 —— 人物关系、社会网络类作品',
        '',
        '## 作品归档',
        '',
        '每件作品包含：可视化成品、星辰代号、作品简介、参与成员名单，统一归集至本平台「摘星辰」版块对外陈列。'
      ].join('\n'),
      '', '数文拾光协会', '', '2026-10-26', 10);
  });
  tx();
  console.log('[seed] 已录入资讯示例（可在 #/manage 编辑或删除）');
}

seed();

module.exports = db;
