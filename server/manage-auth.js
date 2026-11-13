'use strict';
// 创始人管理鉴权：单口令 → HMAC token
// 口令来源：环境变量 FOUNDER_PASSCODE（.env 文件由 server.js 启动时加载）
// 未配置时自动生成随机口令并写回 .env，同时在控制台打印一次
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./crypto');

const DATA_DIR = path.join(__dirname, '../data');
const ENV_PATH = path.join(__dirname, '../.env');

// 读取 / 生成口令
function ensurePasscode() {
  let passcode = process.env.FOUNDER_PASSCODE || '';
  if (!passcode) {
    passcode = crypto.randomBytes(9).toString('base64url');
    try {
      const line = `\nFOUNDER_PASSCODE=${passcode}\n`;
      fs.appendFileSync(ENV_PATH, line);
      console.log('\n[manage] 未配置 FOUNDER_PASSCODE，已自动生成并写入 .env：');
      console.log('  管理口令 ▶ ' + passcode + '\n');
    } catch (e) {
      console.log('[manage] 管理口令（本次启动有效，建议写入 .env）：' + passcode);
    }
    process.env.FOUNDER_PASSCODE = passcode;
  }
  return passcode;
}

// 口令哈希持久化（scrypt 常数时间比较，避免明文驻留内存）
const founderFile = path.join(DATA_DIR, 'founder.json');
function getFounderRecord() {
  const passcode = ensurePasscode();
  try {
    const rec = JSON.parse(fs.readFileSync(founderFile, 'utf-8'));
    if (verifyPassword(passcode, rec.salt, rec.hash)) return rec;
  } catch (e) { /* 不存在或口令已变更 → 重建 */ }
  const rec = hashPassword(passcode);
  fs.writeFileSync(founderFile, JSON.stringify({ salt: rec.salt, hash: rec.hash, updated: new Date().toISOString() }));
  return rec;
}

// 登录限速：同 IP 每分钟最多 5 次
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const arr = (attempts.get(ip) || []).filter(t => now - t < 60000);
  attempts.set(ip, arr);
  return arr.length >= 5;
}
function recordAttempt(ip) { attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]); }

function login(passcode, ip) {
  if (tooMany(ip || '?')) return { error: '尝试过于频繁，请 1 分钟后再试' };
  recordAttempt(ip || '?');
  const rec = getFounderRecord();
  if (!verifyPassword(String(passcode || ''), rec.salt, rec.hash)) return { error: '口令不正确' };
  attempts.delete(ip || '?');
  return { token: signToken({ role: 'founder' }) };
}

function requireFounder(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'founder') return res.status(401).json({ error: '需要创始人权限，请先在管理端解锁' });
  req.founder = payload;
  next();
}

module.exports = { login, requireFounder };
