# Agent — LLM 多服务商对话应用

基于 OpenAI 兼容协议的轻量级 AI Agent 开发学习项目，支持多服务商切换、多轮对话、流式输出，并附带 React 前端聊天界面。

---

## 项目结构

```
agent/
├── config.js          # 多服务商配置中心（API Key / Base URL / 模型选择）
├── llm-client.js      # LLM 调用封装层（OpenAI SDK 兼容协议）
├── server.js          # Node.js HTTP API 服务（多轮对话 + 前端通信）
├── 01-hello.js        # 示例：Anthropic SDK 单轮调用
├── 02-multi-turn.js   # 示例：多轮对话（对话历史累积）
├── 03-stream.js       # 示例：流式输出（逐 chunk 打印）
├── package.json       # 后端依赖（openai + @anthropic-ai/sdk）
└── frontend/          # React + Vite 聊天前端
    ├── src/
    │   ├── App.jsx    # 聊天主组件（消息列表 + 发送逻辑）
    │   ├── App.css    # 聊天界面样式
    │   ├── main.jsx   # React 入口
    │   └── index.css  # 全局样式（含暗色模式）
    ├── index.html
    ├── vite.config.js
    └── package.json   # 前端依赖（React 19 + Vite 8）
```

---

## 技术架构

### 整体架构

```
┌──────────────┐       POST /api/chat       ┌──────────────┐
│   Frontend   │ ──────────────────────────► │   server.js  │
│  React+Vite  │ ◄────────────────────────── │  (port 3001) │
│  (port 5173) │       JSON { reply }        │      │        │
└──────────────┘                              │      ▼        │
                                              │  llm-client  │
                                              │      │        │
                                              │      ▼        │
                                              │  config.js   │
                                              │  (多服务商)   │
                                              └──────────────┘
```

### 核心模块说明

#### `config.js` — 多服务商配置中心

- 通过 `LLM_PROVIDER` 环境变量选择服务商，默认 `minimax`
- 支持 5 个服务商：`openai` / `siliconflow` / `zhipu` / `minimax` / `custom`
- 每个服务商独立配置 `apiKey` 和 `baseURL`，均支持环境变量覆盖
- 统一导出 `defaultModel` 字段，当前默认 `MiniMax-Text-01`

**设计要点**：所有服务商均遵循 OpenAI 兼容协议（`/v1/chat/completions`），因此只需切换 `baseURL` + `apiKey` 即可无缝切换后端，无需修改调用逻辑。

#### `llm-client.js` — LLM 调用封装层

- 基于 `openai` npm 包，通过 `createClient()` 工厂函数动态创建客户端
- `chat(messages, model?)` 函数封装了 `chat.completions.create` 调用
- 固定 `max_tokens: 500`（后续可参数化）
- 自含 `main()` 测试入口，可直接 `node llm-client.js` 验证连通性

#### `server.js` — HTTP API 服务

- 原生 `http` 模块，无框架依赖，监听 `3001` 端口
- `POST /api/chat`：接收 `{ message }` JSON，返回 `{ reply }` JSON
- 服务端维护 `conversationHistory` 数组实现多轮对话上下文
- 内置 CORS 支持（`Access-Control-Allow-Origin: *`）
- 对话历史存储在内存中（进程重启即丢失）

#### `01-hello.js` — Anthropic SDK 示例

- 独立使用 `@anthropic-ai/sdk` 直接调用 Claude API
- 展示 Anthropic 响应结构：`content[0]` 为 thinking，`content[1]` 为 text
- 与主流程无关，仅作学习参考

#### `02-multi-turn.js` — 多轮对话示例

- 演示客户端侧对话历史管理：`messages` 数组累积 `user` / `assistant` 消息
- `ask(content)` 函数：追加用户消息 → 调用 LLM → 追加 AI 回复 → 返回
- 三轮对话演示上下文记忆能力

#### `03-stream.js` — 流式输出示例

- `stream: true` 开启 SSE 流式响应
- `for await...of` 逐 chunk 读取 `delta.content`，`process.stdout.write` 实时打印
- 累积 `fullContent` 并最终返回完整文本

### 前端 `frontend/`

- **React 19** + **Vite 8** + **ESLint**
- `App.jsx`：聊天界面核心组件
  - `useState` 管理消息列表和输入状态
  - `fetch('http://localhost:3001/api/chat')` 调用后端 API
  - `useRef` + `useEffect` 实现自动滚动到底部
  - Enter 发送 / Shift+Enter 换行
- `App.css`：聊天气泡布局，用户消息右对齐蓝色，AI 消息左对齐白色
- `index.css`：全局样式，支持 `prefers-color-scheme: dark` 暗色模式

---

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 1. 安装后端依赖

```bash
cd agent
npm install
```

### 2. 配置环境变量

创建 `.env` 文件或直接设置环境变量（以 MiniMax 为例）：

```bash
export LLM_PROVIDER=minimax
export MINIMAX_API_KEY=your-api-key-here
```

其他服务商对应的环境变量：

| 服务商       | `LLM_PROVIDER` | 环境变量              | Base URL                              |
|-------------|----------------|----------------------|---------------------------------------|
| OpenAI      | `openai`       | `OPENAI_API_KEY`     | `https://api.openai.com/v1`          |
| 硅基流动     | `siliconflow`  | `SILICONFLOW_API_KEY`| `https://api.siliconflow.cn/v1`      |
| 智谱         | `zhipu`        | `ZHIPU_API_KEY`      | `https://open.bigmodel.cn/api/paas/v4`|
| MiniMax     | `minimax`      | `MINIMAX_API_KEY`    | `https://api.minimax.chat/v1`        |

### 3. 运行示例脚本

```bash
# 单轮调用（Anthropic SDK，需 ANTHROPIC_API_KEY）
node 01-hello.js

# 多轮对话
node 02-multi-turn.js

# 流式输出
node 03-stream.js

# LLM 客户端测试
node llm-client.js
```

### 4. 启动前后端完整应用

```bash
# 终端 1：启动后端 API 服务（端口 3001）
node server.js

# 终端 2：启动前端开发服务器（端口 5173）
cd frontend
npm install
npm run dev
```

浏览器打开 `http://localhost:5173` 即可使用聊天界面。

---

## 技术设计要点

### OpenAI 兼容协议统一封装

项目核心设计是利用 OpenAI SDK 的 `baseURL` 参数兼容所有遵循 OpenAI 协议的国内服务商。这意味着：

- **零适配成本**：新增服务商只需在 `config.js` 添加一组 `{ apiKey, baseURL }` 配置
- **统一调用接口**：所有服务商共享 `chat()` / `streamChat()` 函数，无需为不同服务商编写适配代码
- **环境变量优先**：API Key 和 Provider 均可通过环境变量覆盖，便于 CI/CD 和多环境部署

### 对话历史管理

当前实现为**内存存储**（`conversationHistory` 数组），特点：

- ✅ 简单直接，适合学习和原型验证
- ⚠️ 进程重启后历史丢失
- ⚠️ 全局共享一份历史，不支持多用户/多会话隔离

### 流式输出

`03-stream.js` 展示了 SSE 流式接收模式，但当前 `server.js` 和前端尚未接入流式。流式输出的完整链路需要：

1. 后端 `server.js` 将 `stream: true` 响应以 SSE 格式转发
2. 前端使用 `EventSource` 或 `fetch + ReadableStream` 逐 chunk 渲染

---

## 后续开发路线

### P0 — 基础完善

- [ ] **流式输出打通**：`server.js` 支持 SSE 转发，前端 `App.jsx` 改用流式渲染，实现打字机效果
- [ ] **多会话隔离**：为每个用户/会话分配独立 `conversationHistory`，支持同时多个聊天窗口
- [ ] **对话持久化**：将对话历史存储到文件（JSON）或数据库（SQLite / Redis），重启后可恢复

### P1 — 功能增强

- [ ] **max_tokens 参数化**：当前硬编码 `500`，应支持前端传递或按模型动态调整
- [ ] **模型选择**：前端增加模型切换 UI，`config.js` 支持多模型配置
- [ ] **System Prompt 配置**：支持自定义系统提示词，当前硬编码在 `server.js`
- [ ] **错误处理增强**：API 限流 / 超时 / Key 失效等场景的友好提示
- [ ] **Markdown 渲染**：AI 回复中的代码块、列表等 Markdown 内容前端渲染

### P2 — Agent 能力扩展

- [ ] **Tool/Function Calling**：接入 OpenAI 兼容的 function calling，让 LLM 调用外部工具（搜索、计算、数据库查询等）
- [ ] **RAG 检索增强**：对接向量数据库，实现知识库问答
- [ ] **多步推理**：实现 ReAct / Plan-and-Execute 等 Agent 循环模式
- [ ] **多模态**：支持图片/文件输入，对接视觉模型

### P3 — 工程化

- [ ] **Express/Fastify 替换原生 http**：获得中间件生态、路由、请求解析等开箱支持
- [ ] **TypeScript 重写**：增强类型安全和开发体验
- [ ] **环境变量管理**：引入 `dotenv`，统一 `.env` 文件加载
- [ ] **单元测试**：`jest` / `vitest` 覆盖 `config.js`、`llm-client.js` 核心逻辑
- [ ] **Docker 化**：前后端统一容器化部署

---

## 依赖说明

### 后端

| 包                  | 版本      | 用途                          |
|---------------------|----------|-------------------------------|
| `openai`            | ^6.34.0  | OpenAI 兼容协议 SDK（核心）    |
| `@anthropic-ai/sdk` | ^0.90.0  | Anthropic Claude SDK（示例用） |

### 前端

| 包              | 版本     | 用途            |
|----------------|---------|-----------------|
| `react`        | ^19.2.5 | UI 框架         |
| `react-dom`    | ^19.2.5 | DOM 渲染        |
| `vite`         | ^8.0.9  | 构建工具 + HMR  |

---

## 许可证

ISC
