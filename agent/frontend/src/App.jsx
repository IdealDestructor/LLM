import { useState, useRef, useEffect, useCallback } from 'react'
import AIIcon from './AIIcon'import './App.css'
const API = 'http://localhost:3001'

function renderMarkdown(text) {
  if (!text) return null
  const blocks = []; let i = 0; const lines = text.split('\n')
  while (i < lines.length) {
    if (lines[i].startsWith('```')) { const lang = lines[i].slice(3).trim(); const cl = []; i++; while (i < lines.length && !lines[i].startsWith('```')) { cl.push(lines[i]); i++ } i++; blocks.push(<pre key={blocks.length} className="code-block">{lang && <span className="code-lang">{lang}</span>}<code>{cl.join('\n')}</code></pre>); continue }
    blocks.push(<p key={blocks.length}>{renderInline(lines[i])}</p>); i++
  }
  return blocks
}
function renderInline(text) {
  const parts = []; let r = text; let k = 0
  while (r) { const cm = r.match(/^(.*?)`([^`]+)`(.*)$/s), bm = r.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/s), im = r.match(/^(.*?)\*([^*]+)\*(.*)$/s); const ms = [{ m: cm, t: 'code' }, { m: bm, t: 'bold' }, { m: im, t: 'italic' }].filter(x => x.m); if (!ms.length) { parts.push(r); break } let m = ms.reduce((a, b) => a.m[1].length <= b.m[1].length ? a : b), t = m.t; m = m.m; if (m[1]) parts.push(m[1]); if (t === 'code') parts.push(<code key={k++} className="inline-code">{m[2]}</code>); else if (t === 'bold') parts.push(<strong key={k++}>{m[2]}</strong>); else parts.push(<em key={k++}>{m[2]}</em>); r = m[3] }
  return parts
}

function renderSteps(steps) {
  if (!steps || !steps.length) return null
  return (<div className="agent-steps">{steps.map((s, i) => {
    if (s.type === 'thought') return <div key={i} className="step step-thought"><span className="step-icon">💭</span><span className="step-label">思考</span><span className="step-text">{s.content}</span></div>
    if (s.type === 'action') return <div key={i} className="step step-action"><span className="step-icon">🔧</span><span className="step-label">调用 {s.name}</span><span className="step-text">{JSON.stringify(s.arguments)}</span></div>
    if (s.type === 'observation') return <div key={i} className="step step-observation"><span className="step-icon">👁</span><span className="step-label">结果</span><span className="step-text">{s.result}</span></div>
    return null
  })}</div>)
}

function App() {
  const [sessionList, setSessionList] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768; const [sidebarOpen, setSidebarOpen] = useState(!isMobile)
  const [modelList, setModelList] = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedMaxTokens, setSelectedMaxTokens] = useState(4096)
  const [agentMode, setAgentMode] = useState('chat')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => { (async () => { try { const [mr, sr] = await Promise.all([fetch(`${API}/api/models`), fetch(`${API}/api/sessions`)]); const md = await mr.json(), sd = await sr.json(); setModelList(md.models); setSelectedModel(md.defaultModel); setSelectedMaxTokens(md.models.find(m => m.id === md.defaultModel)?.maxTokens || md.defaultMaxTokens); setSessionList(sd.sessions); if (sd.sessions.length > 0) await switchToSession(sd.sessions[0].id); else await createNewSession() } catch (e) { console.error(e) } })() }, [])
  const handleModelChange = (id) => { setSelectedModel(id); const mc = modelList.find(m => m.id === id); if (mc) setSelectedMaxTokens(mc.maxTokens) }
  const createNewSession = async () => { try { const r = await fetch(`${API}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '新对话' }) }); const d = await r.json(); setActiveSessionId(d.sessionId); setMessages([{ role: 'assistant', content: '你好！我是 AI 助手，有什么可以帮助你的吗？', streaming: false, steps: [] }]); await refreshSessionList() } catch (e) { console.error(e) } }
  const switchToSession = async (sid) => { if (sid === activeSessionId) return; try { const r = await fetch(`${API}/api/sessions/${sid}`); const d = await r.json(); setActiveSessionId(sid); const l = d.messages.map(m => ({ ...m, streaming: false, steps: [] })); setMessages(l.length === 0 ? [{ role: 'assistant', content: '你好！我是 AI 助手，有什么可以帮助你的吗？', streaming: false, steps: [] }] : l) } catch (e) { console.error(e) } }
  const deleteSession = async (sid, e) => { e.stopPropagation(); try { await fetch(`${API}/api/sessions/${sid}`, { method: 'DELETE' }); await refreshSessionList(); if (sid === activeSessionId) { const r = await fetch(`${API}/api/sessions`); const d = await r.json(); if (d.sessions.length > 0) await switchToSession(d.sessions[0].id); else await createNewSession() } } catch (e) { console.error(e) } }
  const refreshSessionList = async () => { const r = await fetch(`${API}/api/sessions`); const d = await r.json(); setSessionList(d.sessions) }
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  const adjustH = useCallback(() => { const el = textareaRef.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }, [])
  useEffect(() => { adjustH() }, [input, adjustH])

  const sendMessage = async () => {
    if (!input.trim() || loading || !activeSessionId) return
    const um = input.trim(); setInput(''); setLoading(true)
    setMessages(p => [...p, { role: 'user', content: um }])
    setMessages(p => [...p, { role: 'assistant', content: '', streaming: true, steps: [] }])
    const ep = agentMode === 'agent' ? '/api/chat/agent' : '/api/chat/stream'
    try {
      const resp = await fetch(`${API}${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: um, sessionId: activeSessionId, model: selectedModel, maxTokens: selectedMaxTokens }) })
      if (!resp.body) throw new Error('No ReadableStream')
      const reader = resp.body.getReader(), decoder = new TextDecoder('utf-8')
      let buf = '', fc = '', done = false, aSteps = []
      while (!done) {
        const { done: d, value: v } = await reader.read(); if (d) break
        buf += decoder.decode(v, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue; const data = line.slice(6)
          if (data === '[DONE]') { done = true; break }
          try {
            const p = JSON.parse(data)
            if (p.type === 'thought') { aSteps.push({ type: 'thought', step: p.step, content: p.content }); setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], steps: [...aSteps] }; return u }); continue }
            if (p.type === 'action') { aSteps.push({ type: 'action', step: p.step, name: p.name, arguments: p.arguments }); setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], steps: [...aSteps] }; return u }); continue }
            if (p.type === 'observation') { aSteps.push({ type: 'observation', step: p.step, result: p.result }); setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], steps: [...aSteps] }; return u }); continue }
            if (p.type === 'error') { setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: `❌ ${p.message}`, streaming: false, steps: aSteps }; return u }); done = true; break }
            if (p.error) { setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: `❌ ${p.error}`, streaming: false, steps: [] }; return u }); done = true; break }
            if (p.content) { fc += p.content; setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], content: fc, streaming: true }; return u }) }
          } catch {}
        }
      }
      setMessages(prev => { const u = [...prev]; const l = u[u.length - 1]; if (l.role === 'assistant' && l.streaming) u[u.length - 1] = { ...l, streaming: false }; return u })
      const first = messages.filter(m => m.role === 'user').length === 0
      if (first && um.length > 0) { const t = um.slice(0, 20) + (um.length > 20 ? '…' : ''); await fetch(`${API}/api/sessions/${activeSessionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) }); refreshSessionList() }
    } catch { setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: '抱歉，请求失败了，请重试。', streaming: false, steps: [] }; return u }) }
    setLoading(false)
  }
  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }
  const fmt = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
  const mn = modelList.find(m => m.id === selectedModel)?.name || selectedModel

  return (
    <div className="chat-app">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-header"><button className="new-chat-btn" onClick={createNewSession}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新对话</button></div>
        <div className="session-list">{sessionList.map(s => (<div key={s.id} className={`session-item${s.id === activeSessionId ? ' active' : ''}`} onClick={() => { switchToSession(s.id); if (isMobile) setSidebarOpen(false); }}><div className="session-info"><span className="session-title">{s.title}</span><span className="session-time">{fmt(s.createdAt)}</span></div><button className="session-delete" onClick={(e) => deleteSession(s.id, e)} title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>))}</div>
      </aside>
      <main className="chat-main">
        <header className="chat-header">
          <div className="header-left"><button className="toggle-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button><div className="logo-icon"><AIIcon size={16} /></div><h1>AI Chat</h1></div>
          <div className="header-right">
            <div className="mode-toggle"><button className={`mode-btn${agentMode === 'chat' ? ' active' : ''}`} onClick={() => setAgentMode('chat')}>对话</button><button className={`mode-btn${agentMode === 'agent' ? ' active' : ''}`} onClick={() => setAgentMode('agent')}>Agent</button></div>
            <div className="model-selector"><select value={selectedModel} onChange={e => handleModelChange(e.target.value)} className="model-select" title="选择模型">{modelList.map(m => (<option key={m.id} value={m.id}>{m.name}</option>))}</select><span className="model-badge">{mn}</span></div>
            <span className="stream-badge">SSE</span>
          </div>
        </header>
        <div className="messages">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}${msg.streaming ? ' streaming' : ''}`}>
              <div className="message-avatar">{msg.role === 'user' ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z"/></svg> : <AIIcon size={20} streaming={msg.streaming} />}</div>
              <div className="message-body">
                {msg.role === 'assistant' && msg.streaming && !msg.content && !msg.steps?.length && <div className="thinking-dots"><span></span><span></span><span></span></div>}
                {renderSteps(msg.steps)}
                {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                {msg.streaming && msg.content && <span className="cursor">▎</span>}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <div className="input-area"><div className="input-wrapper"><textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={agentMode === 'agent' ? 'Agent 模式：输入问题，AI 会自主推理和调用工具…' : '输入消息，Enter 发送，Shift+Enter 换行…'} rows={1} /><button className={`send-btn${input.trim() && !loading ? ' active' : ''}`} onClick={sendMessage} disabled={loading || !input.trim()}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div></div>
      </main>
    </div>
  )
}
export default App
