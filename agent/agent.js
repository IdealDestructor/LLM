// ─── agent.js — ReAct 多步推理引擎 ──────────────────────────
//
// ReAct (Reasoning + Acting) 是一种让 LLM 进行多步推理的 Agent 模式：
//
//   ┌─────────────────────────────────────────────────────────┐
//   │  ReAct 循环                                              │
//   │                                                          │
//   │  1. Thought: LLM 思考下一步该做什么                       │
//   │  2. Action:  LLM 选择调用某个工具 + 参数                  │
//   │  3. Observation: 工具执行结果                              │
//   │  4. 重复 1-3，直到 LLM 认为可以给出最终答案                 │
//   │  5. Final Answer: 最终回复                                │
//   │                                                          │
//   │  实现：利用 OpenAI function calling 能力                   │
//   │  - LLM 返回 tool_calls 时 → 执行工具 → 结果加入消息历史    │
//   │  - LLM 返回纯文本时 → 作为最终答案，循环结束               │
//   └─────────────────────────────────────────────────────────┘
//
// 关键实现要点：
// 1. 使用 OpenAI function calling（而非 prompt 解析）让 LLM 选择工具
//    - 比手写 prompt 解析更可靠，模型原生支持
//    - tools 参数传入工具定义，模型自动决定是否调用
// 2. 每轮循环的 Thought/Action/Observation 通过 SSE 实时推送给前端
//    - 前端可以展示推理过程，让用户看到 Agent "在想什么"
// 3. 设置最大循环次数（MAX_STEPS）防止无限循环
// 4. 流式输出最终答案时，逐 chunk 推送，保持打字机效果
//

const tools = require('./tools');
const settings = require('./settings');

const MAX_STEPS = 8; // 最大推理步数，防止无限循环

// ─── ReAct 引擎（流式） ────────────────────────────────────
//
// 参数：
//   client:    OpenAI 客户端实例
//   model:     模型 ID
//   maxTokens: max_tokens
//   messages:  对话历史（含 system prompt）
//   onEvent:   事件回调，每个推理步骤通过此回调推送
//              onEvent(type, data) 其中 type:
//                'thought'     — LLM 的思考内容（文本部分）
//                'action'      — LLM 决定调用的工具 { name, arguments }
//                'observation' — 工具执行结果
//                'content'     — 最终答案的流式 chunk
//                'done'        — 推理结束
//                'error'       — 错误
//
async function runReactStream({ client, model, maxTokens, messages, onEvent }) {
  // ── 构建工具定义（排除已禁用的工具） ──
  const s = settings.get();
  const disabledTools = s.disabledTools || [];
  const toolDefinitions = tools.getDefinitions(disabledTools);

  // 工作消息历史（不修改原始 messages，用副本）
  const workingMessages = [...messages];

  for (let step = 0; step < MAX_STEPS; step++) {
    // ── Step 1: 调用 LLM，传入工具定义 ──
    // 关键：tools 参数让模型知道有哪些工具可用
    // 模型会自主决定是直接回答还是调用工具
    let response;
    try {
      response = await client.chat.completions.create({
        model,
        messages: workingMessages,
        max_tokens: maxTokens,
        tools: toolDefinitions,
        tool_choice: 'auto',  // auto: 模型自主决定是否调用工具
      });
    } catch (e) {
      onEvent('error', { message: e.message });
      return;
    }

    const choice = response.choices[0];
    const message = choice.message;

    // ── Step 2: 将 LLM 回复加入历史 ──
    workingMessages.push(message);

    // ── Step 3: 检查 LLM 是否调用了工具 ──
    if (message.tool_calls && message.tool_calls.length > 0) {
      // LLM 选择了调用工具 → 进入 Action 阶段

      for (const toolCall of message.tool_calls) {
        const { id, function: fn } = toolCall;
        const toolName = fn.name;
        let toolArgs;

        try {
          toolArgs = JSON.parse(fn.arguments);
        } catch {
          toolArgs = {};
        }

        // 推送 Thought（如果有文本内容）
        if (message.content) {
          onEvent('thought', { step: step + 1, content: message.content });
        }

        // 推送 Action
        onEvent('action', { step: step + 1, name: toolName, arguments: toolArgs });

        // ── Step 4: 执行工具 → Observation ──
        const result = await tools.execute(toolName, toolArgs);
        const observation = result.ok ? result.result : `错误: ${result.error}`;

        // 推送 Observation
        onEvent('observation', { step: step + 1, result: observation });

        // ── Step 5: 将工具结果加入消息历史 ──
        // 这是 function calling 的标准格式：
        // role: 'tool'，content: 工具返回值，tool_call_id: 对应的调用 ID
        workingMessages.push({
          role: 'tool',
          tool_call_id: id,
          content: observation,
        });
      }

      // 继续下一轮循环，让 LLM 根据观察结果继续推理
      continue;
    }

    // ── LLM 没有调用工具 → 直接给出最终答案 ──
    if (message.content) {
      // 推送 Thought（如果有）
      onEvent('thought', { step: step + 1, content: message.content });

      // 流式推送最终答案（这里是非流式调用，直接一次性推送）
      onEvent('content', { content: message.content });
    }

    // 推理结束
    onEvent('done', { steps: step + 1 });
    return message.content || '';
  }

  // 超过最大步数，强制结束
  onEvent('error', { message: `推理步数超过上限 (${MAX_STEPS})，请简化问题或增加步数限制。` });
  return '';
}

// ─── ReAct 引擎（流式最终答案） ────────────────────────────
// 与 runReactStream 类似，但最后一轮（LLM 不调用工具时）使用流式输出
// 这样最终答案有打字机效果
async function runReactStreamFinal({ client, model, maxTokens, messages, onEvent }) {
  const s = settings.get();
  const disabledTools = s.disabledTools || [];
  const toolDefinitions = tools.getDefinitions(disabledTools);
  const workingMessages = [...messages];

  for (let step = 0; step < MAX_STEPS; step++) {
    // 判断是否最后一轮：下一步如果 LLM 不调用工具，就流式输出
    const isLikelyFinalStep = step >= 1; // 经验：至少一轮 tool call 后才可能结束

    // 非最后一轮或首轮：非流式调用（需要看 tool_calls）
    // 最后一轮：流式调用（打字机效果）
    let response;
    try {
      // 先用非流式判断是否还有 tool_calls
      response = await client.chat.completions.create({
        model,
        messages: workingMessages,
        max_tokens: maxTokens,
        tools: toolDefinitions,
        tool_choice: 'auto',
      });
    } catch (e) {
      onEvent('error', { message: e.message });
      return;
    }

    const choice = response.choices[0];
    const message = choice.message;
    workingMessages.push(message);

    // 有 tool_calls → 继续循环
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const { id, function: fn } = toolCall;
        const toolName = fn.name;
        let toolArgs;
        try { toolArgs = JSON.parse(fn.arguments); } catch { toolArgs = {}; }

        if (message.content) {
          onEvent('thought', { step: step + 1, content: message.content });
        }

        onEvent('action', { step: step + 1, name: toolName, arguments: toolArgs });

        const result = await tools.execute(toolName, toolArgs);
        const observation = result.ok ? result.result : `错误: ${result.error}`;

        onEvent('observation', { step: step + 1, result: observation });

        workingMessages.push({
          role: 'tool',
          tool_call_id: id,
          content: observation,
        });
      }
      continue;
    }

    // 无 tool_calls → 最终答案，用流式重放实现打字机效果
    if (message.content) {
      if (message.content) {
        onEvent('thought', { step: step + 1, content: message.content });
      }

      // 逐字符推送，模拟流式效果
      const chars = message.content;
      for (let i = 0; i < chars.length; i++) {
        onEvent('content', { content: chars[i] });
        // 微小延迟，让前端有时间渲染
        await new Promise(r => setTimeout(r, 15));
      }
    }

    onEvent('done', { steps: step + 1 });
    return message.content || '';
  }

  onEvent('error', { message: `推理步数超过上限 (${MAX_STEPS})` });
  return '';
}

module.exports = {
  runReactStream,
  runReactStreamFinal,
  MAX_STEPS,
};
