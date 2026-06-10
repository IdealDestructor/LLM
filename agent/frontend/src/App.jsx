import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

// ─── 简易 Markdown 渲染 ──────────────────────────────────────
// 支持：**粗体**、*斜体*、`行内代码`、```代码块```、换行
function renderMarkdown(text) {
  if (!text) return null

  const blocks = []
  let i = 0
  const lines = text.split('\n')

  while (i < lines.length) {
    // 代码块 ```lang ... ```
    if (lines[i].startsWith('```')) {
      const lang = lines[i].slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      blocks.push(
        <pre key={blocks.length} className="code-block">
          {lang && <span className="code-lang">{lang}</span>}
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      continue
    }

    // 普通文本行
    blocks.push(<p key={blocks.length}>{renderInline(lines[i])}</p>)
    i++
  }

  return blocks
}

function renderInline(text) {
  // 按顺序处理：行内代码 → 粗体 → 斜体
  const parts = []
  let remaining = text
  let key = 0

  while (remaining) {
    // 行内代码
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/s)
    // 粗体
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/s)
    // 斜体
    const italicMatch = remaining.match(/^(.*?)\*([^*]+)\*(.*)$/s)

    // 优先级：行内代码 > 粗体 > 斜体
    let match = null
    let type = null
    const matches = [
      { m: codeMatch, t: 'code' },
      { m: boldMatch, t: 'bold' },
      { m: italicMatch, t: 'italic' },
    ].filter(x => x.m)

    if (matches.length === 0) {
      parts.push(remaining)
      break
    }

    // 选最早出现的匹配
    match = matches.reduce((a, b) => a.m[1].length <= b.m[1].length ? a : b)
    type = match.t
    match = match.m

    if (match[1]) parts.push(match[1])

    if (type === 'code') {
      parts.push(<code key={key++} className="inline-code">{match[2]}</code>)
    } else if (type === 'bold') {
      parts.push(<strong key={key++}>{match[2]}</strong>)
    } else {
      parts.push(<em key={key++}>{match[2]}</em>)
    }

    remaining = match[3]
  }

  return parts
}

// ─── 主组件 ──────────────────────────────────────────────────
function App() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '你好！我是 AI 助手，有什么可以帮助你的吗？', streaming: false }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // textarea 自动调高
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [])

  useEffect(() => {
    adjustTextareaHeight()
  }, [input, adjustTextareaHeight])

  // ─── 流式发送消息 ──────────────────────────────────────────
  const sendMessage = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setLoading(true)

    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }])

    try {
      const response = await fetch('http://localhost:3001/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage })
      })

      if (!response.body) throw new Error('浏览器不支持 ReadableStream')

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')

      let buffer = ''
      let fullContent = ''
      let streamDone = false

      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)

          if (data === '[DONE]') {
            streamDone = true
            break
          }

          try {
            const parsed = JSON.parse(data)

            if (parsed.error) {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: `❌ ${parsed.error}`,
                  streaming: false
                }
                return updated
              })
              streamDone = true
              break
            }

            if (parsed.content) {
              fullContent += parsed.content
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: fullContent,
                  streaming: true
                }
                return updated
              })
            }
          } catch {
            // skip
          }
        }
      }

      // 流式结束，移除 streaming 标记
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last.role === 'assistant' && last.streaming) {
          updated[updated.length - 1] = { ...last, streaming: false }
        }
        return updated
      })

    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: '抱歉，请求失败了，请重试。',
          streaming: false
        }
        return updated
      })
    }

    setLoading(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // 清空对话
  const clearChat = () => {
    setMessages([
      { role: 'assistant', content: '你好！我是 AI 助手，有什么可以帮助你的吗？', streaming: false }
    ])
  }

  return (
    <div className="chat-app">
      {/* ── 顶栏 ── */}
      <header className="chat-header">
        <div className="header-left">
          <div className="logo-icon">✦</div>
          <h1>AI Chat</h1>
        </div>
        <div className="header-right">
          <span className="stream-badge">SSE</span>
          <button className="clear-btn" onClick={clearChat} title="清空对话">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
            </svg>
          </button>
        </div>
      </header>

      {/* ── 消息列表 ── */}
      <div className="messages">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`message ${msg.role}${msg.streaming ? ' streaming' : ''}`}
          >
            <div className="message-avatar">
              {msg.role === 'user' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z"/></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
              )}
            </div>
            <div className="message-body">
              {/* 思考中动画：流式输出且内容为空时显示 */}
              {msg.role === 'assistant' && msg.streaming && !msg.content && (
                <div className="thinking-dots">
                  <span></span><span></span><span></span>
                </div>
              )}
              {/* 消息内容：AI 用 Markdown 渲染，用户纯文本 */}
              {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
              {/* 流式光标 */}
              {msg.streaming && msg.content && <span className="cursor">▎</span>}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* ── 输入区 ── */}
      <div className="input-area">
        <div className="input-wrapper">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行…"
            rows={1}
          />
          <button
            className={`send-btn${input.trim() && !loading ? ' active' : ''}`}
            onClick={sendMessage}
            disabled={loading || !input.trim()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
