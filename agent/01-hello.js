const Anthropic = require('@anthropic-ai/sdk').default;

const anthropic = new Anthropic();

async function main() {
  const message = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 100,
    messages: [
      { role: 'user', content: '用一句话介绍自己' }
    ]
  });

  // content[0]=thinking(推理), content[1]=text(回复)
  console.log('AI回复:', message.content[1].text);
}

main();
