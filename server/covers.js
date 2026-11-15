'use strict';
// 封面索引：扫描 public/covers/ 下的真实图片，供数据层注入 book.cover。
// 目的：696 本馆藏里没有封面的书不再对 /covers/<索书号>.jpg 发必 404 的请求——
// 前端只有 cover 字段有值才发 <img>，无封面直接走 SVG 生成书封（零请求、零破图）。
// 约定：<索书号>.jpg / .png / .webp 丢进 public/covers/ 即自动生效
//（管理端上传接口写完文件会即时 invalidate，手工放文件则等重启或重新扫描）。
const fs = require('fs');
const path = require('path');

const COVERS_DIR = path.join(__dirname, '../public/covers');
const EXT_RE = /\.(jpe?g|png|webp)$/i;
let index = new Map();   // 索书号 → 带扩展名的文件名

function scan() {
  try {
    const m = new Map();
    for (const f of fs.readdirSync(COVERS_DIR)) {
      const mt = f.match(EXT_RE);
      if (mt) m.set(f.slice(0, -mt[0].length), f);
    }
    index = m;
  } catch (e) { index = new Map(); }
  return index.size;
}

function hasCover(callNo) {
  return !!callNo && index.has(String(callNo));
}

function coverUrl(callNo) {
  if (!hasCover(callNo)) return null;
  return '/covers/' + index.get(String(callNo));
}

// 管理端上传封面后可调用刷新（不必重启）
function invalidate() { return scan(); }

scan();

module.exports = { hasCover, coverUrl, invalidate, scan, COVERS_DIR };
