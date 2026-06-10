// ─── 手动加载 .env 文件（无需 dotenv 依赖） ──────────────────
// 逐行读取 .env，忽略注释和空行，设置到 process.env
const fs = require('fs');
const envPath = require('path').resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8')
    .split('\n')
    .forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;       // 跳过空行和注释
      const eq = line.indexOf('=');
      if (eq === -1) return;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;   // 不覆盖已存在的环境变量
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

  // 自定义代理服务（OpenAI 兼容协议）
  custom: {
    apiKey: process.env.CUSTOM_API_KEY || '',
    baseURL: process.env.CUSTOM_BASE_URL || '',
  },

  // 默认模型
  defaultModel: process.env.DEFAULT_MODEL || 'MiniMax-Text-01',
};
