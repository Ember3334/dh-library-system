'use strict';
// 管理端数据链路回归（v2.4）：图书 CRUD / CSV 批量导入幂等 / 封面上传 / HTML 作品建目录
// 用法：先起服务（数文拾光.vbs 或 npm start），再 node scripts/_manage_data_test.js [base]
// 全部测试数据以 TEST- / 03-TEST 开头，跑完自动清理。
const fs = require('fs');
const path = require('path');
require('./env');   // 读取 .env 里的 FOUNDER_PASSCODE

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
let token = '';
let pass = 0, fail = 0;

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`); }
}

async function api(method, p, body) {
  const headers = {};
  let payload;
  if (body && body.__multipart) {
    headers['Content-Type'] = body.contentType;
    payload = body.data;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + p, { method, headers, body: payload });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

function multipart(fields, files) {
  const boundary = '----dhTest' + Math.random().toString(36).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n` +
      `Content-Type: ${f.type}\r\n\r\n`));
    parts.push(f.data);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { __multipart: true, data: Buffer.concat(parts), contentType: 'multipart/form-data; boundary=' + boundary };
}

(async () => {
  console.log(`\n== 管理端数据链路回归 @ ${BASE} ==\n`);

  // 0) 登录
  const passcode = process.env.FOUNDER_PASSCODE || '';
  const login = await api('POST', '/api/manage/login', { passcode });
  ok('口令登录', login.status === 200 && !!login.data.token, JSON.stringify(login.data));
  token = login.data.token || '';

  const before = await api('GET', '/api/overview');
  const total0 = before.data.totalBooks;

  // 1) 单本 CRUD
  const mk = await api('POST', '/api/manage/books', { call_no: 'TEST-001', title: '回归测试书甲', author: '测试者', category: '文学类', total: 2, available: 1 });
  ok('新增图书', mk.status === 200 && !!mk.data.book && mk.data.book.call_no === 'TEST-001', JSON.stringify(mk.data));
  const bid = mk.data.book && mk.data.book.id;
  const dup = await api('POST', '/api/manage/books', { call_no: 'TEST-001', title: '重复索书号' });
  ok('重复索书号 → 409', dup.status === 409, `status=${dup.status}`);
  const badCall = await api('POST', '/api/manage/books', { call_no: '坏/索书号', title: '非法字符' });
  ok('非法索书号 → 400', badCall.status === 400, `status=${badCall.status}`);
  const up = await api('PUT', `/api/manage/books/${bid}`, { title: '回归测试书甲（改）', available: 2 });
  ok('编辑图书', up.status === 200 && up.data.book.title.includes('改') && up.data.book.available === 2, JSON.stringify(up.data));
  const list = await api('GET', '/api/manage/books?q=回归测试&page=1&pageSize=5');
  ok('管理列表检索', list.status === 200 && list.data.total >= 1 && list.data.items.some(b => b.call_no === 'TEST-001'), JSON.stringify(list.data).slice(0, 120));

  // 2) CSV 批量导入 + 幂等
  const csv = [
    '索书号,书名,作者,分类',
    'TEST-001,回归测试书甲（导入覆盖）,测试者,文学类',
    'TEST-002,回归测试书乙,测试者,历史',
    'TEST-003,"带,逗号的书名",测试者,艺术类'
  ].join('\n');
  const imp1 = await api('POST', '/api/manage/books/import', { text: csv, format: 'csv' });
  ok('CSV 导入 created=2 updated=1', imp1.status === 200 && imp1.data.created === 2 && imp1.data.updated === 1, JSON.stringify(imp1.data));
  const imp2 = await api('POST', '/api/manage/books/import', { text: csv, format: 'csv' });
  ok('重复导入幂等 created=0 updated=3', imp2.status === 200 && imp2.data.created === 0 && imp2.data.updated === 3, JSON.stringify(imp2.data));
  const b3 = await api('GET', '/api/manage/books?q=TEST-003');
  ok('带逗号书名入库', b3.data.items && b3.data.items.some(x => x.title === '带,逗号的书名'), JSON.stringify(b3.data).slice(0, 150));

  // 3) 封面上传 → covers 索引即时生效
  const cov = await api('POST', '/api/manage/books/cover?call_no=TEST-001', multipart({}, [
    { name: 'file', filename: 'cover.png', type: 'image/png', data: PNG_1PX }
  ]));
  ok('封面上传', cov.status === 200 && cov.data.url === '/covers/TEST-001.png', JSON.stringify(cov.data));
  ok('封面落盘', fs.existsSync(path.join(__dirname, '../public/covers/TEST-001.png')));
  const pub = await api('GET', '/api/manage/books?q=TEST-001');
  ok('数据层注入 cover 字段', pub.data.items && pub.data.items[0] && pub.data.items[0].cover === '/covers/TEST-001.png', JSON.stringify(pub.data.items && pub.data.items[0] && pub.data.items[0].cover));
  const fakeCover = await api('POST', '/api/manage/books/cover?call_no=TEST-002', multipart({}, [
    { name: 'file', filename: 'fake.png', type: 'image/png', data: Buffer.from('NOT-A-PNG-JUST-TEXT-BYTES-FOR-SNIFF') }
  ]));
  ok('伪图片被魔数拒绝', fakeCover.status === 400, `status=${fakeCover.status}`);

  // 4) HTML 作品直传 → 自动建目录 + 扫描入库
  const html = '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>回归测试作品</title></head><body><h1>OK</h1></body></html>';
  const upl = await api('POST', '/api/manage/works/upload-html', multipart({
    title: '回归测试作品', code: '测试星', issue_no: '3', summary: '自动化回归用', members: '测试者'
  }, [
    { name: 'file', filename: 'index.html', type: 'text/html', data: Buffer.from(html) },
    { name: 'assets', filename: 'a.txt', type: 'text/plain', data: Buffer.from('asset') }
  ]));
  ok('HTML 上传建目录', upl.status === 200 && !!upl.data.work && /^\/works\/03-测试星-回归测试作品/.test(upl.data.work.payload || ''), JSON.stringify(upl.data).slice(0, 200));
  const dirOk = upl.data && upl.data.dir && fs.existsSync(path.join(__dirname, '../', upl.data.dir, 'index.html'))
    && fs.existsSync(path.join(__dirname, '../', upl.data.dir, 'work.json'))
    && fs.existsSync(path.join(__dirname, '../', upl.data.dir, 'assets', 'a.txt'));
  ok('index.html / work.json / assets 齐备', !!dirOk, upl.data && upl.data.dir);
  const pubWorks = await api('GET', '/api/works');
  ok('作品出现在公开列表', (pubWorks.data.works || []).some(w => w.title === '回归测试作品'), '');
  const dupDir = await api('POST', '/api/manage/works/upload-html', multipart({
    title: '回归测试作品', code: '测试星', issue_no: '3'
  }, [{ name: 'file', filename: 'index.html', type: 'text/html', data: Buffer.from(html) }]));
  ok('重名目录自动 -2', dupDir.status === 200 && /-2$/.test(dupDir.data.dir || ''), dupDir.data && dupDir.data.dir);
  const badHtml = await api('POST', '/api/manage/works/upload-html', multipart({}, [
    { name: 'file', filename: 'x.html', type: 'text/html', data: Buffer.from('this is not html at all') }
  ]));
  ok('非 HTML 被拒', badHtml.status === 400, `status=${badHtml.status}`);

  // 5) 清理
  for (const cn of ['TEST-001', 'TEST-002', 'TEST-003']) {
    const find = await api('GET', `/api/manage/books?q=${cn}`);
    for (const it of (find.data.items || [])) await api('DELETE', `/api/manage/books/${it.id}`);
  }
  for (const f of ['TEST-001.png', 'TEST-002.png']) {
    try { fs.unlinkSync(path.join(__dirname, '../public/covers', f)); } catch (e) {}
  }
  if (upl.data && upl.data.dir) {
    try { fs.rmSync(path.join(__dirname, '../', upl.data.dir), { recursive: true, force: true }); } catch (e) {}
  }
  if (dupDir.data && dupDir.data.dir) {
    try { fs.rmSync(path.join(__dirname, '../', dupDir.data.dir), { recursive: true, force: true }); } catch (e) {}
  }
  await api('POST', '/api/manage/works/rescan', { prune: true });
  const after = await api('GET', '/api/overview');
  ok('清理后馆藏数还原', after.data.totalBooks === total0, `${total0} → ${after.data.totalBooks}`);

  console.log(`\n== 结果：${pass} 通过 / ${fail} 失败 ==\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本异常：', e); process.exit(1); });
