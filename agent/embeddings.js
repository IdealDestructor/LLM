// ─── embeddings.js — 向量嵌入生成工具 ─────────────────────
//
// 使用 OpenAI 兼容的 /v1/embeddings API 生成文本向量。
// 存储与检索由 vector-store / knowledge 模块负责。

const OpenAI = require('openai');
const config = require('./config');

function createClient() {
  const cfg = config[config.provider] || config.openai;
  return new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
}

async function embed(text) {
  const client = createClient();
  const model = config.embeddingModel || 'text-embedding-3-small';

  const response = await client.embeddings.create({
    model,
    input: text,
  });

  return new Float32Array(response.data[0].embedding);
}

async function embedBatch(texts) {
  if (!texts.length) return [];
  const client = createClient();
  const model = config.embeddingModel || 'text-embedding-3-small';

  const response = await client.embeddings.create({
    model,
    input: texts,
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map(d => new Float32Array(d.embedding));
}

function float32ToBuffer(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function bufferToFloat32(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

module.exports = {
  embed,
  embedBatch,
  float32ToBuffer,
  bufferToFloat32,
  cosineSimilarity,
};
