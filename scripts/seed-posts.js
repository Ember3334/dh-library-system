'use strict';
// 资讯批量入库：node scripts/seed-posts.js [--force] [--dry-run]
// 幂等：优先按 source_url 去重，回退按 title；默认只新增不覆盖，--force 才更新已存在的条目
const fs = require('fs');
const path = require('path');
const db = require('../server/db');

const args = process.argv.slice(2);
const force = args.includes('--force');
const dry = args.includes('--dry-run');
const FILE = path.join(__dirname, 'data', 'posts-2026.json');

const items = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const norm = s => String(s || '').replace(/\s/g, '').replace(/[「」《》“”"'·:：—\-…]/g, '');

const findByUrl = db.prepare('SELECT * FROM posts WHERE source_url=? AND source_url<>\'\' LIMIT 1');
const findByTitle = db.prepare('SELECT * FROM posts WHERE title=? LIMIT 1');
const ins = db.prepare(`INSERT INTO posts (title,category,summary,content,cover,source_name,source_url,published_at,sort,visible,created_at,updated_at)
  VALUES (@title,@category,@summary,@content,'',@source_name,@source_url,@published_at,@sort,1,datetime('now'),datetime('now'))`);
const upd = db.prepare(`UPDATE posts SET title=@title,category=@category,summary=@summary,content=@content,
  source_name=@source_name,source_url=@source_url,published_at=@published_at,sort=@sort,updated_at=datetime('now')
  WHERE id=@id`);

let created = 0, updated = 0, skipped = 0;
const report = [];

db.transaction(() => {
  for (const it of items) {
    const row = (it.source_url && findByUrl.get(it.source_url)) || findByTitle.get(it.title);
    const payload = {
      title: it.title,
      category: it.category || '动态',
      summary: it.summary || '',
      content: it.content || '',
      source_name: it.source_name || '',
      source_url: it.source_url || '',
      published_at: it.published_at || null,
      sort: Number.isFinite(+it.sort) ? +it.sort : 0
    };
    if (row) {
      // 已存在：默认跳过（保护你在后台手改过的版本）
      if (!force) { skipped++; report.push(['跳过', it.title]); continue; }
      if (!dry) upd.run({ ...payload, id: row.id });
      updated++; report.push(['更新', it.title]);
    } else {
      if (!dry) ins.run(payload);
      created++; report.push(['新增', it.title]);
    }
  }
})();

console.log(`\n资讯入库 ${dry ? '（试运行，未写入）' : ''}`);
console.log(`新增 ${created} · 更新 ${updated} · 跳过 ${skipped}\n`);
report.forEach(([tag, t]) => console.log(`  ${tag === '新增' ? '＋' : tag === '更新' ? '↻' : '·'} [${tag}] ${t}`));
console.log(`\n共 ${items.length} 条；重复执行不会产生副本${force ? '' : '（要覆盖已有条目加 --force）'}\n`);
