'use strict';
const http = require('http');

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const r = http.request({
      host: 'localhost', port: 3000, path, method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {})
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch (e) { resolve({ status: res.statusCode, body: d }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const out = {};
  // 1. 分类筛选计数
  const wen = await req('GET', '/api/books?category=' + encodeURIComponent('文学类') + '&pageSize=1');
  out.filter_文学类_total = wen.body.total;

  // 2. 详情含 call_no / price
  const det = await req('GET', '/api/books/1');
  out.detail_has_callno = !!det.body.book.call_no;
  out.detail_has_price = !!det.body.book.price;

  // 3. 馆员登录
  const login = await req('POST', '/api/auth/login', { username: 'librarian', password: 'lib12345' });
  const token = login.body.token;
  out.login_ok = !!token;

  // 4. 馆员新增一本（带 call_no 与 price）
  const create = await req('POST', '/api/books', {
    title: '验证新书_按编码添加', call_no: 'TEST-001', isbn: '9780000000001',
    author: '测试作者', publisher: '测试社', year: '2026', price: '42.00',
    category: '文学类', tags: 'test', location: 'Z9-99', total: 2
  }, token);
  out.create_status = create.status;
  out.created_callno = create.body.book && create.body.book.call_no;
  out.total_after_create = (await req('GET', '/api/books?pageSize=1')).body.total;

  // 5. 重复按索书号导入（幂等）：用同一 call_no 再导入，应 skipped / 0 added
  const seed = require('../data/seed-books.json').books;
  const imp = await req('POST', '/api/books/import', { format: 'json', mode: 'add', data: seed }, token);
  out.import_again_added = imp.body.added;
  out.import_again_skipped = imp.body.skipped;
  out.total_after_reimport = (await req('GET', '/api/books?pageSize=1')).body.total;

  // 6. 按索书号更新模式：修改 TEST-001 的 price，应 updated
  const upd = await req('POST', '/api/books/import', { format: 'json', mode: 'update', data: [{ call_no: 'TEST-001', title: '验证新书_按编码添加', price: '99.00', category: '文学类', total: 2 }] }, token);
  out.update_mode_updated = upd.body.updated;
  const det2 = await req('GET', '/api/books/' + create.body.book.id);
  out.updated_price = det2.body.book.price;

  // 7. 封面回退：请求一个不存在的封面，应 404（前端回退占位）
  const cov = await req('GET', '/covers/TEST-001.jpg');
  out.cover_missing_status = cov.status;

  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error('ERR', e); process.exit(1); });
