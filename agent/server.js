const http = require('http');
const OpenAI = require('openai');
const config = require('./config');
const sessions = require('./sessions');
const agent = require('./agent');
const tools = require('./tools');
const settings = require('./settings');

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
    const id = sessions.create(title, body ? JSON.parse(body).systemPrompt : undefined);
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
  const parsed = JSON.parse(body);
  const { message, sessionId } = parsed;
  if (!sessionId) return json(res, { error: 'sessionId is required' }, 400);
  const history = sessions.getMessages(sessionId);
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
    const { message, sessionId } = parsed;
    if (!sessionId) { res.write(`data: ${JSON.stringify({ error: 'sessionId is required' })}\n\n`); res.end(); return; }
    const history = sessions.getMessages(sessionId);
    if (!history) { res.write(`data: ${JSON.stringify({ error: 'Session not found' })}\n\n`); res.end(); return; }
    const { model, maxTokens } = resolveModelOptions(parsed);
    sessions.appendMessage(sessionId, 'user', message);
    const client = createClient();
    const stream = await client.chat.completions.create({ model, messages: history, max_tokens: maxTokens, stream: true });
    let fullContent = '';
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) { fullContent += text; res.write(`data: ${JSON.stringify({ content: text })}\n\n`); }
    }
    sessions.appendMessage(sessionId, 'assistant', fullContent);
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
    const { message, sessionId } = parsed;
    if (!sessionId) { res.write(`data: ${JSON.stringify({ type: 'error', message: 'sessionId is required' })}\n\n`); res.end(); return; }
    const history = sessions.getMessages(sessionId);
    if (!history) { res.write(`data: ${JSON.stringify({ type: 'error', message: 'Session not found' })}\n\n`); res.end(); return; }
    const { model, maxTokens } = resolveModelOptions(parsed);
    sessions.appendMessage(sessionId, 'user', message);
    const client = createClient();
    let fullContent = '';

    const finalAnswer = await agent.runReactStreamFinal({
      client, model, maxTokens, messages: history,
      onEvent: (type, data) => {
        if (type === 'content') fullContent += data.content;
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      },
    });

    if (finalAnswer) sessions.appendMessage(sessionId, 'assistant', finalAnswer);
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
  if (pathname === "/api/settings") { handleSettings(req, res, method).catch(e => json(res, { error: e.message }, 500)); return; }
  if (pathname === '/api/sessions') { handleSessions(req, res, method).catch(e => json(res, { error: e.message }, 500)); return; }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([\w-]+)$/);
  if (sessionMatch) { handleSessionById(req, res, method, sessionMatch[1]).catch(e => json(res, { error: e.message }, 500)); return; }

  if (method === 'POST' && pathname === '/api/chat/stream') { handleStreamChat(req, res); return; }
  if (method === 'POST' && pathname === '/api/chat/agent') { handleAgentChat(req, res); return; }
  if (method === 'POST' && pathname === '/api/chat') { handleChat(req, res).catch(e => json(res, { error: e.message }, 500)); return; }

  res.writeHead(404);
  res.end('Not Found');
}

// ─── 启动 ───────────────────────────────────────────────────
settings.load(); const loadedCount = sessions.loadAll();
const server = http.createServer(handleRequest);
server.listen(3001, () => {
  console.log(`API服务已启动: http://localhost:3001`);
  console.log(`  已恢复 ${loadedCount} 个会话 (data/sessions/)`);
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
});
