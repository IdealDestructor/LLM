// ─── sessions.js — 会话隔离 + SQLite 持久化 + Redis 缓存 ───
//
// 持久化：SQLite data/agent.db（权威数据源）
// 缓存：Redis cache-aside（可选，REDIS_URL 未配置时禁用）
//
// 多模态支持：
// - content 字段可存纯文本或 JSON 字符串（OpenAI vision 数组格式）
// - images 字段存图片 URL JSON 数组（用于前端展示）

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const redis = require('./redis');

const DEFAULT_SYSTEM_PROMPT = '你是Francis的AI助手。';

// ─── 从旧 JSON 文件迁移数据 ────────────────────────────────
function migrateFromJson() {
  const jsonDir = path.resolve(__dirname, 'data', 'sessions');
  if (!fs.existsSync(jsonDir)) return 0;

  const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return 0;

  const db = getDb();
  let migrated = 0;

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(jsonDir, file), 'utf-8');
      const session = JSON.parse(raw);
      if (!session.meta?.id || !Array.isArray(session.messages)) continue;

      const existing = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(session.meta.id);
      if (existing) continue;

      db.prepare(`
        INSERT INTO sessions (id, title, created_at, system_prompt)
        VALUES (?, ?, ?, ?)
      `).run(session.meta.id, session.meta.title || '新对话', session.meta.createdAt || Date.now(), null);

      const insertMsg = db.prepare(`
        INSERT INTO messages (session_id, role, content, images, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((msgs) => {
        for (const msg of msgs) {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          const images = msg.images ? JSON.stringify(msg.images) : null;
          insertMsg.run(session.meta.id, msg.role, content, images, Date.now());
        }
      });
      insertMany(session.messages);
      migrated++;
    } catch (e) {
      console.warn(`迁移会话文件失败: ${file}`, e.message);
    }
  }

  if (migrated > 0) {
    const backupDir = path.resolve(__dirname, 'data', 'sessions_migrated');
    try {
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true });
      fs.renameSync(jsonDir, backupDir);
      console.log(`  旧 JSON 会话已备份到 data/sessions_migrated/`);
    } catch (e) {
      console.warn(`  旧 JSON 目录备份失败:`, e.message);
    }
  }
  return migrated;
}

function generateId() {
  return crypto.randomUUID();
}

function parseContent(content) {
  if (!content) return '';
  if (content.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return content;
}

// ─── SQLite 读写（内部同步实现） ───────────────────────────

function getFromDb(sessionId) {
  const db = getDb();
  const meta = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!meta) return null;

  const rows = db.prepare(`
    SELECT role, content, images FROM messages
    WHERE session_id = ? ORDER BY id ASC
  `).all(sessionId);

  const messages = rows.map(r => {
    const msg = { role: r.role, content: parseContent(r.content) };
    if (r.images) { try { msg.images = JSON.parse(r.images); } catch {} }
    return msg;
  });

  return {
    meta: { id: meta.id, title: meta.title, createdAt: meta.created_at },
    messages,
  };
}

function createInDb(title, systemPrompt) {
  const db = getDb();
  const id = generateId();

  db.prepare(`
    INSERT INTO sessions (id, title, created_at, system_prompt)
    VALUES (?, ?, ?, ?)
  `).run(id, title || '新对话', Date.now(), systemPrompt || null);

  db.prepare(`
    INSERT INTO messages (session_id, role, content, images, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, 'system', systemPrompt || DEFAULT_SYSTEM_PROMPT, null, Date.now());

  return id;
}

function appendMessageInDb(sessionId, role, content, images) {
  const db = getDb();
  const session = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return false;

  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  const imagesStr = images && images.length > 0 ? JSON.stringify(images) : null;

  db.prepare(`
    INSERT INTO messages (session_id, role, content, images, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, role, contentStr, imagesStr, Date.now());

  return true;
}

function updateTitleInDb(sessionId, title) {
  const db = getDb();
  const result = db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sessionId);
  return result.changes > 0;
}

function removeFromDb(sessionId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  return result.changes > 0;
}

function listFromDb() {
  const db = getDb();
  return db.prepare('SELECT id, title, created_at FROM sessions ORDER BY created_at DESC').all()
    .map(r => ({ id: r.id, title: r.title, createdAt: r.created_at }));
}

// ─── 公开 API（async，含 Redis cache-aside） ───────────────

async function create(title, systemPrompt) {
  const id = createInDb(title, systemPrompt);
  const session = getFromDb(id);
  await redis.setSession(id, session);
  await redis.invalidateList();
  return id;
}

async function get(sessionId) {
  const cached = await redis.getSession(sessionId);
  if (cached) return cached;

  const session = getFromDb(sessionId);
  if (session) await redis.setSession(sessionId, session);
  return session;
}

async function getMessages(sessionId) {
  const session = await get(sessionId);
  return session ? session.messages : undefined;
}

async function appendMessage(sessionId, role, content, images) {
  const ok = appendMessageInDb(sessionId, role, content, images);
  if (!ok) return false;

  const session = getFromDb(sessionId);
  if (session) await redis.setSession(sessionId, session);
  return true;
}

async function updateTitle(sessionId, title) {
  const ok = updateTitleInDb(sessionId, title);
  if (!ok) return false;

  const session = getFromDb(sessionId);
  if (session) await redis.setSession(sessionId, session);
  await redis.invalidateList();
  return true;
}

async function remove(sessionId) {
  const ok = removeFromDb(sessionId);
  if (!ok) return false;

  await redis.deleteSession(sessionId);
  await redis.invalidateList();
  return true;
}

async function list() {
  const cached = await redis.getSessionList();
  if (cached) return cached;

  const items = listFromDb();
  await redis.setSessionList(items);
  return items;
}

function stats() {
  const db = getDb();
  const s = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
  const m = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  return { sessions: s, messages: m };
}

module.exports = {
  create, get, getMessages, appendMessage, updateTitle, remove, list,
  migrateFromJson, stats,
};
