'use strict';
// 作品目录扫描 CLI：node scripts/scan-works.js [--prune] [--json]
// 默认只标记缺失（隐藏）；--prune 才物理删除缺失记录
const scanner = require('../server/works-scanner');

const args = process.argv.slice(2);
const prune = args.includes('--prune');
const asJson = args.includes('--json');

const r = scanner.scan({ prune });
if (asJson) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}
console.log(`\n扫描目录：public/works/`);
console.log(`共 ${r.total} 件作品｜新增 ${r.created} · 更新 ${r.updated} · 认领 ${r.claimed} · 缺失/清理 ${r.missing}\n`);
for (const it of r.items) {
  const tag = { created: '＋', updated: '↻', claimed: '◎', missing: '⚠', pruned: '✗' }[it.action] || '·';
  console.log(`  ${tag} [${it.action}] ${it.title}  (${it.key})`);
}
if (!r.items.length) console.log('  （无变化）');
if (r.missing && !prune) console.log('\n提示：缺失作品已隐藏但保留记录；确需删除请加 --prune');
console.log('');
