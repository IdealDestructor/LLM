// ─── redis.js — Redis 会话缓存（可选） ─────────────────────
//
// 未设置 REDIS_URL 时自动禁用，回退纯 SQLite。
// Cache-aside：读 miss 时从 SQLite 回填，写操作后更新或失效缓存。

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || '';
const SESSION_TTL = parseInt(process.env.REDIS_SESSION_TTL, 10) || 86400;
const KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'agent:';

let client = null;
let enabled = false;

const sessionKey = (id) => `${KEY_PREFIX}session:${id}`;
const listKey = () => `${KEY_PREFIX}sessions:list`;

async function init() {
  if (!REDIS_URL) {
    console.log('  Redis: 未配置 REDIS_URL，会话缓存已禁用');
    return false;
  }

  try {
    client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableReadyCheck: true,
    });
    await client.connect();
    await client.ping();
    enabled = true;
    console.log(`  Redis: 已连接 (${REDIS_URL})，TTL ${SESSION_TTL}s`);
    return true;
  } catch (e) {
    console.warn('  Redis: 连接失败，回退 SQLite:', e.message);
    if (client) {
      try { client.disconnect(); } catch {}
      client = null;
    }
    enabled = false;
    return false;
  }
}

function isEnabled() {
  return enabled && client !== null;
}

async function getSession(id) {
  if (!isEnabled()) return null;
  try {
    const raw = await client.get(sessionKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Redis getSession 失败:', e.message);
    return null;
  }
}

async function setSession(id, session) {
  if (!isEnabled()) return;
  try {
    await client.set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL);
  } catch (e) {
    console.warn('Redis setSession 失败:', e.message);
  }
}

async function deleteSession(id) {
  if (!isEnabled()) return;
  try {
    await client.del(sessionKey(id));
  } catch (e) {
    console.warn('Redis deleteSession 失败:', e.message);
  }
}

async function getSessionList() {
  if (!isEnabled()) return null;
  try {
    const raw = await client.get(listKey());
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Redis getSessionList 失败:', e.message);
    return null;
  }
}

async function setSessionList(list) {
  if (!isEnabled()) return;
  try {
    await client.set(listKey(), JSON.stringify(list), 'EX', SESSION_TTL);
  } catch (e) {
    console.warn('Redis setSessionList 失败:', e.message);
  }
}

async function invalidateList() {
  if (!isEnabled()) return;
  try {
    await client.del(listKey());
  } catch (e) {
    console.warn('Redis invalidateList 失败:', e.message);
  }
}

async function close() {
  if (client) {
    try { await client.quit(); } catch {}
    client = null;
    enabled = false;
  }
}

module.exports = {
  init,
  isEnabled,
  getSession,
  setSession,
  deleteSession,
  getSessionList,
  setSessionList,
  invalidateList,
  close,
};
