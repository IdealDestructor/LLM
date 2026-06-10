const OpenAI = require('openai');
const config = require('./config');

function createClient() {
  const cfg = config[config.provider] || config.openai;
  return new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
  });
}

async function streamChat(messages) {
  const client = createClient();

  const stream = await client.chat.completions.create({
    model: config.defaultModel,
    messages,
    max_tokens: 500,
    stream: true,  // 开启流式输出
  });

  let fullContent = '';

  // 流式接收每个chunk
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    if (text) {
      process.stdout.write(text);  // 实时输出
      fullContent += text;
    }
  }
  console.log('\n');

  return fullContent;
}

async function main() {
  const messages = [
    { role: 'system', content: '你是一个幽默的AI助手。' },
    { role: 'user', content: '讲个笑话' }
  ];

  console.log('AI: ', end='');
  await streamChat(messages);
}

main();
