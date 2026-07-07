# ─── Stage 1: 构建前端 ─────────────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─── Stage 2: 运行时 ───────────────────────────────────────
FROM node:22-alpine AS runtime
 
WORKDIR /app

# 安装 better-sqlite3 编译所需的 native 构建工具
RUN apk add --no-cache python3 make g++

# 安装后端依赖（仅生产依赖）
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
 
# 复制后端源码
COPY config.js sessions.js tools.js agent.js server.js settings.js db.js embeddings.js redis.js knowledge.js vector-store.js vector-store-sqlite.js vector-store-qdrant.js mcp-manager.js llm-client.js ./

# 复制前端构建产物
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

# 数据持久化目录（SQLite + 上传图片）
RUN mkdir -p data/uploads
 
VOLUME ["/app/data"]

EXPOSE 3001

CMD ["node", "server.js"]
