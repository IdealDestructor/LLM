// ─── vector-store-sqlite.js — SQLite BLOB 向量存储（默认后端） ─
//
// 向量存 knowledge_base.embedding 列，检索时全表余弦相似度计算。
// 适合小规模知识库，无需额外服务。

const { getDb } = require('./db');
const { bufferToFloat32, cosineSimilarity } = require('./embeddings');
const config = require('./config');

const name = 'sqlite';

async function init() {
  console.log('  向量库: SQLite BLOB（内存余弦搜索）');
}

async function upsert(id, vector) {
  const db = getDb();
  const buf = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  db.prepare('UPDATE knowledge_base SET embedding = ? WHERE id = ?').run(buf, id);
}

async function remove(id) {
  const db = getDb();
  db.prepare('UPDATE knowledge_base SET embedding = NULL WHERE id = ?').run(id);
}

async function search(vector, topK = 3) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, source, content, embedding FROM knowledge_base
    WHERE embedding IS NOT NULL
  `).all();

  if (rows.length === 0) return [];

  const scored = rows.map(row => ({
    id: row.id,
    source: row.source,
    content: row.content,
    score: cosineSimilarity(vector, bufferToFloat32(row.embedding)),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter(s => s.score > config.searchScoreThreshold)
    .slice(0, topK);
}

async function close() {}

module.exports = { name, init, upsert, remove, search, close };
