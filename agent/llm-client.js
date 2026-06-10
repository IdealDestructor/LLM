const OpenAI = require('openai');
const config = require('./config');

function createClient() {
  const cfg = config[config.provider] || config.openai;

  return new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
  });
}

async function chat(messages, model = null) {
  const client = createClient();
  const useModel = model || config.defaultModel;

  const response = await client.chat.completions.create({
    model: useModel,
    messages,
    max_tokens: 500,
  });

  return response.choices[0].message.content;
}

// 测试
async function main() {
  const messages = [
    { role: 'user', content: '用一句话介绍自己' }
  ];

  try {
    const reply = await chat(messages);
    console.log('AI回复:', reply);
  } catch (e) {
    console.error('调用失败:', e.message);
  }
}

main();
