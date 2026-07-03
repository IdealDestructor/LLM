// ─── vector-store.js — 向量存储抽象层 ───────────────────────
//
// VECTOR_STORE=sqlite（默认）| qdrant
// SQLite 模式：BLOB + 内存余弦搜索
// Qdrant 模式：专用向量库，适合大规模知识库

const config = require('./config');

let backend = null;

function createBackend() {
  const type = config.vectorStore;
  if (type === 'qdrant') return require('./vector-store-qdrant');
  if (type !== 'sqlite') {
    console.warn(`未知 VECTOR_STORE=${type}，回退 sqlite`);
  }
  return require('./vector-store-sqlite');
}

async function init() {
  backend = createBackend();
  await backend.init();

  if (backend.name === 'qdrant') {
    await migrateSqliteEmbeddingsIfNeeded();
  }
}

async function migrateSqliteEmbeddingsIfNeeded() {
  const { getDb } = require('./db');
  const db = getDb();

  const rows = db.prepare(`
    SELECT id, source, content, embedding FROM knowledge_base
    WHERE embedding IS NOT NULL
  `).all();

  if (rows.length === 0) return;

  const qdrantCount = await backend.count();
  if (qdrantCount > 0) return;

  const migrated = await backend.migrateFromSqlite(rows);
  if (migrated > 0) {
    console.log(`  Qdrant: 从 SQLite 迁移了 ${migrated} 条向量`);
  }
}

function getBackend() {
  if (!backend) throw new Error('vector-store 未初始化，请先调用 init()');
  return backend;
}

function getBackendName() {
  return backend?.name ?? config.vectorStore;
}

async function upsert(id, vector, payload) {
  return getBackend().upsert(id, vector, payload);
}

async function remove(id) {
  return getBackend().remove(id);
}

async function search(vector, topK) {
  return getBackend().search(vector, topK);
}

async function close() {
  if (backend?.close) await backend.close();
  backend = null;
}

module.exports = {
  init,
  getBackendName,
  upsert,
  remove,
  search,
  close,
};
