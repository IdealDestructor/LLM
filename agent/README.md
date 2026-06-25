# Agent — LLM 多服务商对话应用

基于 OpenAI 兼容协议的轻量级 AI Agent 开发学习项目。支持多服务商切换、SSE 流式输出（打字机效果）、多会话隔离、JSON 文件持久化、模型选择、ReAct 多步推理（function calling + 工具调用），附带现代风格 React 前端聊天界面。

---

## 项目结构

```
agent/
├── config.js          # 多服务商配置中心（.env 自动加载 + 模型列表）
├── sessions.js        # 会话管理模块（内存 Map + JSON 文件持久化）
├── tools.js           # 工具注册表 + 内置工具（calculator/datetime/search）
├── agent.js           # ReAct 多步推理引擎（思考→行动→观察→…→最终答案）
├── llm-client.js      # LLM 调用封装层（OpenAI SDK 兼容协议）
├── server.js          # Node.js HTTP API 服务（会话 CRUD + 流式聊天 + Agent 推理）
├── .env               # 环境变量配置（API Key / Provider / Model）
├── data/sessions/     # 会话持久化目录（每个会话一个 JSON 文件）
├── 01-hello.js        # 示例：Anthropic SDK 单轮调用
├── 02-multi-turn.js   # 示例：多轮对话（对话历史累积）
├── 03-stream.js       # 示例：流式输出（逐 chunk 打印）
├── package.json       # 后端依赖
└── frontend/          # React + Vite 聊天前端
    ├── src/
    │   ├── App.jsx    # 主组件（侧边栏 + 模型选择 + Agent模式 + 推理步骤 + 流式渲染）
    │   ├── App.css    # 界面样式（暗色模式 + 步骤卡片 + 动画）
    │   ├── main.jsx   # React 入口
    │   └── index.css  # 全局样式变量
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## 技术架构

### 整体架构

```
┌───────────────────────────────────────────────────────────────┐
│  Frontend (React 19 + Vite 8)                                │
│  ┌──────────┐  ┌─────────────────────────────────────────┐   │
│  │ 侧边栏    │  │ 聊天主区域                              │   │
│  │ 会话列表   │  │ ┌───────────────────────────────────┐ │   │
│  │ 新建/切换  │  │ │ Agent 推理步骤卡片                 │ │   │
│  │ /删除     │  │ │ 💭 思考 → 🔧 调用 → 👁 结果        │ │   │
│  └──────────┘  │ ├───────────────────────────────────┤ │   │
│                 │ │ 消息气泡 (Markdown 渲染)            │ │   │
│                 │ │ 打字机光标 ▎                        │ │   │
│                 │ └───────────────────────────────────┘ │   │
│                 │ ┌───────────────────────────────────┐ │   │
│                 │ │ [对话/Agent] [模型▼]  输入框 + 发送 │ │   │
│                 │ └───────────────────────────────────┘ │   │
│                 └─────────────────────────────────────────┘   │
└──────────────┬────────────────────────────────────────────────┘
               │ POST /api/chat/stream  — 普通流式聊天
               │ POST /api/chat/agent   — ReAct Agent 推理
               │ GET/POST/PATCH/DELETE /api/sessions
               │ GET /api/models, /api/tools
               ▼
┌───────────────────────────────────────────────────────────────┐
│  server.js (port 3001)                                        │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ sessions.js │  │   agent.js   │  │ OpenAI SDK          │ │
│  │ Map + JSON  │  │ ReAct 循环   │  │ stream / tools      │ │
│  │ 持久化      │  │ Thought→Act  │  │ → SSE events        │ │
│  └─────────────┘  │ →Obs→…→Ans  │  └─────────────────────┘ │
│                    └──────────────┘                           │
│         │              │                                       │
│         ▼              ▼                                       │
│  ┌─────────────┐  ┌─────────────┐                             │
│  │ config.js   │  │   tools.js  │                             │
│  │ .env/模型列表│  │ calculator  │                             │
│  └─────────────┘  │ datetime    │                             │
│                    │ search      │                             │
│                    └─────────────┘                             │
└───────────────────────────────────────────────────────────────┘
```

### 核心模块说明

#### `config.js` — 多服务商配置中心 + 模型列表

- 启动时自动加载 `.env` 文件（手动实现，无需 dotenv 依赖）
- 支持 5 个服务商：`openai` / `siliconflow` / `zhipu` / `minimax` / `custom`
- `models` 数组：每项含 `id`（模型ID）、`name`（展示名）、`maxTokens`（默认上限），可通过 `MODELS_JSON` 环境变量覆盖
- `defaultModel` / `defaultMaxTokens` 支持环境变量覆盖

#### `sessions.js` — 会话管理 + JSON 持久化

- 内存存储：`Map<sessionId, { meta, messages }>`
- 持久化：`data/sessions/{id}.json`，变更即写，启动时 `loadAll()` 恢复
- 单文件损坏不影响其他会话

#### `tools.js` — 工具注册表 + 内置工具

3 个内置工具，遵循 OpenAI function calling 的 JSON Schema 格式：

| 工具 | 用途 | 示例 |
|------|------|------|
| `calculator` | 数学表达式求值 | `2 + 3 * 4` → `14` |
| `datetime` | 获取当前日期时间 | `2026-06-25 17:04:09` |
| `search` | 知识库关键词搜索 | `react 组件` → React 组件说明 |

API：`register(tool)` / `getDefinitions()` / `execute(name, args)` / `listTools()`

#### `agent.js` — ReAct 多步推理引擎

```
┌─────────────────────────────────────────────────┐
│  ReAct 循环（最多 8 步）                          │
│  1. Thought:  LLM 思考下一步该做什么               │
│  2. Action:   LLM 选择调用某个工具 + 参数           │
│  3. Observation: 工具执行结果                       │
│  4. 重复 1-3，直到 LLM 认为可以给出最终答案          │
│  5. Final Answer: 最终回复                         │
└─────────────────────────────────────────────────┘
```

- 使用 **OpenAI function calling**（`tools` + `tool_choice: 'auto'`）让 LLM 自主决定是否调用工具
- LLM 返回 `tool_calls` → 执行工具 → 结果以 `role: 'tool'` 加入历史 → 继续循环
- LLM 返回纯文本 → 最终答案，循环结束
- 每步通过 `onEvent` 回调推送 `thought` / `action` / `observation` / `content` / `done` 事件

#### `server.js` — HTTP API 服务

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/models` | 获取可选模型列表 |
| GET | `/api/tools` | 获取可用工具列表 |
| POST | `/api/sessions` | 创建会话 |
| GET | `/api/sessions` | 列出所有会话摘要 |
| GET | `/api/sessions/:id` | 获取会话详情 |
| PATCH | `/api/sessions/:id` | 更新会话标题 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| POST | `/api/chat/stream` | SSE 流式聊天（需 `sessionId`） |
| POST | `/api/chat/agent` | ReAct Agent 多步推理（需 `sessionId`） |
| POST | `/api/chat` | 非流式聊天（保留兼容） |

聊天请求体支持 `model` + `maxTokens` 字段，不传则用默认值。

### 前端 `frontend/`

- **React 19** + **Vite 8**
- **模式切换**：顶栏「对话 / Agent」按钮，切换普通聊天和 Agent 推理
- **模型选择**：下拉选择器，切换模型时自动更新 maxTokens
- **侧边栏**：会话列表，新建 / 切换 / 删除，可折叠
- **推理步骤卡片**：Agent 模式下展示 💭 思考 / 🔧 调用 / 👁 结果
- **消息区**：Markdown 渲染（粗体/斜体/行内代码/代码块），打字机光标，思考中三点动画
- **输入区**：自动调高 textarea，Enter 发送 / Shift+Enter 换行
- **暗色模式**：自动跟随 `prefers-color-scheme: dark`

---

## 关键技术实现

### SSE 流式输出

**后端**：设置 SSE 响应头 → `stream: true` 创建异步迭代器 → 逐 chunk 提取 `delta.content` → 按 `data: {"content":"..."}\n\n` 格式写入 → `data: [DONE]\n\n` 结束

**前端**：`response.body.getReader()` 获取 ReadableStream → `TextDecoder` 解码 → 按 `\n` 分割解析 SSE 行 → buffer 缓冲处理跨 chunk 不完整行 → 每个 chunk 更新 `messages` 状态触发重渲染

### ReAct 多步推理

**后端**（`agent.js` → `runReactStreamFinal`）：
1. 调用 LLM 时传入 `tools: toolDefinitions` + `tool_choice: 'auto'`
2. LLM 返回 `tool_calls` → 解析工具名和参数 → `tools.execute()` 执行 → 结果以 `role: 'tool'` 加入消息历史 → 继续循环
3. LLM 返回纯文本 → 作为最终答案，逐字符推送实现打字机效果
4. 每步通过 `onEvent(type, data)` 推送事件

**前端**（`App.jsx` → `sendMessage`）：
- Agent 模式请求 `POST /api/chat/agent`
- SSE 事件带 `type` 字段：`thought` / `action` / `observation` / `content` / `done` / `error`
- `thought` / `action` / `observation` 累积到 `steps` 数组，实时渲染为步骤卡片
- `content` 追加到消息文本，与普通流式一样触发打字机效果

### 会话隔离 + JSON 持久化

- 后端：`Map<sessionId, { meta, messages }>` 管理多个独立对话
- 持久化：`data/sessions/{id}.json`，变更即写，启动时 `loadAll()` 恢复
- 前端：`activeSessionId` 标记当前会话，切换时从服务端加载消息历史

### max_tokens 参数化 + 模型选择

- `config.js` 的 `models` 数组为每个模型配置默认 `maxTokens`
- `server.js` 的 `resolveModelOptions()` 解析逻辑：前端传了就用，否则从模型列表查找，再否则用全局默认值，最终 clamp 到 `[1, 16384]`
- 前端模型选择器切换时自动更新 maxTokens

### 打字机效果

- 流式输出中：`streaming: true`，CSS 追加闪烁光标 `▎`
- 流式结束：`streaming: false`，光标立即消失
- 等待首字：三点脉冲动画（`dot-pulse`）

---

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 1. 安装依赖

```bash
cd agent && npm install
cd frontend && npm install
```

### 2. 配置 `.env`

在 `agent/` 目录创建 `.env` 文件：

```env
LLM_PROVIDER=custom
CUSTOM_API_KEY=your-api-key
CUSTOM_BASE_URL=https://your-proxy.com/v1
DEFAULT_MODEL=gpt-4o-mini
```

### 3. 启动应用

```bash
# 终端 1：后端
cd agent && node server.js

# 终端 2：前端
cd agent/frontend && npm run dev
```

浏览器打开 `http://localhost:5173` 即可使用。

### 4. 运行学习示例

```bash
cd agent
node 01-hello.js      # Anthropic SDK 单轮调用
node 02-multi-turn.js # 多轮对话
node 03-stream.js     # 流式输出
node llm-client.js    # LLM 客户端连通性测试
```

---

## 后续开发路线

### P1 — 功能增强

- [ ] **System Prompt 配置**：支持自定义系统提示词，当前硬编码在 `sessions.js`
- [ ] **错误处理增强**：API 限流 / 超时 / Key 失效等场景的友好提示
- [ ] **写入 debounce**：合并短时间内的多次文件写入，减少 I/O
- [ ] **更多内置工具**：网页抓取、代码执行、文件读写等
- [ ] **工具动态注册**：支持运行时添加/移除工具，无需重启

### P2 — Agent 能力扩展

- [ ] **RAG 检索增强**：对接向量数据库，实现知识库问答
- [ ] **Plan-and-Execute 模式**：先规划任务步骤再逐步执行，适合复杂多步任务
- [ ] **多 Agent 协作**：多个 Agent 分工协作，如 Planner + Coder + Reviewer
- [ ] **多模态**：支持图片/文件输入，对接视觉模型
- [ ] **流式 function calling**：当前 Agent 最终答案用逐字符模拟流式，改为真正的 stream + tool_calls 流式

### P3 — 工程化

- [ ] **Express/Fastify 替换原生 http**：获得中间件生态、路由、请求解析
- [ ] **TypeScript 重写**：增强类型安全和开发体验
- [ ] **单元测试**：`vitest` 覆盖 `sessions.js`、`tools.js`、`agent.js` 核心逻辑
- [ ] **Docker 化**：前后端统一容器化部署
- [ ] **数据库持久化**：从 JSON 文件迁移到 SQLite / Redis

---

## 依赖说明

### 后端

| 包 | 版本 | 用途 |
|----|------|------|
| `openai` | ^6.34.0 | OpenAI 兼容协议 SDK（核心 + function calling） |
| `@anthropic-ai/sdk` | ^0.90.0 | Anthropic Claude SDK（示例用） |

### 前端

| 包 | 版本 | 用途 |
|----|------|------|
| `react` | ^19.2.5 | UI 框架 |
| `react-dom` | ^19.2.5 | DOM 渲染 |
| `vite` | ^8.0.9 | 构建工具 + HMR |

---

## 许可证

ISC
