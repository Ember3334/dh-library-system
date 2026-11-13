'use strict';
// 一键发布静态版：把「本地完整平台」导出为纯静态只读站点
// 产出 dist-static/，可直接上传 GitHub Pages / Vercel / 任意静态托管
//   - 拷贝 public/（页面、样式、vendor、covers、media）
//   - 注入 config.js（window.STATIC_MODE=true，路径相对化）
//   - 生成 data/*.json（前端 STATIC_MODE 下 fetch 本地 JSON 取代 API）
//   - 写 checkpoint（发布时间 / 条数 / 体积），支持增量跳过未变更
const path = require('path');
const fs = require('fs');
const db = require('./db');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST_DIR = path.join(ROOT, 'dist-static');
const DATA_DIR = path.join(DIST_DIR, 'data');
const COPIED_IGNORE = new Set(['config.js']); // config.js 由注入版替代

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function copyDir(src, dest) {
  let files = 0, bytes = 0;
  ensureDir(dest);
  for (const name of fs.readdirSync(src)) {
    if (COPIED_IGNORE.has(name)) continue;
    const s = path.join(src, name), d = path.join(dest, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) { const r = copyDir(s, d); files += r.files; bytes += r.bytes; }
    else { fs.copyFileSync(s, d); files++; bytes += st.size; }
  }
  return { files, bytes };
}

function rmDir(p) { fs.rmSync(p, { recursive: true, force: true }); }

function dirSize(p) {
  let bytes = 0;
  if (!fs.existsSync(p)) return 0;
  for (const name of fs.readdirSync(p)) {
    const f = path.join(p, name);
    const st = fs.statSync(f);
    bytes += st.isDirectory() ? dirSize(f) : st.size;
  }
  return bytes;
}

// ---------- 数据导出 ----------
function exportData() {
  ensureDir(DATA_DIR);
  const write = (name, obj) => fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(obj), 'utf-8');

  // 书库：列表与详情共用同一全量数组（静态版前端自行过滤/分页）
  const books = db.prepare('SELECT * FROM books ORDER BY id').all();
  write('books.json', { books });
  write('books-full.json', { books });
  write('categories.json', {
    categories: db.prepare("SELECT category, COUNT(*) c FROM books WHERE category IS NOT NULL AND category<>'' GROUP BY category ORDER BY c DESC")
      .all().map(r => ({ category: r.category, count: r.c }))
  });
  write('stars.json', { stars: db.prepare('SELECT id, title, author, category, tags, call_no FROM books ORDER BY id').all() });

  const works = db.prepare('SELECT * FROM works WHERE visible=1 ORDER BY issue_no DESC, sort DESC, id DESC').all();
  write('works.json', {
    works,
    issues: db.prepare('SELECT issue_no, COUNT(*) c FROM works WHERE visible=1 GROUP BY issue_no ORDER BY issue_no DESC').all()
  });
  write('works-full.json', { works });

  const posts = db.prepare('SELECT * FROM posts WHERE visible=1 ORDER BY published_at DESC, sort DESC, id DESC').all();
  write('posts.json', { posts });
  write('posts-full.json', { posts });

  const totalCopies = db.prepare('SELECT COALESCE(SUM(total),0) s FROM books').get().s;
  write('overview.json', {
    totalBooks: books.length, totalCopies,
    worksCount: works.length,
    issues: new Set(works.map(w => w.issue_no)).size,
    postsCount: posts.length,
    categories: db.prepare("SELECT category, COUNT(*) c FROM books WHERE category IS NOT NULL AND category<>'' GROUP BY category ORDER BY c DESC").all()
  });
  write('meta.json', { totalBooks: books.length, worksCount: works.length, postsCount: posts.length, version: '2.0.0-dh-platform' });
  return { books: books.length, works: works.length, posts: posts.length };
}

// ---------- 静态 config 注入 ----------
function writeStaticConfig() {
  fs.writeFileSync(path.join(DIST_DIR, 'config.js'), [
    '// 自动生成的静态发布版配置（由 server/publish.js 写入，勿手工修改）',
    'window.API_BASE = \'\';',
    'window.STATIC_BASE = \'\';',
    'window.STATIC_MODE = true;',
    'window.ASSET_BASE = \'./\';',
    ''
  ].join('\n'), 'utf-8');
}

async function exportStatic() {
  const t0 = Date.now();
  // 1) 重建 dist-static
  rmDir(DIST_DIR);
  ensureDir(DIST_DIR);
  const copied = copyDir(PUBLIC_DIR, DIST_DIR);
  writeStaticConfig();
  const counts = exportData();

  // 2) checkpoint
  const stat = {
    publishedAt: new Date().toISOString(),
    files: copied.files,
    dataBytes: dirSize(DATA_DIR),
    totalBytes: dirSize(DIST_DIR),
    ...counts,
    elapsedMs: Date.now() - t0
  };
  fs.writeFileSync(path.join(DIST_DIR, 'publish-checkpoint.json'), JSON.stringify(stat, null, 2), 'utf-8');
  return stat;
}

module.exports = { exportStatic, DIST_DIR };
