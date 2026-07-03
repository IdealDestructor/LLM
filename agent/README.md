# Agent — LLM 多服务商对话应用
 
基于 OpenAI 兼容协议的轻量级 AI Agent 开发学习项目。支持多服务商切换、SSE 流式输出（打字机效果）、多会话隔离、SQLite 持久化 + Redis 会话缓存、向量语义搜索（知识库 RAG）、模型选择、ReAct 多步推理（function calling + 工具调用）、多模态图片输入（对接视觉模型），附带现代风格 React 前端聊天界面。

---

## 项目结构

```
agent/
├── config.js          # 多服务商配置中心（.env 自动加载 + 模型列表）
├── db.js              # SQLite 初始化（建表 + WAL 模式 + 连接管理）
├── sessions.js        # 会话管理（SQLite 持久化 + Redis 缓存 + 旧 JSON 迁移）
├── redis.js           # Redis 会话缓存（可选，cache-aside）
├── settings.js        # 用户设置持久化（SQLite key-value）
├── embeddings.js      # 向量嵌入生成（OpenAI 兼容 API）
├── knowledge.js       # 知识库统一服务（元数据 SQLite + 向量存储）
├── vector-store.js    # 向量存储抽象层（sqlite | qdrant）
├── vector-store-sqlite.js   # SQLite BLOB 后端（默认）
├── vector-store-qdrant.js   # Qdrant 专用向量库后端
├── tools.js           # 工具注册表 + 内置工具（calculator/datetime/search/knowledge）
├── agent.js           # ReAct 多步推理引擎（思考→行动→观察→…→最终答案）
├── llm-client.js      # LLM 调用封装层（OpenAI SDK 兼容协议）
├── server.js          # Node.js HTTP API 服务（会话 CRUD + 流式聊天 + Agent 推理）
├── .env               # 环境变量配置（API Key / Provider / Model）
├── data/agent.db      # SQLite 数据库（会话 / 消息 / 设置 / 知识库）
├── data/uploads/      # 图片上传目录（多模态）
├── 01-hello.js        # 示例：Anthropic SDK 单轮调用
├── 02-multi-turn.js   # 示例：多轮对话（对话历史累积）
├── 03-stream.js       # 示例：流式输出（逐 chunk 打印）
├── package.json       # 后端依赖
├── Dockerfile         # 多阶段构建（前端 build + 后端 runtime）
├── docker-compose.yml # 一键部署（端口映射 + 数据卷）
├── .dockerignore      # Docker 构建排除文件
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
               │ POST /api/upload       — 图片上传（多模态）
               │ GET/POST/PATCH/DELETE /api/sessions
               │ GET/PUT /api/settings
               │ GET/POST/DELETE /api/knowledge, POST /api/knowledge/search
               │ GET /api/models, /api/tools
               ▼
┌───────────────────────────────────────────────────────────────┐
│  server.js (port 3001)                                        │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ sessions.js │  │   agent.js   │  │ OpenAI SDK          │ │
│  │ SQLite+Redis│  │ ReAct 循环   │  │ stream / tools      │ │
│  │             │  │ Thought→Act  │  │ embeddings API      │ │
│  └──────┬──────┘  │ →Obs→…→Ans  │  └─────────────────────┘ │
│         │          └──────────────┘                           │
│         ▼              │                                       │
│  ┌─────────────┐       ▼                                       │
│  │   db.js     │  ┌─────────────┐  ┌─────────────┐            │
│  │ agent.db    │  │   tools.js  │  │  redis.js   │            │
│  │ WAL 模式    │  │ calculator  │  │ 会话缓存    │            │
│  └─────────────┘  │ datetime    │  │ (可选)      │            │
│                    │ search(RAG)│  └─────────────┘            │
│                    │ knowledge_* │                             │
│                    └─────────────┘                             │
│         │              │                                       │
│         ▼              ▼                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ settings.js │  │ knowledge.js│  │ vector-store│            │
│  │ 用户设置    │  │ 知识库 CRUD │  │ sqlite/qdrant│           │
│  └─────────────┘  └──────┬──────┘  └─────────────┘            │
│                           │                                      │
│                    ┌──────┴──────┐  ┌─────────────┐            │
│                    │embeddings.js│  │ config.js   │            │
│                    │ 向量嵌入    │  │ .env/模型   │            │
│                    └─────────────┘  └─────────────┘            │
└───────────────────────────────────────────────────────────────┘
```

### 核心模块说明

#### `config.js` — 多服务商配置中心 + 模型列表

- 启动时自动加载 `.env` 文件（手动实现，无需 dotenv 依赖）
- 支持 5 个服务商：`openai` / `siliconflow` / `zhipu` / `minimax` / `custom`
- `models` 数组：每项含 `id`（模型ID）、`name`（展示名）、`maxTokens`（默认上限），可通过 `MODELS_JSON` 环境变量覆盖
- `defaultModel` / `defaultMaxTokens` 支持环境变量覆盖

#### `db.js` — SQLite 数据库初始化

- 单文件数据库 `data/agent.db`，WAL 模式 + 外键约束
- 四张表：`sessions`（会话元信息）、`messages`（消息历史）、`settings`（key-value 设置）、`knowledge_base`（知识库 + 向量 BLOB）
- 使用 `better-sqlite3` 同步 API，与原 `writeFileSync` 模式一致

#### `sessions.js` — 会话管理 + SQLite 持久化 + Redis 缓存

- SQLite 为权威数据源；Redis 为可选热数据缓存（cache-aside 模式）
- 读：Redis hit → 直接返回；miss → SQLite 查询 → 回填 Redis
- 写：先写 SQLite，再更新 / 失效 Redis（会话详情 + 列表）
- 未配置 `REDIS_URL` 时自动禁用 Redis，行为与纯 SQLite 一致
- 首次启动自动从旧 `data/sessions/*.json` 迁移，备份至 `data/sessions_migrated/`
- 多模态：`content` 可存纯文本或 JSON 字符串（OpenAI vision 数组），`images` 存 URL 数组

#### `redis.js` — Redis 会话缓存（可选）

- 依赖 `ioredis`，通过 `REDIS_URL` 启用（如 `redis://localhost:6379`）
- Key 前缀默认 `agent:`，会话 `agent:session:{id}`，列表 `agent:sessions:list`
- TTL 默认 24 小时（`REDIS_SESSION_TTL` 可配置）
- 连接失败时自动降级，不影响 SQLite 读写

#### `settings.js` — 用户设置持久化

- SQLite `settings` 表（key-value），启动时自动从旧 `settings.json` 迁移
- 默认项：`theme` / `systemPrompt` / `defaultAgentMode`
- API：`load()` / `save(updates)` / `get()`

#### `embeddings.js` — 向量嵌入生成

- 调用 OpenAI 兼容 `/v1/embeddings` API 生成向量（`EMBEDDING_MODEL` 可配置）
- 仅负责嵌入生成；存储与检索由 `knowledge.js` + `vector-store` 负责

#### `knowledge.js` — 知识库统一服务

- 元数据（id / source / content / created_at）持久化在 SQLite `knowledge_base` 表
- 向量写入由 `vector-store` 抽象层路由至 SQLite BLOB 或 Qdrant
- API：`list()` / `add()` / `remove()` / `search()`

#### `vector-store.js` — 向量存储抽象层

- `VECTOR_STORE=sqlite`（默认）：BLOB + 内存余弦搜索，适合小规模
- `VECTOR_STORE=qdrant`：Qdrant 专用向量库，HNSW 索引，适合大规模 RAG
- 首次启用 Qdrant 时自动将 SQLite 已有向量迁移至 Qdrant

#### `tools.js` — 工具注册表 + 内置工具

3 个内置工具，遵循 OpenAI function calling 的 JSON Schema 格式：

| 工具 | 用途 | 示例 |
|------|------|------|
| `calculator` | 数学表达式求值 | `2 + 3 * 4` → `14` |
| `datetime` | 获取当前日期时间 | `2026-06-25 17:04:09` |
| `search` | 知识库语义搜索（向量 + 回退内置知识） | `react 组件怎么用` → 相关条目 |
| `knowledge_base_add` | 向知识库添加条目（自动生成向量） | Agent 自主写入新知识 |
| `knowledge_base_remove` | 从知识库删除条目 | 按 ID 删除 |

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
| GET/PUT | `/api/settings` | 获取 / 更新用户设置 |
| GET/POST/DELETE | `/api/knowledge` | 知识库 CRUD（POST 自动生成向量嵌入） |
| POST | `/api/knowledge/search` | 语义搜索知识库（body: `{ query, topK }`） |
| POST | `/api/upload` | 图片上传（base64 → 保存到 `data/uploads/`） |
| GET | `/api/uploads/:file` | 获取上传的图片文件 |
| POST | `/api/sessions` | 创建会话 |
| GET | `/api/sessions` | 列出所有会话摘要 |
| GET | `/api/sessions/:id` | 获取会话详情 |
| PATCH | `/api/sessions/:id` | 更新会话标题 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| POST | `/api/chat/stream` | SSE 流式聊天（需 `sessionId`） |
| POST | `/api/chat/agent` | ReAct Agent 多步推理（需 `sessionId`） |
| POST | `/api/chat` | 非流式聊天（保留兼容） |

聊天请求体支持 `model` + `maxTokens` + `images` 字段，不传则用默认值。`images` 为 base64 data URL 数组，后端自动转为 OpenAI vision 格式（`content: [{ type: 'text' }, { type: 'image_url' }]`）。

### 前端 `frontend/`

- **React 19** + **Vite 8**
- **模式切换**：顶栏「对话 / Agent」按钮，切换普通聊天和 Agent 推理
- **模型选择**：下拉选择器，切换模型时自动更新 maxTokens
- **侧边栏**：会话列表，新建 / 切换 / 删除，可折叠
- **推理步骤卡片**：Agent 模式下展示 💭 思考 / 🔧 调用 / 👁 结果
- **消息区**：Markdown 渲染（粗体/斜体/行内代码/代码块），打字机光标，思考中三点动画
- **输入区**：自动调高 textarea，Enter 发送 / Shift+Enter 换行
- **暗色模式**：自动跟随 `prefers-color-scheme: dark`
- **多模态图片**：上传按钮 + 剪贴板粘贴，预览缩略图（最多 4 张），消息气泡内展示图片
- **生产部署**：Vite 构建后由后端同端口托管，无需独立前端服务器

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

### 会话隔离 + SQLite 持久化 + Redis 缓存

- 后端：`sessions` + `messages` 表管理多个独立对话，外键级联删除
- 持久化：`data/agent.db`（WAL 模式），变更即写；旧 JSON 文件首次启动自动迁移
- 缓存：配置 `REDIS_URL` 后，会话详情与列表缓存至 Redis，多实例部署可共享热数据
- 前端：`activeSessionId` 标记当前会话，切换时从服务端加载消息历史

### 向量语义搜索（知识库 RAG）

- **写入**：`POST /api/knowledge` 或 Agent 调用 `knowledge_base_add` → 嵌入 API → 向量写入 vector-store
- **检索**：`knowledge.search(query)` → sqlite 余弦 / Qdrant ANN 搜索 → top-K 结果
- **后端切换**：`VECTOR_STORE=sqlite|qdrant`，Docker Compose 默认启用 Qdrant
- **Agent 集成**：`search` 工具优先走向量搜索，失败或空库时回退内置知识
- **维度配置**：`EMBEDDING_DIMENSION` 须与嵌入模型一致（智谱 embedding-3: 2048，OpenAI text-embedding-3-small: 1536）

### max_tokens 参数化 + 模型选择

- `config.js` 的 `models` 数组为每个模型配置默认 `maxTokens`
- `server.js` 的 `resolveModelOptions()` 解析逻辑：前端传了就用，否则从模型列表查找，再否则用全局默认值，最终 clamp 到 `[1, 16384]`
- 前端模型选择器切换时自动更新 maxTokens

### 打字机效果

- 流式输出中：`streaming: true`，CSS 追加闪烁光标 `▎`
- 流式结束：`streaming: false`，光标立即消失
- 等待首字：三点脉冲动画（`dot-pulse`）

### 静态文件服务（生产模式）

开发时前端运行在 Vite dev server（端口 5173），跨域请求后端（端口 3001）。生产构建后改为同源模式：

- 前端 `import.meta.env.DEV` 判断：开发环境 `API = 'http://localhost:3001'`，生产构建后 `API = ''`（同源）
- 后端 `server.js` 新增 `serveStatic()` + `sendFile()`：API 路由未匹配时回退到 `frontend/dist/` 静态文件
- SPA 路由回退：非文件路径返回 `index.html`（如 `/some/route` → `index.html`）
- 带哈希的资源（`/assets/index-abc123.js`）设置 `Cache-Control: max-age=31536000, immutable`

### 多模态图片输入

**前端**（`App.jsx`）：
- 输入区附件按钮触发 `<input type="file" accept="image/*" multiple>`
- 支持剪贴板粘贴图片（`onPaste` 事件检测 `image/*` item）
- 待发送图片以 64x64 缩略图预览，可逐个移除（最多 4 张，单张 10MB）
- 发送时将图片 data URL 数组随 `images` 字段 POST 到后端
- 用户消息气泡内展示图片缩略图（可点击放大）

**后端**（`server.js`）：
- `POST /api/upload`：接收 `{ image: "data:image/png;base64,..." }`，解析 MIME + base64，写入 `data/uploads/{timestamp}-{random}.png`
- `GET /api/uploads/:file`：静态文件服务，返回图片二进制（带 1 天缓存头）
- `buildMessageContent(text, images)`：将文本 + 图片 URL 列表转为 OpenAI vision 格式 `content: [{ type: 'text', text }, { type: 'image_url', image_url: { url } }]`
- `handleStreamChat` / `handleAgentChat`：解析 `images` 字段 → 构建多模态消息 → 追加到会话历史

**会话持久化**（`sessions.js`）：
- `appendMessage` 支持数组类型 `content`（OpenAI vision 格式），写入 SQLite 时完整保留

**视觉模型**（`config.js`）：
- 模型列表新增 `glm-4v-flash`、`glm-4.6v`、`Qwen2.5-VL-72B` 等视觉模型
- 选择视觉模型后发送图片，LLM 可识别图片内容并回复

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
EMBEDDING_MODEL=embedding-3   # 向量嵌入模型（智谱 embedding-3 / OpenAI text-embedding-3-small）

# Redis 会话缓存（可选，不配置则仅用 SQLite）
# REDIS_URL=redis://localhost:6379
# REDIS_SESSION_TTL=86400       # 缓存过期秒数，默认 24h

# 向量库（默认 sqlite，对接 Qdrant 时改为 qdrant）
# VECTOR_STORE=qdrant
# QDRANT_URL=http://localhost:6333
# QDRANT_COLLECTION=agent_knowledge
# EMBEDDING_DIMENSION=2048      # 须与嵌入模型维度一致
# SEARCH_SCORE_THRESHOLD=0.3    # 相似度阈值
```

### 3. 启动应用

```bash
# 终端 1：后端
cd agent && node server.js

# 终端 2：前端
cd agent/frontend && npm run dev
```

浏览器打开 `http://localhost:5173` 即可使用。

### 3b. Docker 一键部署

```bash
cd agent

# 方式一：docker compose（推荐，含 Redis + 数据卷）
docker compose up --build

# 方式二：docker build + run
docker build -t llm-agent .
docker run -d -p 3001:3001 \
  -e LLM_PROVIDER=custom \
  -e CUSTOM_API_KEY=your-api-key \
  -e CUSTOM_BASE_URL=https://your-proxy.com/v1 \
  -e DEFAULT_MODEL=glm-5.1 \
  -v llm-agent-data:/app/data \
  llm-agent
```

浏览器打开 `http://localhost:3001` 即可使用（单端口同时提供 API + 前端）。

Docker 化架构：
- 多阶段构建：Stage 1 用 Vite 构建前端 → Stage 2 仅含后端 + 构建产物
- 生产模式：后端同端口托管前端静态文件（`server.js` 内置 SPA 服务）
- 数据持久化：`/app/data` 目录挂载为 Docker volume（含 `agent.db` + 上传图片）
- Redis：`docker-compose.yml` 内置 Redis 7 服务，自动注入 `REDIS_URL=redis://redis:6379`
- Qdrant：`docker-compose.yml` 内置 Qdrant 服务，自动注入 `VECTOR_STORE=qdrant` + `QDRANT_URL=http://qdrant:6333`
- `.env` 中的变量自动通过 `docker-compose.yml` 注入容器环境

### 3c. CloudBase 云部署

项目已部署到腾讯 CloudBase：

| 资源 | 地址 |
|------|------|
| **前端（静态托管）** | [https://dev-d6glr37fr08166648-1253631440.tcloudbaseapp.com/agent/](https://dev-d6glr37fr08166648-1253631440.tcloudbaseapp.com/agent/) |
| **后端 API（CloudRun）** | [https://llm-agent-277530-9-1253631440.sh.run.tcloudbase.com](https://llm-agent-277530-9-1253631440.sh.run.tcloudbase.com/api/models) |

**架构说明：**
- 后端：CloudRun 容器模式部署（Dockerfile 多阶段构建），端口 3001，0.5C/1G，0-3 实例弹性伸缩
- 前端：Vite 构建产物部署到 CloudBase 静态网站托管，API 指向 CloudRun 公网域名
- 数据：SQLite 数据库运行在容器内（注意：容器缩容到 0 或重启后数据会丢失，生产环境建议使用 CloudBase MySQL）

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

- [x] **System Prompt 配置**：设置面板 + `settings.js` SQLite 持久化
- [ ] **错误处理增强**：API 限流 / 超时 / Key 失效等场景的友好提示
- [ ] **更多内置工具**：网页抓取、代码执行、文件读写等
- [ ] **工具动态注册**：支持运行时添加/移除工具，无需重启

### P2 — Agent 能力扩展

- [x] **RAG 检索增强**：SQLite / Qdrant 双后端 + Agent 工具 + 知识库 API
- [ ] **Plan-and-Execute 模式**：先规划任务步骤再逐步执行，适合复杂多步任务
- [ ] **多 Agent 协作**：多个 Agent 分工协作，如 Planner + Coder + Reviewer
- [x] **多模态**：支持图片输入，对接视觉模型（OpenAI vision API 格式）
- [ ] **流式 function calling**：当前 Agent 最终答案用逐字符模拟流式，改为真正的 stream + tool_calls 流式

### P3 — 工程化

- [ ] **Express/Fastify 替换原生 http**：获得中间件生态、路由、请求解析
- [ ] **TypeScript 重写**：增强类型安全和开发体验
- [ ] **单元测试**：`vitest` 覆盖 `sessions.js`、`tools.js`、`agent.js` 核心逻辑
- [x] **Docker 化**：多阶段构建 + docker-compose + 数据卷持久化
- [x] **数据库持久化**：SQLite + Redis 会话缓存 + Qdrant 向量库（见下表）

#### 数据库持久化完成度

| 模块 | 存储方式 | 状态 | 说明 |
|------|----------|------|------|
| 会话 / 消息 | SQLite `sessions` + `messages` | ✅ 已完成 | `sessions.js`，含旧 JSON 自动迁移 |
| 用户设置 | SQLite `settings` | ✅ 已完成 | `settings.js`，含旧 `settings.json` 迁移 |
| 知识库元数据 | SQLite `knowledge_base` | ✅ 已完成 | `knowledge.js` 统一管理 |
| 向量存储（sqlite） | SQLite BLOB + 余弦搜索 | ✅ 已完成 | `vector-store-sqlite.js`，默认后端 |
| 向量存储（qdrant） | Qdrant HNSW 索引 | ✅ 已完成 | `vector-store-qdrant.js`，`VECTOR_STORE=qdrant` |
| Redis 会话缓存 | Redis（cache-aside） | ✅ 已完成 | `redis.js`，`REDIS_URL` 可选启用 |

---

## 依赖说明

### 后端

| 包 | 版本 | 用途 |
|----|------|------|
| `openai` | ^6.34.0 | OpenAI 兼容协议 SDK（核心 + function calling + embeddings） |
| `better-sqlite3` | ^12.11.1 | SQLite 持久化（会话 / 设置 / 知识库） |
| `ioredis` | ^5.11.1 | Redis 会话缓存（可选） |
| `@qdrant/js-client-rest` | ^1.18.0 | Qdrant 向量库客户端 |
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
