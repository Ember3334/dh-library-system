'use strict';
// 离线快照：把公开 GET 的全部结果打包成 public/data/snapshot.js
// 为什么是 .js 而不是 .json：file:// 下 fetch 会被 CORS 拦（origin=null），
// 只有 classic <script> 能跨过这层，所以把数据写成 window.__SNAPSHOT__ = {...}
const fs = require('fs');
const path = require('path');
const db = require('./db');
const settings = require('./settings');

const OUT_FILE = path.join(__dirname, '../public/data/snapshot.js');

function build(opts = {}) {
  const slim = !!opts.slim;
  const books = db.prepare('SELECT * FROM books ORDER BY id DESC').all().map(b => {
    if (!slim) return b;
    return { ...b, intro: String(b.intro || '').slice(0, 160) };
  });
  const stars = db.prepare('SELECT id, title, author, category, tags, call_no FROM books ORDER BY id')
    .all();
  const works = db.prepare(`SELECT * FROM works WHERE visible=1 ORDER BY issue_no DESC, sort DESC, id DESC`).all();
  const issues = db.prepare('SELECT issue_no, COUNT(*) c FROM works WHERE visible=1 GROUP BY issue_no ORDER BY issue_no DESC').all();
  const posts = db.prepare(`SELECT * FROM posts WHERE visible=1 ORDER BY published_at DESC, sort DESC, id DESC`).all();
  const categories = db.prepare("SELECT category, COUNT(*) c FROM books WHERE category IS NOT NULL AND category<>'' GROUP BY category ORDER BY c DESC")
    .all().map(r => ({ category: r.category, count: r.c }));
  const totalCopies = db.prepare('SELECT COALESCE(SUM(total),0) s FROM books').get().s;

  return {
    generated_at: new Date().toISOString(),
    version: '2.1.0-dh-platform',
    settings: settings.mergedSettings(),
    meta: {
      totalBooks: books.length, worksCount: works.length, postsCount: posts.length,
      version: '2.1.0-dh-platform'
    },
    overview: {
      totalBooks: books.length, totalCopies, worksCount: works.length,
      issues: issues.length, postsCount: posts.length,
      categories: categories.map(c => ({ category: c.category, c: c.count }))
    },
    categories, stars, books, works, issues, posts
  };
}

function write(opts = {}) {
  const data = build(opts);
  const js = '/* 自动生成：npm run snapshot —— 离线只读数据快照，请勿手改 */\n'
    + 'window.__SNAPSHOT__ = ' + JSON.stringify(data) + ';\n';
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, js, 'utf-8');
  return { file: path.relative(path.join(__dirname, '..'), OUT_FILE).replace(/\\/g, '/'), bytes: Buffer.byteLength(js), kb: Math.round(Buffer.byteLength(js) / 1024) };
}

module.exports = { build, write, OUT_FILE };
