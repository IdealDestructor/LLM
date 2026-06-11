# Agent — LLM 多服务商对话应用

基于 OpenAI 兼容协议的轻量级 AI Agent 开发学习项目。支持多服务商切换、SSE 流式输出（打字机效果）、多会话隔离、JSON 文件持久化，附带现代风格 React 前端聊天界面。

---

## 项目结构

```
agent/
├── config.js          # 多服务商配置中心（.env 自动加载）
├── sessions.js        # 会话管理模块（内存 Map + JSON 文件持久化）
├── llm-client.js      # LLM 调用封装层（OpenAI SDK 兼容协议）
├── server.js          # Node.js HTTP API 服务（会话 CRUD + SSE 流式聊天）
├── .env               # 环境变量配置（API Key / Provider / Model）
├── data/sessions/     # 会话持久化目录（每个会话一个 JSON 文件）
├── 01-hello.js        # 示例：Anthropic SDK 单轮调用
├── 02-multi-turn.js   # 示例：多轮对话（对话历史累积）
├── 03-stream.js       # 示例：流式输出（逐 chunk 打印）
├── package.json       # 后端依赖
└── frontend/          # React + Vite 聊天前端
    ├── src/
    │   ├── App.jsx    # 主组件（侧边栏 + 消息列表 + 流式渲染 + Markdown）
    │   ├── App.css    # 界面样式（暗色模式 + 动画）
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
┌──────────────────────────────────────────────────────────┐
│  Frontend (React 19 + Vite 8)                           │
│  ┌──────────┐  ┌────────────────────────────────────┐   │
│  │ 侧边栏    │  │ 聊天主区域                           │   │
│  │ 会话列表   │  │ ┌──────────────────────────────┐  │   │
│  │ 新建/切换  │  │ │ 消息气泡 (Markdown 渲染)      │  │   │
│  │ /删除     │  │ │ 打字机光标 ▎                  │  │   │
│  └──────────┘  │ └──────────────────────────────┘  │   │
│                 │ ┌──────────────────────────────┐  │   │
│                 │ │ 输入框 + 发送按钮              │  │   │
│                 │ └──────────────────────────────┘  │   │
│                 └────────────────────────────────────┘   │
└──────────────┬───────────────────────────────────────────┘
               │ POST /api/chat/stream  { message, sessionId }
               │ GET/POST/PATCH/DELETE /api/sessions
               ▼
┌──────────────────────────────────────────────────────────┐
│  server.js (port 3001)                                   │
│  ┌─────────────┐  ┌──────────────────────────────────┐  │
│  │ sessions.js │  │ OpenAI SDK (stream: true)        │  │
│  │ Map + JSON  │  │ → SSE text/event-stream          │  │
│  │ 持久化      │  │ → data: {"content":"..."}\n\n    │  │
│  └─────────────┘  └──────────────────────────────────┘  │
│         │                                                 │
│         ▼                                                 │
│  ┌─────────────┐                                         │
│  │ config.js   │  .env → provider / apiKey / baseURL     │
│  └─────────────┘                                         │
└──────────────────────────────────────────────────────────┘
```

### 核心模块说明

#### `config.js` — 多服务商配置中心

- 启动时自动加载 `.env` 文件（手动实现，无需 dotenv 依赖）
- 通过 `LLM_PROVIDER` 环境变量选择服务商，默认 `custom`
- 支持 5 个服务商：`openai` / `siliconflow` / `zhipu` / `minimax` / `custom`
- 每个服务商独立配置 `apiKey` 和 `baseURL`，均支持环境变量覆盖
- `defaultModel` 支持通过 `DEFAULT_MODEL` 环境变量覆盖

**设计要点**：所有服务商均遵循 OpenAI 兼容协议（`/v1/chat/completions`），只需切换 `baseURL` + `apiKey` 即可无缝切换后端。

#### `sessions.js` — 会话管理 + JSON 持久化

**内存存储**：`Map<sessionId, { meta, messages }>`，每个会话独立维护对话历史。

**持久化策略**：
- 存储目录：`data/sessions/`，每个会话一个 JSON 文件（`{sessionId}.json`）
- 变更即写：`create` / `appendMessage` / `updateTitle` / `remove` 操作后立即同步写文件
- 启动恢复：`loadAll()` 扫描目录，逐个 `JSON.parse` 恢复到内存 Map
- 单文件损坏不影响其他会话（try-catch 跳过）

**为什么每个会话一个文件**：避免单文件过大、删除无需重写全量、读写锁粒度更小。

#### `server.js` — HTTP API 服务

原生 `http` 模块，无框架依赖，启动时自动从磁盘恢复会话数据。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/sessions` | 创建会话，返回 `{ sessionId, meta }` |
| GET | `/api/sessions` | 列出所有会话摘要 |
| GET | `/api/sessions/:id` | 获取会话详情（含消息历史） |
| PATCH | `/api/sessions/:id` | 更新会话标题 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| POST | `/api/chat/stream` | SSE 流式聊天（需 `sessionId`） |
| POST | `/api/chat` | 非流式聊天（需 `sessionId`，保留兼容） |

#### `01-hello.js` / `02-multi-turn.js` / `03-stream.js` — 学习示例

独立脚本，分别演示 Anthropic SDK 调用、多轮对话历史管理、流式输出。与主流程无关，仅供学习参考。

### 前端 `frontend/`

- **React 19** + **Vite 8**
- **侧边栏**：会话列表，新建 / 切换 / 删除，可折叠
- **消息区**：Markdown 渲染（粗体/斜体/行内代码/代码块），打字机光标，思考中三点动画
- **输入区**：自动调高 textarea，Enter 发送 / Shift+Enter 换行
- **暗色模式**：自动跟随 `prefers-color-scheme: dark`
- **CSS 变量体系**：全局主题色、间距、阴影统一管理

---

## 关键技术实现

### SSE 流式输出

**后端**（`server.js` → `handleStreamChat`）：
1. 设置 SSE 响应头：`Content-Type: text/event-stream` + `Cache-Control: no-cache` + `Connection: keep-alive`
2. OpenAI SDK 传 `stream: true`，返回异步迭代器
3. `for await (const chunk of stream)` 逐 chunk 提取 `delta.content`
4. 按 SSE 格式 `data: {"content":"..."}\n\n` 写入响应
5. 流结束发送 `data: [DONE]\n\n`

**前端**（`App.jsx` → `sendMessage`）：
1. `response.body.getReader()` 获取 ReadableStream 读取器
2. `TextDecoder` 将 `Uint8Array` 解码为 UTF-8 文本
3. 按 `\n` 分割解析 SSE 行，处理跨 chunk 的不完整行（buffer 缓冲）
4. 收到 `[DONE]` 退出读取循环
5. 每个 chunk 更新 `messages` 状态，触发 React 重渲染 → 打字机效果

### 会话隔离

- 后端：`sessions.js` 用 `Map<sessionId, { meta, messages }>` 管理多个独立对话
- 前端：`activeSessionId` 标记当前会话，切换时从服务端加载消息历史
- 聊天请求携带 `sessionId`，后端按 ID 取对应历史，不同会话完全隔离

### JSON 文件持久化

- 每次数据变更（create/append/update/delete）后立即 `writeFileSync` 写入 `data/sessions/{id}.json`
- 启动时 `loadAll()` 扫描目录恢复所有会话
- 进程重启后对话历史完整保留

### 打字机效果

- 流式输出中：消息对象 `streaming: true`，CSS 追加闪烁光标 `▎`
- 流式结束：`streaming` 设为 `false`，光标立即消失
- 等待首字：三点脉冲动画（`dot-pulse`）

---

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 1. 安装依赖

```bash
cd agent
npm install
cd frontend
npm install
```

### 2. 配置 `.env`

在 `agent/` 目录创建 `.env` 文件：

```env
# 服务商: openai / siliconflow / zhipu / minimax / custom
LLM_PROVIDER=custom

# 自定义代理服务（OpenAI 兼容协议）
CUSTOM_API_KEY=your-api-key
CUSTOM_BASE_URL=https://your-proxy.com/v1

# 默认模型
DEFAULT_MODEL=gpt-4o-mini
```

各服务商配置：

| 服务商 | `LLM_PROVIDER` | 环境变量 | Base URL |
|--------|----------------|----------|----------|
| OpenAI | `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| 硅基流动 | `siliconflow` | `SILICONFLOW_API_KEY` | `https://api.siliconflow.cn/v1` |
| 智谱 | `zhipu` | `ZHIPU_API_KEY` | `https://open.bigmodel.cn/api/paas/v4` |
| MiniMax | `minimax` | `MINIMAX_API_KEY` | `https://api.minimax.chat/v1` |
| 自定义 | `custom` | `CUSTOM_API_KEY` + `CUSTOM_BASE_URL` | 自定义 |

### 3. 启动应用

```bash
# 终端 1：后端 API 服务（端口 3001）
cd agent
node server.js

# 终端 2：前端开发服务器（端口 5173）
cd agent/frontend
npm run dev
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

- [ ] **max_tokens 参数化**：当前硬编码 `500`，支持前端传递或按模型动态调整
- [ ] **模型选择 UI**：前端增加模型切换，`config.js` 支持多模型配置
- [ ] **System Prompt 配置**：支持自定义系统提示词，当前硬编码在 `sessions.js`
- [ ] **错误处理增强**：API 限流 / 超时 / Key 失效等场景的友好提示
- [ ] **写入 debounce**：合并短时间内的多次文件写入，减少 I/O

### P2 — Agent 能力扩展

- [ ] **Tool/Function Calling**：接入 function calling，让 LLM 调用外部工具
- [ ] **RAG 检索增强**：对接向量数据库，实现知识库问答
- [ ] **多步推理**：实现 ReAct / Plan-and-Execute 等 Agent 循环模式
- [ ] **多模态**：支持图片/文件输入，对接视觉模型

### P3 — 工程化

- [ ] **Express/Fastify 替换原生 http**：获得中间件生态、路由、请求解析
- [ ] **TypeScript 重写**：增强类型安全和开发体验
- [ ] **单元测试**：`vitest` 覆盖 `sessions.js`、`config.js` 核心逻辑
- [ ] **Docker 化**：前后端统一容器化部署
- [ ] **数据库持久化**：从 JSON 文件迁移到 SQLite / Redis

---

## 依赖说明

### 后端

| 包 | 版本 | 用途 |
|----|------|------|
| `openai` | ^6.34.0 | OpenAI 兼容协议 SDK（核心） |
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
