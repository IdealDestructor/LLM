const OpenAI = require('openai');
const config = require('./config');

// 对话历史
const messages = [
  { role: 'system', content: '你是MiniMax的AI助手，用户叫你小M。' }
];

function createClient() {
  const cfg = config[config.provider] || config.openai;
  return new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
  });
}

async function ask(content) {
  const client = createClient();

  // 把用户消息加入历史
  messages.push({ role: 'user', content });

  const response = await client.chat.completions.create({
    model: config.defaultModel,
    messages,
    max_tokens: 500,
  });

  const reply = response.choices[0].message.content;

  // 把AI回复加入历史
  messages.push({ role: 'assistant', content: reply });

  return reply;
}

async function main() {
  console.log('=== 多轮对话演示 ===\n');

  // 第一轮
  let reply = await ask('我叫小明，请记住');
  console.log('AI:', reply);

  // 第二轮
  reply = await ask('我叫什么名字？');
  console.log('AI:', reply);

  // 第三轮
  reply = await ask('再问一次，我叫什么？');
  console.log('AI:', reply);

  // 打印对话历史
  console.log('\n=== 对话历史 ===');
  messages.forEach((m, i) => {
    console.log(`${i}. [${m.role}]: ${m.content.slice(0, 50)}...`);
  });
}

main();
