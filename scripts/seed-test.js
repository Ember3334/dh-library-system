'use strict';
// 可选的压测/演示数据脚本：生成 2000 测试读者 + 随机借阅，用于验证容量与看板。
// 用法： node scripts/seed-test.js        （生成）
//       node scripts/seed-test.js clean   （清理测试数据）
const db = require('../server/db');
const { hashPassword } = require('../server/crypto');

const PREFIX = 'seed_';

function clean() {
  const ids = db.prepare(`SELECT id FROM users WHERE username LIKE ?`).all(PREFIX + '%').map(r => r.id);
  if (!ids.length) return console.log('[clean] 无测试数据');
  db.prepare(`DELETE FROM borrows WHERE user_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  db.prepare(`DELETE FROM users WHERE username LIKE ?`).run(PREFIX + '%');
  console.log(`[clean] 已删除 ${ids.length} 个测试读者及其借阅记录`);
}

function seed() {
  const books = db.prepare('SELECT id,available FROM books').all();
  if (!books.length) return console.log('[seed] 请先有书目数据');
  const N = 2000;
  const ins = db.prepare(`INSERT INTO users (username,password_hash,salt,role,name,dept,max_borrow)
    VALUES (?,?,?,?,?,?,?)`);
  const h = hashPassword('test123');
  const tx = db.transaction(() => {
    for (let i = 1; i <= N; i++) {
      const u = `${PREFIX}${String(i).padStart(4, '0')}`;
      ins.run(u, h.hash, h.salt, '读者', `测试读者${i}`, '数字人文学院', 5);
    }
  });
  tx();
  console.log(`[seed] 已生成 ${N} 个测试读者（密码 test123）`);

  // 随机借阅 ~800 条
  const users = db.prepare(`SELECT id FROM users WHERE username LIKE ?`).all(PREFIX + '%').map(r => r.id);
  const borrow = db.prepare(`INSERT INTO borrows (user_id,book_id,borrow_date,due_date,status)
    VALUES (?,?,?,?,?)`);
  const decAvail = db.prepare('UPDATE books SET available=MAX(0,available-1) WHERE id=?');
  let cnt = 0;
  const tx2 = db.transaction(() => {
    for (let i = 0; i < 800; i++) {
      const uid = users[Math.floor(Math.random() * users.length)];
      const bk = books[Math.floor(Math.random() * books.length)];
      const daysAgo = Math.floor(Math.random() * 40);
      const borrowDate = `datetime('now','-${daysAgo} days')`;
      const dueOffset = 30 - daysAgo - (Math.random() < 0.3 ? 20 : 0); // 部分逾期
      const due = `datetime('now','${dueOffset} days')`;
      const status = dueOffset < 0 ? '逾期' : '借出';
      borrow.run(uid, bk.id, borrowDate, due, status);
      if (status !== '逾期') decAvail.run(bk.id);
      cnt++;
    }
  });
  tx2();
  console.log(`[seed] 已生成 ${cnt} 条借阅记录（含部分逾期）`);
}

const arg = process.argv[2];
if (arg === 'clean') clean(); else seed();
console.log('[done] 运行 node scripts/seed-test.js clean 可清除测试数据');
