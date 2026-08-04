'use strict';
// 演示数据种子：生成模拟读者与过去 120 天的借阅流水，让看板/大屏有真实运营感。
// 仅用于演示，所有数据以 demo_ 开头，可一键重置（再次运行即先清理后重建）。
// 运行：node scripts/seed_demo.js
const db = require('../server/db');
const crypto = require('../server/crypto');

// 1) 清理旧 demo
db.prepare("DELETE FROM borrows WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'demo_%')").run();
db.prepare("DELETE FROM users WHERE username LIKE 'demo_%'").run();
db.prepare('UPDATE books SET available = total').run();

const cats = db.prepare("SELECT DISTINCT category FROM books WHERE category IS NOT NULL AND category<>''").all().map(r => r.category);
const books = db.prepare('SELECT * FROM books').all();
const N = 40;
const BORROW_DAYS = 30;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const insertUser = db.prepare(`INSERT INTO users (username,password_hash,salt,role,name,dept,student_no,max_borrow)
  VALUES (?,?,?,?,?,?,?,?)`);
const insertBorrow = db.prepare(`INSERT INTO borrows
  (user_id,book_id,status,borrow_date,request_date,due_date,approved_at,pickup_date,return_date)
  VALUES (?,?,?,?,?,?,?,?,?)`);

const tx = db.transaction(() => {
  for (let i = 1; i <= N; i++) {
    const username = 'demo_' + String(i).padStart(2, '0');
    const { salt, hash } = crypto.hashPassword('demo123');
    const name = '读者' + i;
    const dept = cats[i % cats.length] + '系';
    const info = insertUser.run(username, hash, salt, '读者', name, dept, '2026' + String(i).padStart(4, '0'), 5);
    const uid = info.lastInsertRowid;
    const nborrow = 1 + Math.floor(Math.random() * 4);
    for (let j = 0; j < nborrow; j++) {
      const book = books[Math.floor(Math.random() * books.length)];
      const age = Math.floor(Math.random() * 120) + 1;
      const bd = daysAgo(age);
      const roll = Math.random();
      let status, due, appr = bd, pick = bd, ret = null;
      if (roll < 0.5) {                 // 已还
        status = '已还'; due = daysAgo(Math.max(0, age - 30)); ret = daysAgo(Math.max(0, age - 15));
      } else if (roll < 0.7) {          // 借出（未到期）
        status = '借出'; due = daysAgo(-(BORROW_DAYS - age));
      } else if (roll < 0.82) {         // 逾期
        status = '逾期'; due = daysAgo(120);
      } else if (roll < 0.92) {         // 待取书
        status = '待取书'; due = daysAgo(-BORROW_DAYS); pick = null;
      } else {                          // 待审批
        status = '待审批'; due = daysAgo(-BORROW_DAYS); appr = null; pick = null;
      }
      insertBorrow.run(uid, book.id, status, bd, bd, due, appr, pick, ret);
    }
  }
});
tx();

// 2) 修正库存：available = total - 进行中(待取书/借出/逾期)
db.prepare(`UPDATE books SET available = total - (SELECT COUNT(*) FROM borrows r WHERE r.book_id=books.id AND r.status IN ('待取书','借出','逾期'))`).run();
db.prepare('UPDATE books SET available = 0 WHERE available < 0').run();

const borrowed = db.prepare("SELECT COUNT(*) c FROM borrows").get().c;
console.log('演示数据已生成：' + N + ' 名读者 + ' + borrowed + ' 条借阅记录');
console.log('读者账号示例：demo_01 / demo123（共 ' + N + ' 个，密码均为 demo123）');
