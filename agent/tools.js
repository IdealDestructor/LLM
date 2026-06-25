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
function register(tool) {
  tools.set(tool.name, tool);
}

// ─── 获取所有工具的描述（供 LLM function calling 使用） ───
function getDefinitions() {
  return Array.from(tools.values()).map(t => ({
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
  getDefinitions,
  listTools,
  execute,
};
