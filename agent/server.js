const http = require('http');
const OpenAI = require('openai');
const config = require('./config');
const sessions = require('./sessions');
const agent = require('./agent');
const tools = require('./tools');
const settings = require('./settings');
const db = require('./db');
const redis = require('./redis');
const knowledge = require('./knowledge');
const fs = require('fs');
const path = require('path');

function createClient() {
  const cfg = config[config.provider] || config.openai;
  return new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
  });
}

// ─── 工具函数 ───────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function resolveModelOptions(body) {
  const model = body.model || config.defaultModel;
  const modelConfig = config.models.find(m => m.id === model);
  const modelDefaultMaxTokens = modelConfig?.maxTokens || config.defaultMaxTokens;
  let maxTokens = body.maxTokens || modelDefaultMaxTokens;
  maxTokens = Math.max(1, Math.min(16384, parseInt(maxTokens, 10) || modelDefaultMaxTokens));
  return { model, maxTokens };
}

// ─── 路由：模型列表 ────────────────────────────────────────
function handleModels(req, res) {
  json(res, {
    models: config.models,
    defaultModel: config.defaultModel,
    defaultMaxTokens: config.defaultMaxTokens,
  });
}

// ─── 路由：图片上传 ────────────────────────────────────────
// POST /api/upload — 接收 base64 图片，保存到 data/uploads/，返回可访问 URL
//
// 请求体：{ image: "data:image/png;base64,iVBOR..." }
// 响应：{ url: "/api/uploads/abc123.png", filename: "abc123.png" }
//
async function handleUpload(req, res) {
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    const { image } = parsed;
    if (!image || !image.startsWith('data:')) {
      return json(res, { error: 'Invalid image data' }, 400);
    }

    // 解析 data URL：data:image/png;base64,<data>
    const match = image.match(/^data:(image\/(\w+));base64,(.+)$/);
    if (!match) {
      return json(res, { error: 'Unsupported image format' }, 400);
    }

    const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
    const buffer = Buffer.from(match[3], 'base64');

    // 限制 10MB
    if (buffer.length > 10 * 1024 * 1024) {
      return json(res, { error: 'Image too large (max 10MB)' }, 400);
    }

    const uploadsDir = path.resolve(__dirname, 'data', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);

    json(res, { url: `/api/uploads/${filename}`, filename });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

// ─── 构建多模态消息内容 ────────────────────────────────────
// 将文本 + 图片 URL 列表转为 OpenAI vision 格式
// 返回 string（纯文本）或 array（多模态）
function buildMessageContent(text, images) {
  if (!images || images.length === 0) return text;

  const content = [{ type: 'text', text }];
  for (const img of images) {
    content.push({
      type: 'image_url',
      image_url: { url: img },
    });
  }
  return content;
}

// ─── 从消息中提取纯文本（用于标题生成等） ─────────────────
function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === 'text').map(c => c.text).join(' ');
  }
  return '';
}

// ─── 路由：工具列表 ────────────────────────────────────────
function handleTools(req, res) {
  json(res, { tools: tools.listTools() });
}

// ─── 路由：用户设置 ────────────────────────────────────────
// GET  /api/settings — 获取设置
// PUT  /api/settings — 更新设置（合并写入）
async function handleSettings(req, res, method) {
  if (method === "GET") { json(res, settings.get()); return; }
  if (method === "PUT") {
    const body = await readBody(req);
    const updates = body ? JSON.parse(body) : {};
    json(res, settings.save(updates));
    return;
  }
  json(res, { error: "Method not allowed" }, 405);
}

// ─── 路由：会话管理 ─────────────────────────────────────────
async function handleSessions(req, res, method) {
  if (method === 'POST') {
    const body = await readBody(req);
    const { title } = body ? JSON.parse(body) : {};
    const id = await sessions.create(title, body ? JSON.parse(body).systemPrompt : undefined);
    const session = await sessions.get(id);
    json(res, { sessionId: id, meta: session.meta });
    return;
  }
  if (method === 'GET') {
    json(res, { sessions: await sessions.list() });
    return;
  }
  json(res, { error: 'Method not allowed' }, 405);
}

// ─── 路由：知识库管理 ─────────────────────────────────────
// GET    /api/knowledge          — 列出所有知识条目
// POST   /api/knowledge          — 添加知识（自动生成向量嵌入）
// DELETE /api/knowledge          — 删除知识（body: { id }）
// POST   /api/knowledge/search   — 语义搜索（body: { query }）
//
async function handleKnowledge(req, res, method) {
  const { pathname } = parseUrl(req);

  if (pathname === '/api/knowledge/search' && method === 'POST') {
    const body = await readBody(req);
    const { query, topK } = body ? JSON.parse(body) : {};
    if (!query) return json(res, { error: 'query is required' }, 400);
    const results = await knowledge.search(query, topK || 5);
    json(res, { results, backend: knowledge.getBackendName() });
    return;
  }

  if (method === 'GET') {
    json(res, { entries: knowledge.list(), backend: knowledge.getBackendName() });
    return;
  }

  if (method === 'POST') {
    const body = await readBody(req);
    const { content, source } = body ? JSON.parse(body) : {};
    if (!content) return json(res, { error: 'content is required' }, 400);

    const { id, hasVector } = await knowledge.add(content, source || 'manual');
    json(res, { id, ok: true, hasVector });
    return;
  }

  if (method === 'DELETE') {
    const body = await readBody(req);
    const { id } = body ? JSON.parse(body) : {};
    if (!id) return json(res, { error: 'id is required' }, 400);
    const removed = await knowledge.remove(id);
    if (!removed) return json(res, { error: 'Entry not found' }, 404);
    json(res, { ok: true });
    return;
  }

  json(res, { error: 'Method not allowed' }, 405);
}

async function handleSessionById(req, res, method, sessionId) {
  if (method === 'GET') {
    const session = await sessions.get(sessionId);
    if (!session) return json(res, { error: 'Session not found' }, 404);
    json(res, { meta: session.meta, messages: session.messages.slice(1) });
    return;
  }
  if (method === 'PATCH') {
    const body = await readBody(req);
    const { title } = JSON.parse(body);
    if (!title) return json(res, { error: 'title is required' }, 400);
    const ok = await sessions.updateTitle(sessionId, title);
    if (!ok) return json(res, { error: 'Session not found' }, 404);
    const session = await sessions.get(sessionId);
    json(res, { ok: true, meta: session.meta });
    return;
  }
  if (method === 'DELETE') {
    const removed = await sessions.remove(sessionId);
    if (!removed) return json(res, { error: 'Session not found' }, 404);
    json(res, { ok: true });
    return;
  }
  json(res, { error: 'Method not allowed' }, 405);
}

// ─── 路由：非流式聊天 ──────────────────────────────────────
async function handleChat(req, res) {
  const body = await readBody(req);
  const parsed = JSON.parse(body);
  const { message, sessionId } = parsed;
  if (!sessionId) return json(res, { error: 'sessionId is required' }, 400);
  const history = await sessions.getMessages(sessionId);
  if (!history) return json(res, { error: 'Session not found' }, 404);
  const { model, maxTokens } = resolveModelOptions(parsed);
  history.push({ role: 'user', content: message });
  const client = createClient();
  const response = await client.chat.completions.create({ model, messages: history, max_tokens: maxTokens });
  const reply = response.choices[0].message.content;
  history.push({ role: 'assistant', content: reply });
  json(res, { reply });
}

// ─── 路由：SSE 流式聊天 ────────────────────────────────────
async function handleStreamChat(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    const { message, sessionId, images } = parsed;
    if (!sessionId) { res.write(`data: ${JSON.stringify({ error: 'sessionId is required' })}\n\n`); res.end(); return; }
    const history = await sessions.getMessages(sessionId);
    if (!history) { res.write(`data: ${JSON.stringify({ error: 'Session not found' })}\n\n`); res.end(); return; }
    const { model, maxTokens } = resolveModelOptions(parsed);
    const userContent = buildMessageContent(message, images);
    await sessions.appendMessage(sessionId, 'user', userContent);
    const client = createClient();
    const stream = await client.chat.completions.create({ model, messages: history, max_tokens: maxTokens, stream: true, stream_options: { include_usage: false } });
    let fullContent = '';
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) { fullContent += text; res.write(`data: ${JSON.stringify({ content: text })}\n\n`); }
    }
    await sessions.appendMessage(sessionId, 'assistant', fullContent);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.end(); }
}

// ─── 路由：Agent 模式 SSE 流式聊天 ──────────────────────────
//
// POST /api/chat/agent — ReAct 多步推理
//
// 与 /api/chat/stream 的区别：
// - 使用 function calling 让 LLM 自主选择工具
// - 每个推理步骤（thought/action/observation）通过 SSE 实时推送
// - 前端可以展示完整的推理过程
//
// SSE 事件类型：
//   thought     — LLM 的思考内容
//   action      — LLM 调用的工具 + 参数
//   observation — 工具执行结果
//   content     — 最终答案的流式 chunk
//   done        — 推理结束
//   error       — 错误
//
async function handleAgentChat(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    const { message, sessionId, images } = parsed;
    if (!sessionId) { res.write(`data: ${JSON.stringify({ type: 'error', message: 'sessionId is required' })}\n\n`); res.end(); return; }
    const history = await sessions.getMessages(sessionId);
    if (!history) { res.write(`data: ${JSON.stringify({ type: 'error', message: 'Session not found' })}\n\n`); res.end(); return; }
    const { model, maxTokens } = resolveModelOptions(parsed);
    const userContent = buildMessageContent(message, images);
    await sessions.appendMessage(sessionId, 'user', userContent);
    const client = createClient();
    let fullContent = '';

    const finalAnswer = await agent.runReactStreamFinal({
      client, model, maxTokens, messages: history,
      onEvent: (type, data) => {
        if (type === 'content') fullContent += data.content;
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      },
    });

    if (finalAnswer) await sessions.appendMessage(sessionId, 'assistant', finalAnswer);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) { res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`); res.end(); }
}

// ─── URL 解析辅助 ──────────────────────────────────────────
function parseUrl(req) {
  const url = new URL(req.url, 'http://localhost');
  return { pathname: url.pathname };
}

// ─── 主请求处理 ─────────────────────────────────────────────
function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const { pathname } = parseUrl(req);
  const method = req.method;

  if (method === 'GET' && pathname === '/api/models') { handleModels(req, res); return; }
  if (method === 'GET' && pathname === '/api/tools') { handleTools(req, res); return; }
  if (method === 'POST' && pathname === '/api/upload') { handleUpload(req, res); return; }

  if (pathname === '/api/knowledge' || pathname === '/api/knowledge/search') { handleKnowledge(req, res, method).catch(e => json(res, { error: e.message }, 500)); return; }

  // 静态文件：上传的图片
  const uploadMatch = pathname.match(/^\/api\/uploads\/(.+)$/);
  if (uploadMatch && method === 'GET') {
    const filePath = path.resolve(__dirname, 'data', 'uploads', uploadMatch[1]);
    if (!filePath.startsWith(path.resolve(__dirname, 'data', 'uploads'))) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=86400' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('Not Found');
    }
    return;
  }

  if (pathname === "/api/settings") { handleSettings(req, res, method).catch(e => json(res, { error: e.message }, 500)); return; }
  if (pathname === '/api/sessions') { handleSessions(req, res, method).catch(e => json(res, { error: e.message }, 500)); return; }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([\w-]+)$/);
  if (sessionMatch) { handleSessionById(req, res, method, sessionMatch[1]).catch(e => json(res, { error: e.message }, 500)); return; }

 if (method === 'POST' && pathname === '/api/chat/stream') { handleStreamChat(req, res); return; }
 if (method === 'POST' && pathname === '/api/chat/agent') { handleAgentChat(req, res); return; }
 if (method === 'POST' && pathname === '/api/chat') { handleChat(req, res).catch(e => json(res, { error: e.message }, 500)); return; }

  // ─── 静态前端文件（生产环境 / Docker） ──────────────────
  // 前端构建产物在 frontend/dist/，由后端同端口提供
  if (method === 'GET') {
    const frontendDir = path.resolve(__dirname, 'frontend', 'dist');
    if (fs.existsSync(frontendDir)) {
      serveStatic(req, res, frontendDir, pathname);
      return;
    }
  }

  res.writeHead(404);
  res.end('Not Found');
}

// ─── 静态文件服务（SPA fallback） ──────────────────────────
function serveStatic(req, res, rootDir, pathname) {
  // 安全：防止路径穿越
  const cleanPath = pathname.replace(/\.\./g, '');
  let filePath = path.join(rootDir, cleanPath);

  // 如果路径是目录，尝试 index.html
  if (!path.extname(filePath)) {
    // 先尝试精确文件（如 favicon.svg）
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(res, filePath);
      return;
    }
    // SPA fallback：所有未匹配的路由返回 index.html
    filePath = path.join(rootDir, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

function sendFile(res, filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    // 带哈希的静态资源长期缓存
    const isHashed = /\/assets\/[^/]+\.[a-f0-9]{8}\./.test(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': isHashed ? 'max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(500);
    res.end('Internal Server Error');
  }
}

// ─── 启动 ───────────────────────────────────────────────────
async function start() {
  db.init();
  settings.load();
  const migratedCount = sessions.migrateFromJson();
  await redis.init();
  await knowledge.init();

  const PORT = process.env.PORT || 3001;
  const server = http.createServer(handleRequest);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`API服务已启动: http://0.0.0.0:${PORT}`);
    const s = sessions.stats();
    console.log(`  SQLite 数据库: data/agent.db (WAL 模式)`);
    console.log(`  已加载 ${s.sessions} 个会话, ${s.messages} 条消息`);
    if (migratedCount > 0) console.log(`  从 JSON 迁移了 ${migratedCount} 个旧会话`);
    console.log(`  向量库后端: ${knowledge.getBackendName()}`);
    console.log('  GET    /api/knowledge         — 列出知识库');
    console.log('  POST   /api/knowledge         — 添加知识条目');
    console.log('  DELETE /api/knowledge         — 删除知识条目');
    console.log('  POST   /api/knowledge/search  — 语义搜索知识库');
    console.log('  GET    /api/models             — 获取可选模型列表');
    console.log('  GET    /api/tools              — 获取可用工具列表');
    console.log('  GET    /api/settings           — 获取用户设置');
    console.log('  PUT    /api/settings           — 更新用户设置');
    console.log('  POST   /api/sessions          — 创建会话');
    console.log('  GET    /api/sessions          — 列出所有会话');
    console.log('  GET    /api/sessions/:id      — 获取会话详情');
    console.log('  PATCH  /api/sessions/:id      — 更新会话标题');
    console.log('  DELETE /api/sessions/:id      — 删除会话');
    console.log('  POST   /api/chat              — 非流式聊天');
    console.log('  POST   /api/chat/stream       — SSE 流式聊天');
    console.log('  POST   /api/chat/agent        — ReAct Agent 多步推理');
    console.log('  POST   /api/upload            — 图片上传（多模态）');
    console.log('  GET    /api/uploads/:file     — 获取上传的图片');
  });

  const shutdown = async () => {
    await redis.close();
    const vectorStore = require('./vector-store');
    await vectorStore.close();
    db.close();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
