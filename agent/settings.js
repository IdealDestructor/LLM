// ─── settings.js — 用户设置持久化 ────────────────────────────
//
// 存储用户全局设置（主题、预设提示词等）到 data/settings.json
// 与 sessions.js 类似的变更即写策略

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// 默认设置
const DEFAULT_SETTINGS = {
  theme: 'auto',           // 'light' | 'dark' | 'auto'
  systemPrompt: '你是Francis的AI助手。',
  defaultAgentMode: 'chat', // 'chat' | 'agent'
};

let settings = { ...DEFAULT_SETTINGS };

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 加载设置
function load() {
  ensureDir();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      settings = { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (e) {
    console.warn('⚠️ 加载设置失败:', e.message);
  }
  return settings;
}

// 保存设置（合并写入）
function save(updates) {
  settings = { ...settings, ...updates };
  ensureDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  return settings;
}

// 获取设置
function get() {
  return settings;
}

module.exports = { load, save, get, DEFAULT_SETTINGS };
