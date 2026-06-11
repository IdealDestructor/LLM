import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

const API = 'http://localhost:3001'

// ─── 简易 Markdown 渲染 ──────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return null
  const blocks = []
  let i = 0
  const lines = text.split('\n')
  while (i < lines.length) {
    if (lines[i].startsWith('```')) {
      const lang = lines[i].slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++
      blocks.push(
        <pre key={blocks.length} className="code-block">
          {lang && <span className="code-lang">{lang}</span>}
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      continue
    }
    blocks.push(<p key={blocks.length}>{renderInline(lines[i])}</p>)
    i++
  }
  return blocks
}

function renderInline(text) {
  const parts = []
  let remaining = text
  let key = 0
  while (remaining) {
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/s)
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/s)
    const italicMatch = remaining.match(/^(.*?)\*([^*]+)\*(.*)$/s)
    const matches = [
      { m: codeMatch, t: 'code' },
      { m: boldMatch, t: 'bold' },
      { m: italicMatch, t: 'italic' },
    ].filter(x => x.m)
    if (matches.length === 0) { parts.push(remaining); break }
    let match = matches.reduce((a, b) => a.m[1].length <= b.m[1].length ? a : b)
    let type = match.t; match = match.m
    if (match[1]) parts.push(match[1])
    if (type === 'code') parts.push(<code key={key++} className="inline-code">{match[2]}</code>)
    else if (type === 'bold') parts.push(<strong key={key++}>{match[2]}</strong>)
    else parts.push(<em key={key++}>{match[2]}</em>)
    remaining = match[3]
  }
  return parts
}

// ─── 主组件 ──────────────────────────────────────────────────
//
// 会话隔离的关键前端实现：
//
// 1. 状态拆分：
//    - sessionList: 所有会话摘要（侧边栏展示）
//    - activeSessionId: 当前激活的会话 ID
//    - messages: 当前会话的消息列表（切换会话时从服务端加载）
//
// 2. 会话生命周期：
//    - 新建 → POST /api/sessions → 拿到 sessionId → 切换为当前
//    - 切换 → GET /api/sessions/:id → 加载该会话消息 → 替换 messages
//    - 删除 → DELETE /api/sessions/:id → 从列表移除 → 若是当前会话则切换到下一个
//    - 发送 → 请求体带 { message, sessionId } → 后端按 sessionId 隔离历史
//
// 3. 每次发送消息后，用会话首条用户消息自动更新会话标题
//
function App() {
  const [sessionList, setSessionList] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  // ─── 初始化：加载会话列表，若无会话则自动创建 ──────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/sessions`)
        const data = await res.json()
        setSessionList(data.sessions)

        if (data.sessions.length > 0) {
          // 有会话，加载第一个
          await switchToSession(data.sessions[0].id)
        } else {
          // 无会话，自动创建
          await createNewSession()
        }
      } catch (e) {
        console.error('初始化失败:', e)
      }
    })()
  }, [])

  // ─── 创建新会话 ──────────────────────────────────────────
  const createNewSession = async () => {
    try {
      const res = await fetch(`${API}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新对话' })
      })
      const data = await res.json()
      setActiveSessionId(data.sessionId)
      setMessages([
        { role: 'assistant', content: '你好！我是 AI 助手，有什么可以帮助你的吗？', streaming: false }
      ])
      // 刷新列表
      await refreshSessionList()
    } catch (e) {
      console.error('创建会话失败:', e)
    }
  }

  // ─── 切换到指定会话 ──────────────────────────────────────
  // 从服务端加载该会话的完整消息历史，替换当前 messages
  const switchToSession = async (sessionId) => {
    if (sessionId === activeSessionId) return
    try {
      const res = await fetch(`${API}/api/sessions/${sessionId}`)
      const data = await res.json()
      setActiveSessionId(sessionId)
      // 服务端返回的 messages 不含 system prompt，直接使用
      const loaded = data.messages.map(m => ({ ...m, streaming: false }))
      if (loaded.length === 0) {
        setMessages([
          { role: 'assistant', content: '你好！我是 AI 助手，有什么可以帮助你的吗？', streaming: false }
        ])
      } else {
        setMessages(loaded)
      }
    } catch (e) {
      console.error('切换会话失败:', e)
    }
  }

  // ─── 删除会话 ────────────────────────────────────────────
  const deleteSession = async (sessionId, e) => {
    e.stopPropagation() // 阻止触发切换
    try {
      await fetch(`${API}/api/sessions/${sessionId}`, { method: 'DELETE' })
      await refreshSessionList()

      // 若删除的是当前会话，切换到剩余的第一个或新建
      if (sessionId === activeSessionId) {
        const res = await fetch(`${API}/api/sessions`)
        const data = await res.json()
        if (data.sessions.length > 0) {
          await switchToSession(data.sessions[0].id)
        } else {
          await createNewSession()
        }
      }
    } catch (e) {
      console.error('删除会话失败:', e)
    }
  }

  // ─── 刷新会话列表 ────────────────────────────────────────
  const refreshSessionList = async () => {
    const res = await fetch(`${API}/api/sessions`)
    const data = await res.json()
    setSessionList(data.sessions)
  }

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
  // 关键变化：请求体新增 sessionId 字段
  const sendMessage = async () => {
    if (!input.trim() || loading || !activeSessionId) return

    const userMessage = input.trim()
    setInput('')
    setLoading(true)

    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }])

    try {
      const response = await fetch(`${API}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, sessionId: activeSessionId })
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
          if (data === '[DONE]') { streamDone = true; break }

          try {
            const parsed = JSON.parse(data)
            if (parsed.error) {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: `❌ ${parsed.error}`, streaming: false }
                return updated
              })
              streamDone = true; break
            }
            if (parsed.content) {
              fullContent += parsed.content
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: fullContent, streaming: true }
                return updated
              })
            }
          } catch { /* skip */ }
        }
      }

      // 流式结束
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last.role === 'assistant' && last.streaming) {
          updated[updated.length - 1] = { ...last, streaming: false }
        }
        return updated
      })

      // 首条消息后自动更新会话标题
      const isFirstUserMsg = messages.filter(m => m.role === 'user').length === 0
      if (isFirstUserMsg && userMessage.length > 0) {
        const title = userMessage.slice(0, 20) + (userMessage.length > 20 ? '…' : '')
        await fetch(`${API}/api/sessions/${activeSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title })
        })
        refreshSessionList()
      }

    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: '抱歉，请求失败了，请重试。', streaming: false }
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

  // 格式化时间
  const formatTime = (ts) => {
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="chat-app">
      {/* ── 侧边栏 ── */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-header">
          <button className="new-chat-btn" onClick={createNewSession}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            新对话
          </button>
        </div>
        <div className="session-list">
          {sessionList.map(s => (
            <div
              key={s.id}
              className={`session-item${s.id === activeSessionId ? ' active' : ''}`}
              onClick={() => switchToSession(s.id)}
            >
              <div className="session-info">
                <span className="session-title">{s.title}</span>
                <span className="session-time">{formatTime(s.createdAt)}</span>
              </div>
              <button className="session-delete" onClick={(e) => deleteSession(s.id, e)} title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── 主区域 ── */}
      <main className="chat-main">
        {/* 顶栏 */}
        <header className="chat-header">
          <div className="header-left">
            <button className="toggle-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <div className="logo-icon">✦</div>
            <h1>AI Chat</h1>
          </div>
          <div className="header-right">
            <span className="stream-badge">SSE</span>
          </div>
        </header>

        {/* 消息列表 */}
        <div className="messages">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}${msg.streaming ? ' streaming' : ''}`}>
              <div className="message-avatar">
                {msg.role === 'user' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z"/></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                )}
              </div>
              <div className="message-body">
                {msg.role === 'assistant' && msg.streaming && !msg.content && (
                  <div className="thinking-dots"><span></span><span></span><span></span></div>
                )}
                {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                {msg.streaming && msg.content && <span className="cursor">▎</span>}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区 */}
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
      </main>
    </div>
  )
}

export default App
