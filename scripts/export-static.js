'use strict';
// CLI：node scripts/export-static.js
// 一键导出纯静态只读站点到 dist-static/（行为同管理端「发布」按钮）
const path = require('path');
const publish = require('../server/publish');

(async () => {
  console.log('⏳ 正在导出静态版…');
  const stat = await publish.exportStatic();
  console.log('✅ 发布完成 → dist-static/');
  console.log(`   馆藏 ${stat.books} 本 · 摘星辰作品 ${stat.works} 件 · 资讯 ${stat.posts} 条`);
  console.log(`   文件 ${stat.files} 个 · 总体积 ${(stat.totalBytes / 1024 / 1024).toFixed(2)} MB · 耗时 ${stat.elapsedMs} ms`);
  console.log('');
  console.log('本地预览静态版（任选其一）：');
  console.log('  npx serve dist-static');
  console.log(`  python -m http.server 8088 --directory dist-static   →  http://localhost:8088`);
  console.log('');
  console.log('上线：把 dist-static/ 整个目录推到 GitHub Pages / Vercel / 任意静态托管即可。');
  console.log('提示：静态版为只读展示（无管理端 / 无 AI），管理内容请回到本地版 #/manage。');
})().catch(e => { console.error('❌ 发布失败：', e.message); process.exit(1); });
