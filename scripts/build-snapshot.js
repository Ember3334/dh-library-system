'use strict';
// 生成离线只读快照：node scripts/build-snapshot.js [--slim]
// 产物：public/data/snapshot.js（双击 public/index.html 即可离线浏览）
const snap = require('../server/snapshot');

const slim = process.argv.includes('--slim');
const r = snap.write({ slim });
console.log(`\n✅ 离线快照已生成：${r.file}（${r.kb} KB）${slim ? '（精简 intro）' : ''}`);
console.log(`   现在直接双击 public/index.html 就能离线浏览（只读，AI 与管理入口自动隐藏）\n`);
