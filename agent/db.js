// ─── db.js — SQLite 数据库初始化与连接管理 ───────────────────
//
// 从 JSON 文件迁移到 SQLite 的核心模块：
// - 单文件数据库 data/agent.db，部署简单
// - better-sqlite3 同步 API，与原 writeFileSync 模式一致
// - WAL 模式提升并发读写性能
// - 自动建表 + 自动从旧 JSON 迁移数据
//
// 表结构：
//   sessions(id TEXT PK, title TEXT, created_at INTEGER)
//   messages(id INTEGER PK AUTOINCREMENT, session_id TEXT, role TEXT,
//            content TEXT, images TEXT, created_at INTEGER)
//   settings(key TEXT PK, value TEXT)
//   knowledge_base(id INTEGER PK AUTOINCREMENT, source TEXT,
//                  content TEXT, embedding BLOB, created_at INTEGER)

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.resolve(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'agent.db');

let db = null;

// ─── 初始化数据库 ──────────────────────────────────────────
function init() {
  if (db) return db;

  // 确保数据目录存在
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

 // 性能优化：WAL 模式 + 调优
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // ─── 建表 ──────────────────────────────────────────────

  // 会话表
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT '新对话',
      created_at INTEGER NOT NULL,
      system_prompt TEXT
    )
  `);

  // 消息表（每个会话多条消息）
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      images     TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  // 消息序号索引（按会话查询时排序用）
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id, id)
  `);

  // 设置表（key-value 结构）
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 知识库表（含向量嵌入，用于语义搜索）
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT,
      content    TEXT NOT NULL,
      embedding  BLOB,
      created_at INTEGER NOT NULL
    )
  `);

  return db;
}

// ─── 获取数据库实例 ────────────────────────────────────────
function getDb() {
  if (!db) init();
  return db;
}

// ─── 关闭数据库 ────────────────────────────────────────────
function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { init, getDb, close };
