'use strict';
// 内容字段校验：作品 payload / 封面 / 外链
// 目的：① 防属性注入（payload 会直接进 iframe src）② 防 javascript: 伪协议 ③ 防目录穿越

const REL_PREFIXES = ['/works/', '/media/', '/covers/', '/img/'];

function isRelativeAsset(p) {
  if (typeof p !== 'string' || !p) return false;
  if (!p.startsWith('/')) return false;
  if (p.includes('..') || p.includes('\\')) return false;
  if (/[\u0000-\u001f"'<>]/.test(p)) return false;   // 控制字符与引号一律拒绝
  return REL_PREFIXES.some(pre => p.startsWith(pre));
}

// 外链：只允许 http/https，且不允许带账号密码（http://user:pass@host 这类钓鱼形式）
function url(value, opts = {}) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return opts.allowEmpty ? { value: '' } : { error: '链接不能为空' };
  if (/[\u0000-\u001f"'\s<>]/.test(v)) return { error: '链接含非法字符' };
  let u;
  try { u = new URL(v); } catch (e) { return { error: '链接格式不正确（需以 http:// 或 https:// 开头）' }; }
  if (!/^https?:$/i.test(u.protocol)) return { error: '只支持 http / https 链接' };
  if (u.username || u.password) return { error: '链接不允许包含账号密码' };
  if (!u.hostname || !u.hostname.includes('.')) return { error: '链接域名不完整' };
  return { value: u.href };
}

// 作品载荷：html/image/video 必须是站内相对路径；link 必须是外链
function payload(type, value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return { value: '' };                       // 允许空（占位「作品文件整理中」）
  if (type === 'link') return url(v);
  if (!isRelativeAsset(v)) {
    return { error: '作品文件路径必须以 /works/ 或 /media/ 开头（外部链接请把类型改成「外部链接」）' };
  }
  return { value: v };
}

// 封面等可空资源路径：非法则回落空（不阻断保存）
function assetPath(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (isRelativeAsset(v)) return v;
  if (/^https:\/\//i.test(v) && !/[\u0000-\u001f"'\s<>]/.test(v)) return v;  // 允许 https 图床
  return '';
}

module.exports = { url, payload, assetPath, isRelativeAsset };
