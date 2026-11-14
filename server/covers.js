'use strict';
// 封面索引：扫描 public/covers/ 下的真实 jpg，供数据层注入 book.cover。
// 目的：696 本馆藏里没有封面的书不再对 /covers/<索书号>.jpg 发必 404 的请求——
// 前端只有 cover 字段有值才发 <img>，无封面直接走 SVG 生成书封（零请求、零破图）。
// 约定不变：把 <索书号>.jpg 丢进 public/covers/ 即自动生效（重启或重新扫描后）。
const fs = require('fs');
const path = require('path');

const COVERS_DIR = path.join(__dirname, '../public/covers');
let index = new Set();

function scan() {
  try {
    index = new Set(
      fs.readdirSync(COVERS_DIR)
        .filter(f => /\.jpe?g$/i.test(f))
        .map(f => f.replace(/\.(jpe?g)$/i, ''))
    );
  } catch (e) { index = new Set(); }
  return index.size;
}

function hasCover(callNo) {
  return !!callNo && index.has(String(callNo));
}

// 管理端上传封面后可调用刷新（不必重启）
function invalidate() { return scan(); }

scan();

module.exports = { hasCover, invalidate, scan, COVERS_DIR };
