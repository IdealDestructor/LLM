// ─── sessions.js — 会话隔离 + JSON 文件持久化 ────────────────
//
// 持久化关键设计要点：
//
// 1. 存储结构：data/sessions/ 目录下，每个会话一个 JSON 文件
//    data/sessions/
//    ├── abc123.json   ← { meta, messages }
//    ├── def456.json
//    └── ...
//
// 2. 为什么每个会话一个文件，而非全部存一个 JSON？
//    - 避免单文件过大（长对话可达数万条消息）
//    - 删除会话只需删一个文件，无需重写整个大 JSON
//    - 读写锁粒度更小，并发更安全
//
// 3. 写入策略：每次数据变更（create/append/remove/updateTitle）后立即写文件
//    - 优点：进程崩溃也不丢数据
//    - 缺点：频繁写入（每条消息两次：user + assistant）
//    - 优化：可用 debounce 合并短时间内的多次写入（当前未做，留作后续）
//
// 4. 启动恢复：loadAll() 扫描 data/sessions/ 目录，逐个读取 JSON 文件
//    - 文件损坏则跳过并打印警告，不影响其他会话
//    - 目录不存在则自动创建
//
// 5. 文件写入用 writeFileSync 而非 writeFile：
//    - 同步写入确保数据落盘后再返回
//    - 对于低并发的聊天场景，同步写的阻塞可忽略
//    - 如需高并发，可改为异步 + 写入队列
//

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SYSTEM_PROMPT = '你是Francis的AI助手。';

// ─── 持久化目录 ──────────────────────────────────────────
const DATA_DIR = path.resolve(__dirname, 'data', 'sessions');

// 确保目录存在
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── 会话存储（内存） ────────────────────────────────────
// Map<sessionId, { meta, messages }>
const sessions = new Map();

// ─── 持久化：写入单个会话到 JSON 文件 ────────────────────
//
// 关键实现：
// - JSON.stringify 的第三个参数 2 表示美化缩进，便于调试查看
// - 写入前先确保目录存在（防御性编程）
// - 文件名 = sessionId + .json，sessionId 是 UUID，无需额外转义
//
function saveToFile(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  ensureDir();
  const filePath = path.join(DATA_DIR, `${sessionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

// ─── 持久化：删除会话的 JSON 文件 ────────────────────────
function deleteFile(sessionId) {
  const filePath = path.join(DATA_DIR, `${sessionId}.json`);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // 文件不存在也无所谓
  }
}

// ─── 持久化：启动时从磁盘加载所有会话 ────────────────────
//
// 关键实现：
// - readdirSync 扫描目录，筛选 .json 文件
// - 逐个 readFileSync + JSON.parse 恢复到 sessions Map
// - 单个文件损坏不影响其他会话（try-catch 跳过）
// - 返回加载的会话数量，供启动日志使用
//
function loadAll() {
  ensureDir();

  let count = 0;
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const filePath = path.join(DATA_DIR, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const session = JSON.parse(raw);

      // 基本校验：必须有 meta.id 和 messages 数组
      if (!session.meta?.id || !Array.isArray(session.messages)) {
        console.warn(`⚠️ 跳过损坏的会话文件: ${file}`);
        continue;
      }

      sessions.set(session.meta.id, session);
      count++;
    } catch (e) {
      console.warn(`⚠️ 加载会话文件失败: ${file}`, e.message);
    }
  }

  return count;
}

// ─── 生成唯一会话 ID ──────────────────────────────────────
function generateId() {
  return crypto.randomUUID();
}

// ─── 创建新会话 ──────────────────────────────────────────
function create(title) {
  const id = generateId();
  sessions.set(id, {
    meta: {
      id,
      title: title || '新对话',
      createdAt: Date.now(),
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT }
    ],
  });

  // 持久化：创建后立即写文件
  saveToFile(id);

  return id;
}

// ─── 获取会话 ────────────────────────────────────────────
function get(sessionId) {
  return sessions.get(sessionId);
}

// ─── 获取会话消息历史 ────────────────────────────────────
function getMessages(sessionId) {
  const session = sessions.get(sessionId);
  return session ? session.messages : undefined;
}

// ─── 追加消息到会话历史 ──────────────────────────────────
function appendMessage(sessionId, role, content) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.messages.push({ role, content });

  // 持久化：每次追加消息后写文件
  // 一轮对话会触发两次写入：user 消息 + assistant 消息
  saveToFile(sessionId);

  return true;
}

// ─── 更新会话标题 ────────────────────────────────────────
function updateTitle(sessionId, title) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.meta.title = title;

  // 持久化：标题变更后写文件
  saveToFile(sessionId);

  return true;
}

// ─── 删除会话 ────────────────────────────────────────────
function remove(sessionId) {
  const deleted = sessions.delete(sessionId);
  if (deleted) {
    // 持久化：从磁盘删除文件
    deleteFile(sessionId);
  }
  return deleted;
}

// ─── 列出所有会话摘要 ────────────────────────────────────
function list() {
  return Array.from(sessions.values())
    .map(s => s.meta)
    .sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = {
  create,
  get,
  getMessages,
  appendMessage,
  updateTitle,
  remove,
  list,
  loadAll,  // 导出供 server.js 启动时调用
};
