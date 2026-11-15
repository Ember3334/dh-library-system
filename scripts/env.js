'use strict';
// 极简 .env 加载器（零依赖）
// 供 server/server.js 与 scripts/launch.js 共用 —— 避免两处各写一份读法不一致
// （历史问题：launch.js 不读 .env，导致 .env 里改 PORT 对启动器无效）

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

/**
 * 读取 .env 并写入 process.env（已存在的键不覆盖，命令行/系统环境优先）
 * @param {string} [file] 自定义路径，默认项目根 .env
 * @returns {Record<string,string>} 解析到的键值对
 */
function loadEnv(file) {
  const target = file || ENV_PATH;
  const parsed = {};
  let text = '';
  try {
    text = fs.readFileSync(target, 'utf-8');
  } catch (e) {
    return parsed;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, '');
    parsed[m[1]] = val;
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
  return parsed;
}

// require 即生效，与旧 server.js 的 IIFE 行为保持一致
loadEnv();

module.exports = { loadEnv, ROOT, ENV_PATH };
