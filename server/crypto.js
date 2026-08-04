'use strict';
// 零依赖的身份与令牌工具：scrypt 密码哈希 + HMAC 签名 token
const crypto = require('crypto');

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dh-library-dev-secret-change-me';
const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24h

function randomSalt() {
  return crypto.randomBytes(16).toString('hex');
}

// 返回 { salt, hash }
function hashPassword(password, salt = randomSalt()) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(String(password), salt, 64).toString('hex');
  // 定长比较，防时序攻击
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}
function fromB64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

// 签发无状态 token：header.payload.sign
function signToken(payload) {
  const body = { ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL };
  const h = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const p = b64urlJson(body);
  const sig = b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(`${h}.${p}`).digest());
  if (sig !== expected) return null;
  let body;
  try { body = JSON.parse(fromB64url(p).toString('utf8')); } catch { return null; }
  if (body.exp && Date.now() > body.exp) return null;
  return body;
}

module.exports = { randomSalt, hashPassword, verifyPassword, signToken, verifyToken, TOKEN_TTL };
