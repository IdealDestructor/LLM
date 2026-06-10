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

  // 默认模型
  defaultModel: 'MiniMax-Text-01',
};
