'use strict';
const express = require('express');
const db = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./crypto');

const router = express.Router();

// 解析 Bearer token
function getUserFromReq(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return verifyToken(m[1]);
  if (req.cookies && req.cookies.token) return verifyToken(req.cookies.token);
  return null;
}

function requireAuth(req, res, next) {
  const u = getUserFromReq(req);
  if (!u) return res.status(401).json({ error: '未登录或登录已过期' });
  req.user = u;
  next();
}

// 角色校验：requireRole('馆员','管理员')
function requireRole(...roles) {
  return (req, res, next) => {
    const u = getUserFromReq(req);
    if (!u) return res.status(401).json({ error: '未登录或登录已过期' });
    if (!roles.includes(u.role)) return res.status(403).json({ error: '权限不足' });
    req.user = u;
    next();
  };
}

function publicUser(row) {
  if (!row) return null;
  const { password_hash, salt, ...rest } = row;
  return rest;
}

// 注册（仅读者自助注册）
router.post('/register', (req, res) => {
  const { username, password, name, dept, student_no } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '账号和密码必填' });
  if (String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  const exists = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (exists) return res.status(409).json({ error: '该账号已存在' });
  const { salt, hash } = hashPassword(password);
  const info = db.prepare(`INSERT INTO users (username,password_hash,salt,role,name,dept,student_no)
    VALUES (?,?,?,?,?,?,?)`).run(username, hash, salt, '读者', name || username, dept || '', student_no || '');
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  const token = signToken({ uid: user.id, role: user.role, username: user.username });
  res.json({ token, user: publicUser(user) });
});

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '账号和密码必填' });
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !verifyPassword(password, user.salt, user.password_hash))
    return res.status(401).json({ error: '账号或密码错误' });
  const token = signToken({ uid: user.id, role: user.role, username: user.username });
  res.json({ token, user: publicUser(user) });
});

// 当前用户
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.uid);
  res.json({ user: publicUser(user) });
});

module.exports = { router, requireAuth, requireRole, getUserFromReq, publicUser };
