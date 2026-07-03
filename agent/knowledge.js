// ─── knowledge.js — 知识库统一服务 ─────────────────────────
//
// 元数据持久化在 SQLite knowledge_base 表；
// 向量由 vector-store 抽象层写入 SQLite BLOB 或 Qdrant。

const { getDb } = require('./db');
const embeddings = require('./embeddings');
const vectorStore = require('./vector-store');

async function init() {
  await vectorStore.init();
}

function list() {
  const db = getDb();
  return db.prepare(`
    SELECT id, source, content, created_at FROM knowledge_base
    ORDER BY created_at DESC
  `).all();
}

async function add(content, source = 'manual') {
  const db = getDb();
  const createdAt = Date.now();

  const result = db.prepare(`
    INSERT INTO knowledge_base (source, content, embedding, created_at)
    VALUES (?, ?, NULL, ?)
  `).run(source, content, createdAt);

  const id = result.lastInsertRowid;
  let hasVector = false;

  try {
    const vector = await embeddings.embed(content);
    await vectorStore.upsert(id, vector, { source, content });
    hasVector = true;
  } catch (e) {
    console.warn('生成向量嵌入失败:', e.message);
  }

  return { id, hasVector };
}

async function remove(id) {
  const db = getDb();
  const result = db.prepare('DELETE FROM knowledge_base WHERE id = ?').run(id);
  if (result.changes === 0) return false;

  try {
    await vectorStore.remove(id);
  } catch (e) {
    console.warn('向量库删除失败:', e.message);
  }
  return true;
}

async function search(query, topK = 3) {
  const vector = await embeddings.embed(query);
  return vectorStore.search(vector, topK);
}

function getBackendName() {
  return vectorStore.getBackendName();
}

module.exports = { init, list, add, remove, search, getBackendName };
