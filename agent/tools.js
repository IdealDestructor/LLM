// ─── tools.js — 工具注册表 + 内置工具实现 ────────────────────
//
// ReAct Agent 的核心组件之一：工具（Tool）
//
// 设计要点：
// 1. 每个工具是一个函数，有 name / description / parameters 描述
// 2. 工具描述遵循 OpenAI function calling 的 JSON Schema 格式
//    这样 LLM 能理解每个工具的用途和参数要求
// 3. 内置工具：calculator（数学计算）、datetime（获取时间）、search（模拟搜索）
// 4. 工具执行结果作为 "Observation" 反馈给 LLM，进入下一轮 ReAct 循环
//
// ┌──────────────────────────────────────────────────┐
// │  Tool Registry                                   │
// │  ┌────────────┬──────────────┬────────────────┐ │
// │  │ name       │ description  │ execute(args)  │ │
// │  ├────────────┼──────────────┼────────────────┤ │
// │  │ calculator │ 数学表达式求值 │ eval(expr)     │ │
// │  │ datetime   │ 获取当前时间   │ new Date()     │ │
// │  │ search     │ 模拟知识搜索   │ keyword match  │ │
// │  └────────────┴──────────────┴────────────────┘ │
// └──────────────────────────────────────────────────┘

const tools = new Map();

// ─── 注册工具 ────────────────────────────────────────────

// 延迟加载 knowledge（避免 db 尚未初始化时报错）
let _knowledge = null;
function getKnowledge() {
  if (!_knowledge) _knowledge = require('./knowledge');
  return _knowledge;
}

function register(tool) {
  tools.set(tool.name, tool);
}

// ─── 运行时动态注册工具 ──────────────────────────────────
// 支持无需重启添加/移除/更新工具

function addTool(name, toolDef) {
  if (!name || typeof name !== 'string') throw new Error('工具名称必须是字符串');
  if (!toolDef || typeof toolDef.execute !== 'function') throw new Error('工具定义必须包含 execute 函数');
  const tool = {
    name,
    description: toolDef.description || '',
    parameters: toolDef.parameters || { type: 'object', properties: {} },
    execute: toolDef.execute,
  };
  tools.set(name, tool);
  return { ok: true, name };
}

function removeTool(name) {
  if (!tools.has(name)) return { ok: false, error: `工具不存在: ${name}` };
  tools.delete(name);
  return { ok: true, name };
}

function updateTool(name, updates) {
  if (!tools.has(name)) return { ok: false, error: `工具不存在: ${name}` };
  const existing = tools.get(name);
  if (updates.description !== undefined) existing.description = updates.description;
  if (updates.parameters !== undefined) existing.parameters = updates.parameters;
  if (updates.execute !== undefined) {
    if (typeof updates.execute !== 'function') return { ok: false, error: 'execute 必须是函数' };
    existing.execute = updates.execute;
  }
  return { ok: true, name, tool: { name: existing.name, description: existing.description, parameters: existing.parameters } };
}

function getTool(name) {
  const tool = tools.get(name);
  if (!tool) return null;
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

// ─── 获取所有工具的描述（供 LLM function calling 使用） ───
function getDefinitions(excludeNames = []) {
  return Array.from(tools.values())
    .filter(t => !excludeNames.includes(t.name))
    .map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
}

// ─── 获取所有工具的摘要（供前端展示） ────────────────────
function listTools() {
  return Array.from(tools.values()).map(t => ({
    name: t.name,
    description: t.description,
  }));
}

// ─── 执行工具 ────────────────────────────────────────────
// 返回 { ok, result } 或 { ok: false, error }
async function execute(name, args) {
  const tool = tools.get(name);
  if (!tool) return { ok: false, error: `未知工具: ${name}` };

  try {
    const result = await tool.execute(args);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
//  内置工具实现
// ═══════════════════════════════════════════════════════════

// ─── calculator：数学表达式求值 ──────────────────────────
// 安全的数学计算：只允许数字、运算符、括号、Math 函数
register({
  name: 'calculator',
  description: '计算数学表达式的值。支持加减乘除、幂运算、括号和常用数学函数。',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式，如 "2 + 3 * 4" 或 "Math.sqrt(144)"',
      },
    },
    required: ['expression'],
  },
  execute: async ({ expression }) => {
    // 安全检查：只允许数字、运算符、括号、空格、Math 方法和小数点
    if (!/^[\d\s+\-*/().%MathsqrtpowlogabceilfloorounmaxinPIEe,]+$/.test(expression)) {
      throw new Error('表达式包含不允许的字符');
    }
    const result = Function('"use strict"; return (' + expression + ')')();
    return String(result);
  },
});

// ─── datetime：获取当前日期时间 ──────────────────────────
register({
  name: 'datetime',
  description: '获取当前的日期和时间信息。',
  parameters: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        description: '返回格式：full（完整）、date（仅日期）、time（仅时间）',
        enum: ['full', 'date', 'time'],
      },
    },
  },
  execute: async ({ format = 'full' } = {}) => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    if (format === 'date') return dateStr;
    if (format === 'time') return timeStr;
    return `${dateStr} ${timeStr}`;
  },
});

// ─── search：模拟知识搜索 ────────────────────────────────
// 内置小型知识库，按关键词匹配返回结果
const knowledgeBase = [
  { keywords: ['python', '安装', 'install'], answer: 'Python 安装：访问 python.org 下载对应系统安装包，或使用包管理器如 brew install python (macOS)、apt install python3 (Ubuntu)。' },
  { keywords: ['node', 'nodejs', '安装'], answer: 'Node.js 安装：访问 nodejs.org 下载 LTS 版本，或使用 nvm（Node Version Manager）管理多版本：curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash' },
  { keywords: ['git', '教程', '使用'], answer: 'Git 基础流程：git init → git add . → git commit -m "msg" → git push。分支：git branch feature → git checkout feature → 开发 → git merge feature。' },
  { keywords: ['react', '组件', 'component'], answer: 'React 组件是返回 JSX 的函数。函数组件：function Comp({ prop }) { return <div>{prop}</div> }。Hooks：useState、useEffect、useRef 等。' },
  { keywords: ['openai', 'api', 'gpt'], answer: 'OpenAI API 调用：POST https://api.openai.com/v1/chat/completions，Header: Authorization: Bearer sk-xxx，Body: { model, messages, max_tokens }。' },
  { keywords: ['docker', '容器', 'container'], answer: 'Docker 基础：docker build -t img . → docker run -p 8080:80 img → docker ps 查看运行容器 → docker logs <id> 查看日志。' },
  { keywords: ['linux', '命令', 'command'], answer: '常用 Linux 命令：ls（列出文件）、cd（切换目录）、grep（搜索文本）、find（查找文件）、chmod（修改权限）、top（查看进程）。' },
];

register({
  name: 'search',
  description: '搜索知识库获取相关信息。当用户的问题涉及技术知识时使用此工具。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词或问题',
      },
    },
    required: ['query'],
  },
  execute: async ({ query }) => {
    const q = query.toLowerCase();
    const matches = knowledgeBase.filter(entry =>
      entry.keywords.some(kw => q.includes(kw.toLowerCase()))
    );
    if (matches.length > 0) {
      return matches.map(m => m.answer).join('\n\n');
    }
    return `未找到与 "${query}" 相关的信息。请尝试更具体的关键词。`;
  },
});

module.exports = {
  register,
  addTool,
  removeTool,
  updateTool,
  getTool,
  getDefinitions,
  listTools,
  execute,
};
// ─── search：向量语义搜索 ────────────────────────────────
// 使用 knowledge.search() 对知识库进行语义检索
// 如果知识库为空或 embeddings API 不可用，回退到内置知识

const fallbackKnowledge = [
  { answer: 'Python 安装：访问 python.org 下载对应系统安装包，或使用包管理器如 brew install python (macOS)、apt install python3 (Ubuntu)。' },
  { answer: 'Node.js 安装：访问 nodejs.org 下载 LTS 版本，或使用 nvm（Node Version Manager）管理多版本。' },
  { answer: 'Git 基础流程：git init → git add . → git commit -m "msg" → git push。' },
  { answer: 'React 组件是返回 JSX 的函数。Hooks：useState、useEffect、useRef 等。' },
  { answer: 'Docker 基础：docker build -t img . → docker run -p 8080:80 img → docker ps。' },
];

register({
  name: 'search',
  description: '搜索知识库获取相关信息。当用户的问题涉及技术知识时使用此工具。基于向量语义搜索，支持自然语言提问。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词或自然语言问题',
      },
    },
    required: ['query'],
  },
  execute: async ({ query }) => {
    // 1. 尝试向量语义搜索
    try {
      const results = await getKnowledge().search(query, 3);
      if (results.length > 0) {
        return results.map(r =>
          `[相似度: ${r.score.toFixed(2)}] ${r.content}`
        ).join('\n\n');
      }
    } catch (e) {
      console.warn('向量搜索失败，回退到内置知识:', e.message);
    }

    // 2. 回退：简单的内置知识匹配
    const q = query.toLowerCase();
    const matches = fallbackKnowledge.filter(k =>
      q.split(/\s+/).some(word => word.length > 1 && (
        k.answer.toLowerCase().includes(word) ||
        query.toLowerCase().includes(word)
      ))
    );
    if (matches.length > 0) {
      return matches.map(m => m.answer).join('\n\n');
    }
    return `未找到与 "${query}" 相关的信息。可以用 knowledge_base_add 工具添加相关知识。`;
  },
});

// ─── knowledge_base_add：向知识库添加条目 ────────────────
// Agent 可自主调用此工具将新知识写入知识库（自动生成向量）
register({
  name: 'knowledge_base_add',
  description: '向知识库添加一条知识。添加后会自动生成向量嵌入，支持后续语义搜索。',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: '知识内容文本',
      },
      source: {
        type: 'string',
        description: '知识来源（可选），如 URL、书名、文件名',
      },
    },
    required: ['content'],
  },
  execute: async ({ content, source }) => {
    const { id, hasVector } = await getKnowledge().add(content, source || 'agent');
    return `已添加知识条目 (ID: ${id})${hasVector ? '，向量嵌入已生成' : '，向量嵌入未生成'}`;
  },
});

// ─── knowledge_base_remove：从知识库删除条目 ─────────────
register({
  name: 'knowledge_base_remove',
  description: '从知识库中删除一条知识。',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'integer',
        description: '要删除的知识条目 ID',
      },
    },
    required: ['id'],
  },
  execute: async ({ id }) => {
    const removed = await getKnowledge().remove(id);
    if (!removed) return `未找到 ID 为 ${id} 的知识条目`;
    return `已删除知识条目 (ID: ${id})`;
  },
});

// ─── fetch：网页抓取 ────────────────────────────────────────
register({
  name: 'fetch',
  description: '抓取指定 URL 的网页内容，返回 HTML 或纯文本。用于获取在线文档、API 响应等。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要抓取的网页 URL（必须以 http:// 或 https:// 开头）',
      },
      timeout: {
        type: 'integer',
        description: '超时时间（毫秒），默认 15000',
      },
      responseType: {
        type: 'string',
        enum: ['text', 'html'],
        description: '返回格式：text（纯文本）或 html（原始 HTML），默认 text',
      },
    },
    required: ['url'],
  },
  execute: async ({ url, timeout = 15000 }) => {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('URL 必须以 http:// 或 https:// 开头');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LLM-Agent/1.0' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const text = await response.text();
      if (text.length > 1024 * 1024) {
        throw new Error('响应内容超过 1MB 限制，请尝试更具体的 URL');
      }
      return text.slice(0, 50000);
    } finally {
      clearTimeout(timer);
    }
  },
});

// ─── execute_code：代码执行 ──────────────────────────────────
register({
  name: 'execute_code',
  description: '执行代码片段并返回执行结果。支持 JavaScript 和 Python。适用于快速验证算法、处理数据、自动化任务等。',
  parameters: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        enum: ['javascript', 'python'],
        description: '代码语言：javascript 或 python',
      },
      code: {
        type: 'string',
        description: '要执行的代码内容',
      },
      timeout: {
        type: 'integer',
        description: '执行超时时间（毫秒），默认 10000',
      },
    },
    required: ['language', 'code'],
  },
  execute: async ({ language, code, timeout = 10000 }) => {
    if (!code || typeof code !== 'string') throw new Error('code 参数必填');
    if (code.length > 10000) throw new Error('代码长度超过 10000 字符限制');

    if (language === 'javascript') {
      const vm = require('vm');
      const sandbox = {
        console: { log: (...args) => { logs.push(args.map(String).join(' ')); } },
        setTimeout, clearTimeout, Math, JSON, Date, parseInt, parseFloat,
        isNaN, isFinite, Array, Object, String, Number, Boolean, RegExp,
        Map, Set, Promise, Error, RangeError, TypeError, SyntaxError, ReferenceError,
      };
      const logs = [];
      const context = vm.createContext(sandbox);
      const script = new vm.Script(code, { timeout });
      const result = script.runInContext(context, { timeout });
      const output = logs.join('\n');
      return output ? `${output}\n${String(result ?? 'undefined')}` : String(result ?? 'undefined');
    }

    if (language === 'python') {
      const { execFile } = require('child_process');
      const tmpFile = `${__dirname}/data/tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.py`;
      require('fs').writeFileSync(tmpFile, code);
      try {
        const result = await new Promise((resolve, reject) => {
          const child = execFile('python3', [tmpFile], { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
              if (err.killed) reject(new Error('执行超时'));
              else reject(new Error(stderr || err.message));
            } else resolve(stdout);
          });
        });
        return result || '(无输出)';
      } finally {
        try { require('fs').unlinkSync(tmpFile); } catch {}
      }
    }

    throw new Error(`不支持的语言: ${language}，仅支持 javascript 和 python`);
  },
});

// ─── read_file：读取文件 ────────────────────────────────────
register({
  name: 'read_file',
  description: '读取项目目录内的文件内容（文本文件）。路径相对于 agent/ 项目根目录。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对于 agent/ 项目目录），如 "tools.js"、"README.md"',
      },
    },
    required: ['path'],
  },
  execute: async ({ path: filePath }) => {
    const fs = require('fs');
    const pathMod = require('path');
    const projectRoot = pathMod.resolve(__dirname);
    const resolved = pathMod.resolve(projectRoot, filePath);
    if (!resolved.startsWith(projectRoot)) {
      throw new Error('不允许读取项目目录之外的文件');
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      throw new Error(`路径不是文件: ${filePath}`);
    }
    if (stat.size > 1024 * 1024) {
      throw new Error('文件超过 1MB 限制');
    }
    const isBinary = ['.db', '.sqlite', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.eot', '.ttf']
      .includes(pathMod.extname(filePath).toLowerCase());
    if (isBinary) {
      throw new Error('不支持读取二进制文件');
    }
    return fs.readFileSync(resolved, 'utf-8');
  },
});

// ─── write_file：写入文件 ───────────────────────────────────
register({
  name: 'write_file',
  description: '向项目 data/ 目录写入文件内容。用于保存 Agent 生成的报告、数据文件等。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对于 data/ 子目录），如 "report.md"、"output/data.json"',
      },
      content: {
        type: 'string',
        description: '文件内容',
      },
    },
    required: ['path', 'content'],
  },
  execute: async ({ path: filePath, content }) => {
    const fs = require('fs');
    const pathMod = require('path');
    const dataDir = pathMod.resolve(__dirname, 'data');
    const resolved = pathMod.resolve(dataDir, filePath);
    if (!resolved.startsWith(dataDir)) {
      throw new Error('不允许写入项目 data/ 目录之外的文件');
    }
    if (content.length > 1024 * 1024) {
      throw new Error('内容超过 1MB 限制');
    }
    const dir = pathMod.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, content, 'utf-8');
    return `文件已写入: data/${filePath} (${content.length} 字符)`;
  },
});

module.exports = {
  register,
  addTool,
  removeTool,
  updateTool,
  getTool,
  getDefinitions,
  listTools,
  execute,
};
