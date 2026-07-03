// ─── vector-store-qdrant.js — Qdrant 专用向量库后端 ─────────
//
// 向量存 Qdrant，元数据（id/source/content）在 payload 中冗余一份，
// 便于检索时直接返回，无需二次查库。

const { QdrantClient } = require('@qdrant/js-client-rest');
const config = require('./config');

const name = 'qdrant';
let client = null;
let collection = null;

async function init() {
  collection = config.qdrantCollection;
  client = new QdrantClient({ url: config.qdrantUrl });

  const { collections } = await client.getCollections();
  const exists = collections.some(c => c.name === collection);

  if (!exists) {
    await client.createCollection(collection, {
      vectors: {
        size: config.embeddingDimension,
        distance: 'Cosine',
      },
    });
    console.log(`  向量库: Qdrant 已创建集合 ${collection} (dim=${config.embeddingDimension})`);
  } else {
    console.log(`  向量库: Qdrant 已连接 ${config.qdrantUrl}，集合 ${collection}`);
  }
}

async function upsert(id, vector, payload = {}) {
  await client.upsert(collection, {
    wait: true,
    points: [{
      id: Number(id),
      vector: Array.from(vector),
      payload,
    }],
  });
}

async function remove(id) {
  await client.delete(collection, {
    wait: true,
    points: [Number(id)],
  });
}

async function search(vector, topK = 3) {
  const results = await client.search(collection, {
    vector: Array.from(vector),
    limit: topK,
    score_threshold: config.searchScoreThreshold,
    with_payload: true,
  });

  return results.map(r => ({
    id: r.id,
    source: r.payload?.source ?? null,
    content: r.payload?.content ?? '',
    score: r.score,
  }));
}

// 从 SQLite 已有 embedding 批量迁移到 Qdrant（仅首次启用时）
async function migrateFromSqlite(rows) {
  if (!rows.length) return 0;

  const points = rows.map(row => ({
    id: Number(row.id),
    vector: Array.from(require('./embeddings').bufferToFloat32(row.embedding)),
    payload: { source: row.source, content: row.content },
  }));

  const BATCH = 64;
  for (let i = 0; i < points.length; i += BATCH) {
    await client.upsert(collection, { wait: true, points: points.slice(i, i + BATCH) });
  }
  return points.length;
}

async function count() {
  try {
    const info = await client.getCollection(collection);
    return info.points_count ?? 0;
  } catch {
    return 0;
  }
}

async function close() {
  client = null;
}

module.exports = { name, init, upsert, remove, search, migrateFromSqlite, count, close };
