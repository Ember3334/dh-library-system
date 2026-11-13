'use strict';
// 作品目录扫描器：public/works/ → works 表
// 约定（一层一个作品）：
//   public/works/我的作品.html                  单文件
//   public/works/01-少微星-古字灯影/index.html    目录型（可带 assets/、work.json）
// 幂等键：source_key（相对路径，POSIX 分隔 + NFC 归一）
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '../public');
const WORKS_DIR = path.join(PUBLIC_DIR, 'works');

const SKIP = /^(\.|_|README|readme|node_modules|dist)/;
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function normKey(rel) {
  return rel.replace(/\\/g, '/').normalize('NFC');
}
function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function readText(file, limit) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(limit || 262144);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.subarray(0, n).toString('utf-8');
    } finally { fs.closeSync(fd); }
  } catch (e) { return ''; }
}
// 从 HTML 头部提取标题/简介（只读前 256KB，零依赖）
function metaFromHtml(file) {
  const head = readText(file, 262144);
  const pick = (re) => { const m = head.match(re); return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : ''; };
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i)
    || pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const desc = pick(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)
    || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i);
  const cover = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  return { title, desc, cover: /^https?:\/\//i.test(cover) ? cover : '' };
}
// 目录名 → 期数/代号：支持「01-少微星-古字灯影」「第一期-少微星」「2 东壁星 九星照黔」
function parseDirName(name) {
  const parts = String(name).split(/[-_\s]+/).filter(Boolean);
  const out = {};
  if (parts.length >= 2) {
    const first = parts[0].replace(/^第/, '').replace(/期$/, '');
    const n = CN_NUM[first] !== undefined ? CN_NUM[first] : parseInt(first, 10);
    if (Number.isFinite(n) && n > 0 && n < 100) { out.issue_no = n; parts.shift(); }
  }
  if (parts.length >= 2) out.code = parts.shift();
  if (parts.length) out.title = parts.join(' ');
  return out;
}

function listWorks() {
  const found = [];
  if (!fs.existsSync(WORKS_DIR)) return found;
  const entries = fs.readdirSync(WORKS_DIR, { withFileTypes: true })
    .filter(e => !SKIP.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  for (const ent of entries) {
    const full = path.join(WORKS_DIR, ent.name);
    if (ent.isFile() && /\.html?$/i.test(ent.name)) {
      found.push({ htmlPath: full, dir: WORKS_DIR, metaFile: full.replace(/\.html?$/i, '.json'), single: true });
      continue;
    }
    if (!ent.isDirectory()) continue;
    if (fs.existsSync(path.join(full, 'index.html'))) {
      found.push({ htmlPath: path.join(full, 'index.html'), dir: full, metaFile: path.join(full, 'work.json'), single: false });
      continue;
    }
    // 目录里没有 index.html：再探一层（如 works/第一期/少微星/index.html）
    for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
      if (!sub.isDirectory() || SKIP.test(sub.name)) continue;
      const subFull = path.join(full, sub.name);
      if (fs.existsSync(path.join(subFull, 'index.html'))) {
        found.push({ htmlPath: path.join(subFull, 'index.html'), dir: subFull, metaFile: path.join(subFull, 'work.json'), single: false });
      }
    }
  }
  return found;
}

function readMetaFile(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const j = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return (j && typeof j === 'object') ? j : {};
  } catch (e) {
    console.warn('[works] work.json 解析失败，已忽略：' + file + ' — ' + e.message);
    return {};
  }
}

// 返回 { created, updated, missing, claimed, total, items: [{key,title,action}] }
function scan(opts = {}) {
  const db = require('./db');
  const rows = db.prepare('SELECT * FROM works').all();
  const byKey = new Map(rows.filter(r => r.source_key).map(r => [r.source_key, r]));

  const stat = { created: 0, updated: 0, missing: 0, claimed: 0, total: 0, items: [] };
  const seen = new Set();

  for (const item of listWorks()) {
    const relHtml = normKey(path.relative(PUBLIC_DIR, item.htmlPath));
    const relDir = normKey(path.relative(PUBLIC_DIR, item.dir));
    const key = relHtml;
    seen.add(key);

    let st;
    try { st = fs.statSync(item.htmlPath); } catch (e) { continue; }
    const html = metaFromHtml(item.htmlPath);
    const jm = readMetaFile(item.metaFile);
    const nameSeed = item.single
      ? path.basename(item.htmlPath).replace(/\.html?$/i, '')
      : path.basename(item.dir);
    const fromName = parseDirName(nameSeed);
    const title = String(jm.title || html.title || fromName.title || nameSeed).trim();
    const summary = String(jm.summary || html.desc || '').trim();
    const issue = jm.issue_no != null ? parseInt(jm.issue_no, 10) : (fromName.issue_no || null);
    const code = jm.code || fromName.code || '';
    const cover = jm.cover ? String(jm.cover) : (html.cover || '');
    const mode = jm.mode === 'window' ? 'window' : 'embed';

    const desired = {
      code,
      issue_no: Number.isFinite(issue) ? issue : 1,
      title,
      summary,
      members: jm.members || '',
      type: 'html',
      payload: '/' + relHtml,
      cover: cover || '',
      tags: jm.tags || '',
      org: jm.org || '数文拾光协会',
      published_at: jm.published_at || null,
      sort: Number.isFinite(+jm.sort) ? +jm.sort : 0,
      visible: jm.visible === 0 ? 0 : 1,
      mode,
      source_key: key,
      source_path: '/' + relHtml,
      source_mtime: Math.floor(st.mtimeMs),
      auto: 1,
      source_state: 'ok'
    };

    const cur = byKey.get(key);
    if (cur) {
      // 已存在：内容有变化才写（避免每次启动都 UPDATE 出脏时间戳）
      const changed = cur.title !== desired.title || (cur.summary || '') !== desired.summary
        || cur.payload !== desired.payload || (cur.issue_no || 0) !== desired.issue_no
        || (cur.code || '') !== desired.code || (cur.mode || 'embed') !== desired.mode
        || (cur.cover || '') !== desired.cover || cur.source_state !== 'ok'
        || (cur.source_mtime || 0) !== desired.source_mtime;
      if (changed) {
        db.prepare(`UPDATE works SET code=@code,issue_no=@issue_no,title=@title,summary=@summary,members=@members,
          type=@type,payload=@payload,cover=@cover,tags=@tags,org=@org,sort=@sort,visible=@visible,mode=@mode,
          source_key=@source_key,source_path=@source_path,source_mtime=@source_mtime,auto=1,source_state='ok',
          published_at=COALESCE(@published_at, published_at), updated_at=datetime('now') WHERE id=@id`)
          .run({ ...desired, id: cur.id });
        stat.updated++;
        stat.items.push({ key, title, action: 'updated', id: cur.id });
      }
    } else {
      // 未匹配到：先尝试「认领」同名的历史手工记录（source_key 为空），避免重复条目
      const legacy = rows.find(r => !r.source_key && r.title && (
        r.title.replace(/\s/g, '') === title.replace(/\s/g, '')
        || title.replace(/\s/g, '').includes(r.title.replace(/\s/g, '').slice(0, 6))
      ));
      if (legacy) {
        db.prepare(`UPDATE works SET code=@code,issue_no=@issue_no,title=@title,summary=@summary,members=@members,
          type=@type,payload=@payload,cover=@cover,tags=@tags,org=@org,sort=@sort,visible=@visible,mode=@mode,
          source_key=@source_key,source_path=@source_path,source_mtime=@source_mtime,auto=1,source_state='ok',
          published_at=COALESCE(@published_at, published_at), updated_at=datetime('now') WHERE id=@id`)
          .run({ ...desired, id: legacy.id });
        legacy.source_key = key;                     // 防止同一行被认领两次
        stat.claimed++;
        stat.items.push({ key, title, action: 'claimed', id: legacy.id });
      } else {
        const info = db.prepare(`INSERT INTO works (code,issue_no,title,summary,members,type,payload,cover,tags,org,
          published_at,sort,visible,mode,source_key,source_path,source_mtime,auto,source_state,updated_at)
          VALUES (@code,@issue_no,@title,@summary,@members,@type,@payload,@cover,@tags,@org,
          COALESCE(@published_at,datetime('now')),@sort,@visible,@mode,@source_key,@source_path,@source_mtime,1,'ok',datetime('now'))`)
          .run(desired);
        stat.created++;
        stat.items.push({ key, title, action: 'created', id: info.lastInsertRowid });
      }
    }
    stat.total++;
  }

  // 文件消失 → 标记 missing + 隐藏（永不物理删除，避免误删手工整理的内容）
  for (const r of rows) {
    if (!r.source_key || seen.has(r.source_key)) continue;
    if (r.source_state === 'missing') continue;
    if (opts.prune) {
      db.prepare('DELETE FROM works WHERE id=?').run(r.id);
      stat.items.push({ key: r.source_key, title: r.title, action: 'pruned', id: r.id });
    } else {
      db.prepare("UPDATE works SET source_state='missing', visible=0, updated_at=datetime('now') WHERE id=?").run(r.id);
      stat.items.push({ key: r.source_key, title: r.title, action: 'missing', id: r.id });
    }
    stat.missing++;
  }
  return stat;
}

module.exports = { scan, listWorks, WORKS_DIR, parseDirName, metaFromHtml };
