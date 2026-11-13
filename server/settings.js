'use strict';
// 站点文案读写：settings 表只存覆盖值，读时与 defaults 合并
const db = require('./db');
const { DEFAULTS, SCHEMA, SCHEMA_KEYS } = require('./defaults');

function mergedSettings() {
  const out = Object.assign({}, DEFAULTS);
  try {
    db.prepare('SELECT key,value FROM settings').all().forEach(r => {
      if (!(r.key in DEFAULTS)) return;            // 只认已声明的 key，防止脏数据污染
      if (r.value !== null && r.value !== undefined && r.value !== '') out[r.key] = r.value;
    });
  } catch (e) { /* 首次启动表可能还没建好，回落默认值 */ }
  return out;
}

function getSetting(key) {
  return mergedSettings()[key];
}

// 批量写入；空字符串 = 删除覆盖（回落默认值）
function saveSettings(patch) {
  const up = db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
  const del = db.prepare('DELETE FROM settings WHERE key=?');
  const saved = [];
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch || {})) {
      if (!SCHEMA_KEYS.includes(k)) continue;      // 白名单：只允许 schema 里声明的 key
      const val = v === null || v === undefined ? '' : String(v);
      if (val === '') del.run(k); else up.run(k, val);
      saved.push(k);
    }
  })();
  return saved;
}

function resetSettings() {
  db.prepare('DELETE FROM settings').run();
}

module.exports = { mergedSettings, getSetting, saveSettings, resetSettings, SCHEMA };
