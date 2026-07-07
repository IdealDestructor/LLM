// ─── settings.js — 用户设置持久化（SQLite） ──────────────────
//
// 从 JSON 文件迁移到 SQLite 的 settings 表（key-value 结构）
// 启动时自动从旧 data/settings.json 迁移数据
// 保持原有导出 API: load / save / get / DEFAULT_SETTINGS

const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

// 默认设置
const DEFAULT_SETTINGS = {
  theme: 'auto',              // 'light' | 'dark' | 'auto'
  systemPrompt: '你是Francis的AI助手。',
  defaultAgentMode: 'chat',    // 'chat' | 'agent'
  defaultMaxTokens: 4096,
  systemPromptTemplates: [],   // [{ name, content }]
  mcpServers: [],              // [{ name, type, command, args, url, enabled }]
  enabledPlugins: [],          // string[] — 启用的插件名称列表
  enabledSkills: [],           // string[] — 启用的技能名称列表
  disabledTools: [],           // string[] — 禁用的工具名称列表
};

let settings = { ...DEFAULT_SETTINGS };

// ─── 从旧 JSON 文件迁移数据 ────────────────────────────────
function migrateFromJson() {
  const jsonFile = path.resolve(__dirname, 'data', 'settings.json');
  if (!fs.existsSync(jsonFile)) return false;

  try {
    const raw = fs.readFileSync(jsonFile, 'utf-8');
    const parsed = JSON.parse(raw);
    const db = getDb();

    for (const [key, value] of Object.entries(parsed)) {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(key, JSON.stringify(value));
    }

    // 迁移成功后重命名旧文件
    fs.renameSync(jsonFile, jsonFile + '.migrated');
    console.log('  旧 settings.json 已迁移到 SQLite');
    return true;
  } catch (e) {
    console.warn('  旧 settings.json 迁移失败:', e.message);
    return false;
  }
}

// 加载设置（从 SQLite 读取，合并默认值）
function load() {
  const db = getDb();

  // 先尝试从旧 JSON 迁移
  migrateFromJson();

  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = {};
  for (const row of rows) {
    try { stored[row.key] = JSON.parse(row.value); } catch { stored[row.key] = row.value; }
  }

  settings = { ...DEFAULT_SETTINGS, ...stored };
  return settings;
}

// 保存设置（合并写入到 SQLite）
function save(updates) {
  const db = getDb();
  settings = { ...settings, ...updates };

  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const upsertMany = db.transaction((entries) => {
    for (const [key, value] of entries) {
      upsert.run(key, JSON.stringify(value));
    }
  });
  upsertMany(Object.entries(updates));

  return settings;
}

// 获取当前设置（内存缓存，不查库）
function get() {
  return settings;
}

module.exports = { load, save, get, DEFAULT_SETTINGS };
