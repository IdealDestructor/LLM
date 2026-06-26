// ─── 手动加载 .env 文件（无需 dotenv 依赖） ──────────────────
const fs = require('fs');
const envPath = require('path').resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8')
    .split('\n')
    .forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const eq = line.indexOf('=');
      if (eq === -1) return;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    });
}

module.exports = {
  // 选择服务商: 'openai', 'siliconflow', 'zhipu', 'minimax', 'custom'
  provider: process.env.LLM_PROVIDER || 'minimax',

  // 各服务商配置
  openai: {
    apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  },

  siliconflow: {
    apiKey: process.env.SILICONFLOW_API_KEY || 'your-sf-key',
    baseURL: 'https://api.siliconflow.cn/v1',
  },

  zhipu: {
    apiKey: process.env.ZHIPU_API_KEY || 'your-zhipu-key',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  },

  minimax: {
    apiKey: process.env.MINIMAX_API_KEY || 'your-minimax-key',
    baseURL: 'https://api.minimax.chat/v1',
  },

  custom: {
    apiKey: process.env.CUSTOM_API_KEY || '',
    baseURL: process.env.CUSTOM_BASE_URL || '',
  },

  // ─── 可选模型列表 ──────────────────────────────────────
  // 前端模型选择 UI 展示用，每项包含：
  //   id:       传给 OpenAI SDK 的 model 参数值
  //   name:     前端展示名称
  //   maxTokens: 该模型的默认 max_tokens（前端可覆盖）
  //
  // 可通过 .env 的 MODELS_JSON 覆盖（JSON 字符串）
  models: (() => {
    const defaults = [
      { id: 'gpt-4o-mini',       name: 'GPT-4o Mini',    maxTokens: 4096 },
      { id: 'gpt-4o',            name: 'GPT-4o',         maxTokens: 4096 },
      { id: 'gpt-4.1-mini',      name: 'GPT-4.1 Mini',   maxTokens: 4096 },
      { id: 'gpt-4.1',           name: 'GPT-4.1',        maxTokens: 8192 },
      { id: 'glm-4-flash',       name: 'GLM-4 Flash',    maxTokens: 4096 },
      { id: 'glm-5.1',           name: 'GLM-5.1',        maxTokens: 8192 },
      { id: 'deepseek-chat',     name: 'DeepSeek Chat',  maxTokens: 4096 },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1',    maxTokens: 8192 },
      { id: 'Qwen3-32B',        name: 'Qwen3 32B',      maxTokens: 4096 },
    ];
    try {
      if (process.env.MODELS_JSON) return JSON.parse(process.env.MODELS_JSON);
    } catch {}
    return defaults;
  })(),

  // 默认模型（从 models 列表取第一个，或 .env 覆盖）
  defaultModel: process.env.DEFAULT_MODEL || 'gpt-4o-mini',

  // 全局默认 max_tokens（当模型未单独配置时使用）
  defaultMaxTokens: parseInt(process.env.DEFAULT_MAX_TOKENS, 10) || 4096,
};
