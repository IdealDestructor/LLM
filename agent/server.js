const http = require('http');
const OpenAI = require('openai');
const config = require('./config');
const sessions = require('./sessions');

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

// ─── 路由：会话管理 ─────────────────────────────────────────
async function handleSessions(req, res, method) {
  if (method === 'POST') {
    const body = await readBody(req);
    const { title } = body ? JSON.parse(body) : {};
    const id = sessions.create(title);
    json(res, { sessionId: id, meta: sessions.get(id).meta });
    return;
  }

  if (method === 'GET') {
    json(res, { sessions: sessions.list() });
    return;
  }

  json(res, { error: 'Method not allowed' }, 405);
}

async function handleSessionById(req, res, method, sessionId) {
  if (method === 'GET') {
    const session = sessions.get(sessionId);
    if (!session) return json(res, { error: 'Session not found' }, 404);
    json(res, { meta: session.meta, messages: session.messages.slice(1) });
    return;
  }

  if (method === 'PATCH') {
    const body = await readBody(req);
    const { title } = JSON.parse(body);
    if (!title) return json(res, { error: 'title is required' }, 400);
    const ok = sessions.updateTitle(sessionId, title);
    if (!ok) return json(res, { error: 'Session not found' }, 404);
    json(res, { ok: true, meta: sessions.get(sessionId).meta });
    return;
  }

  if (method === 'DELETE') {
    const removed = sessions.remove(sessionId);
    if (!removed) return json(res, { error: 'Session not found' }, 404);
    json(res, { ok: true });
    return;
  }

  json(res, { error: 'Method not allowed' }, 405);
}

// ─── 路由：非流式聊天 ──────────────────────────────────────
async function handleChat(req, res) {
  const body = await readBody(req);
  const { message, sessionId } = JSON.parse(body);

  if (!sessionId) return json(res, { error: 'sessionId is required' }, 400);

  const history = sessions.getMessages(sessionId);
  if (!history) return json(res, { error: 'Session not found' }, 404);

  history.push({ role: 'user', content: message });

  const client = createClient();
  const response = await client.chat.completions.create({
    model: config.defaultModel,
    messages: history,
    max_tokens: 500,
  });

  const reply = response.choices[0].message.content;
  history.push({ role: 'assistant', content: reply });

  json(res, { reply });
}

// ─── 路由：SSE 流式聊天 ────────────────────────────────────
async function handleStreamChat(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    const body = await readBody(req);
    const { message, sessionId } = JSON.parse(body);

    if (!sessionId) {
      res.write(`data: ${JSON.stringify({ error: 'sessionId is required' })}\n\n`);
      res.end();
      return;
    }

    const history = sessions.getMessages(sessionId);
    if (!history) {
      res.write(`data: ${JSON.stringify({ error: 'Session not found' })}\n\n`);
      res.end();
      return;
    }

    sessions.appendMessage(sessionId, 'user', message);

    const client = createClient();
    const stream = await client.chat.completions.create({
      model: config.defaultModel,
      messages: history,
      max_tokens: 500,
      stream: true,
    });

    let fullContent = '';

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        fullContent += text;
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }

    sessions.appendMessage(sessionId, 'assistant', fullContent);

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
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

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const { pathname } = parseUrl(req);
  const method = req.method;

  if (pathname === '/api/sessions') {
    handleSessions(req, res, method).catch(e => json(res, { error: e.message }, 500));
    return;
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([\w-]+)$/);
  if (sessionMatch) {
    handleSessionById(req, res, method, sessionMatch[1]).catch(e => json(res, { error: e.message }, 500));
    return;
  }

  if (method === 'POST' && pathname === '/api/chat/stream') {
    handleStreamChat(req, res);
    return;
  }

  if (method === 'POST' && pathname === '/api/chat') {
    handleChat(req, res).catch(e => json(res, { error: e.message }, 500));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
}

// ─── 启动 ───────────────────────────────────────────────────
// 先从磁盘恢复持久化的会话数据，再启动 HTTP 服务
const loadedCount = sessions.loadAll();

const server = http.createServer(handleRequest);

server.listen(3001, () => {
  console.log(`API服务已启动: http://localhost:3001`);
  console.log(`  已恢复 ${loadedCount} 个会话 (data/sessions/)`);
  console.log('  POST   /api/sessions          — 创建会话');
  console.log('  GET    /api/sessions          — 列出所有会话');
  console.log('  GET    /api/sessions/:id      — 获取会话详情');
  console.log('  PATCH  /api/sessions/:id      — 更新会话标题');
  console.log('  DELETE /api/sessions/:id      — 删除会话');
  console.log('  POST   /api/chat              — 非流式聊天 (需 sessionId)');
  console.log('  POST   /api/chat/stream       — SSE 流式聊天 (需 sessionId)');
});
