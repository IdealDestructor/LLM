const http = require('http');
const OpenAI = require('openai');
const config = require('./config');

// 对话历史
const conversationHistory = [
  { role: 'system', content: '你是MiniMax的AI助手。' }
];

function createClient() {
  const cfg = config[config.provider] || config.openai;
  return new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
  });
}

// ─── 工具函数：读取请求体 ───────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ─── 路由：非流式聊天（原有逻辑，保留兼容） ────────────────
async function handleChat(req, res) {
  const body = await readBody(req);
  const { message } = JSON.parse(body);

  conversationHistory.push({ role: 'user', content: message });

  const client = createClient();
  const response = await client.chat.completions.create({
    model: config.defaultModel,
    messages: conversationHistory,
    max_tokens: 500,
  });

  const reply = response.choices[0].message.content;
  conversationHistory.push({ role: 'assistant', content: reply });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ reply }));
}

// ─── 路由：SSE 流式聊天（核心新增） ─────────────────────────
//
// 关键实现要点：
// 1. 响应头设置 Content-Type: text/event-stream，告诉浏览器这是 SSE
// 2. Connection: keep-alive 保持长连接，不立即关闭
// 3. Cache-Control: no-cache 防止代理/浏览器缓存事件流
// 4. OpenAI SDK 传入 stream: true，返回异步迭代器
// 5. 每个 chunk 的 delta.content 通过 SSE data: 行发送
// 6. 流结束后发送 data: [DONE] 信号，前端据此判断结束
//
async function handleStreamChat(req, res) {
  // ── Step 1: 设置 SSE 响应头 ──
  // SSE 规范要求 Content-Type 为 text/event-stream
  // 每条消息格式: "data: <content>\n\n"（两个换行结尾）
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    const body = await readBody(req);
    const { message } = JSON.parse(body);

    // ── Step 2: 追加用户消息到历史 ──
    conversationHistory.push({ role: 'user', content: message });

    // ── Step 3: 创建流式请求 ──
    // stream: true 让 SDK 返回异步迭代器而非等待完整响应
    const client = createClient();
    const stream = await client.chat.completions.create({
      model: config.defaultModel,
      messages: conversationHistory,
      max_tokens: 500,
      stream: true,
    });

    let fullContent = ''; // 累积完整回复，用于存入对话历史

    // ── Step 4: 逐 chunk 读取并转发 ──
    // for await...of 遍历 SSE 事件流
    // 每个 chunk 结构: { choices: [{ delta: { content?: string } }] }
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        fullContent += text;
        // SSE 格式: "data: <json>\n\n"
        // 前端 EventSource/onmessage 会自动解析 data 行
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }

    // ── Step 5: 流结束，保存完整回复到历史 ──
    conversationHistory.push({ role: 'assistant', content: fullContent });

    // ── Step 6: 发送结束信号 ──
    // [DONE] 是 OpenAI SSE 约定的结束标记
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (e) {
    // 错误也要通过 SSE 格式发送，前端才能正常解析
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
}

// ─── 主请求处理 ─────────────────────────────────────────────
function handleRequest(req, res) {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 流式聊天端点
  if (req.method === 'POST' && req.url === '/api/chat/stream') {
    handleStreamChat(req, res);
    return;
  }

  // 非流式聊天端点（保留兼容）
  if (req.method === 'POST' && req.url === '/api/chat') {
    handleChat(req, res).catch(e => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
}

const server = http.createServer(handleRequest);

server.listen(3001, () => {
  console.log('API服务已启动: http://localhost:3001');
  console.log('  POST /api/chat         — 非流式聊天');
  console.log('  POST /api/chat/stream  — SSE 流式聊天');
});
