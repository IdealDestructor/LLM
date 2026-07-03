import { useState, useRef, useEffect, useCallback } from 'react'
import AIIcon from './AIIcon'
import './App.css'
// 开发环境连接本地后端，生产构建后连接 CloudRun 后端
const API = import.meta.env.DEV ? 'http://localhost:3001' : 'https://llm-agent-277530-9-1253631440.sh.run.tcloudbase.com'

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
  const [pendingImages, setPendingImages] = useState([])
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768; const [sidebarOpen, setSidebarOpen] = useState(!isMobile)
  const [modelList, setModelList] = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedMaxTokens, setSelectedMaxTokens] = useState(4096)
  const [agentMode, setAgentMode] = useState('chat')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)

  // ─── 用户设置状态 ────────────────────────────────────────
  const [theme, setTheme] = useState('auto')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('你是Francis的AI助手。')
  const [defaultAgentMode, setDefaultAgentMode] = useState('chat')

  useEffect(() => { (async () => { try { const [mr, sr] = await Promise.all([fetch(`${API}/api/models`), fetch(`${API}/api/sessions`)]); const md = await mr.json(), sd = await sr.json(); setModelList(md.models); setSelectedModel(md.defaultModel); setSelectedMaxTokens(md.models.find(m => m.id === md.defaultModel)?.maxTokens || md.defaultMaxTokens); setSessionList(sd.sessions); if (sd.sessions.length > 0) await switchToSession(sd.sessions[0].id); else await createNewSession() } catch (e) { console.error(e) } })() }, [])

  // 加载用户设置
  useEffect(() => { (async () => { try { const r = await fetch(`${API}/api/settings`); const d = await r.json(); if (d.theme) setTheme(d.theme); if (d.systemPrompt) setSystemPrompt(d.systemPrompt); if (d.defaultAgentMode) setDefaultAgentMode(d.defaultAgentMode) } catch (e) { console.error(e) } })() }, [])

  // 应用主题到 <html data-theme="...">
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])

  // 主题循环切换：auto → light → dark → auto
  const cycleTheme = () => { const next = { auto: 'light', light: 'dark', dark: 'auto' }; const nt = next[theme] || 'auto'; setTheme(nt); fetch(`${API}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: nt }) }).catch(() => {}) }

  // 保存设置到后端
  const saveSettings = async () => { try { await fetch(`${API}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemPrompt, defaultAgentMode }) }); setSettingsOpen(false) } catch (e) { console.error(e) } }

  const handleModelChange = (id) => { setSelectedModel(id); const mc = modelList.find(m => m.id === id); if (mc) setSelectedMaxTokens(mc.maxTokens) }

  // ─── 图片上传处理 ────────────────────────────────────────
  const MAX_IMAGES = 4
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || [])
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_IMAGE_SIZE) { alert(`图片 "${file.name}" 超过 10MB 限制`); continue }
      if (pendingImages.length >= MAX_IMAGES) { alert(`最多上传 ${MAX_IMAGES} 张图片`); break }
      const reader = new FileReader()
      reader.onload = () => {
        setPendingImages(prev => [...prev, { dataUrl: reader.result, name: file.name }])
      }
      reader.readAsDataURL(file)
    }
    // 重置 input 以便重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // 粘贴图片
  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || [])
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (!file) continue
        if (pendingImages.length >= MAX_IMAGES) { alert(`最多上传 ${MAX_IMAGES} 张图片`); break }
        const reader = new FileReader()
        reader.onload = () => {
          setPendingImages(prev => [...prev, { dataUrl: reader.result, name: 'pasted.png' }])
        }
        reader.readAsDataURL(file)
      }
    }
  }

  const removePendingImage = (idx) => {
    setPendingImages(prev => prev.filter((_, i) => i !== idx))
  }

  // 从消息内容中提取图片 URL（用于显示）
  function extractMessageImages(msg) {
    if (msg.images) return msg.images
    if (Array.isArray(msg.content)) {
      return msg.content.filter(c => c.type === 'image_url').map(c => c.image_url.url)
    }
    return []
  }

  // 从消息内容中提取纯文本
  function extractMessageText(content) {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.filter(c => c.type === 'text').map(c => c.text).join('')
    }
    return ''
  }

  const createNewSession = async () => { try { const r = await fetch(`${API}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '新对话' }) }); const d = await r.json(); setActiveSessionId(d.sessionId); setMessages([{ role: 'assistant', content: '你好！我是 AI 助手，有什么可以帮助你的吗？', streaming: false, steps: [] }]); await refreshSessionList() } catch (e) { console.error(e) } }
  const switchToSession = async (sid) => { if (sid === activeSessionId) return; try { const r = await fetch(`${API}/api/sessions/${sid}`); const d = await r.json(); setActiveSessionId(sid); const l = d.messages.map(m => ({ ...m, streaming: false, steps: [] })); setMessages(l.length === 0 ? [{ role: 'assistant', content: '你好！我是 AI 助手，有什么可以帮助你的吗？', streaming: false, steps: [] }] : l) } catch (e) { console.error(e) } }
  const deleteSession = async (sid, e) => { e.stopPropagation(); try { await fetch(`${API}/api/sessions/${sid}`, { method: 'DELETE' }); await refreshSessionList(); if (sid === activeSessionId) { const r = await fetch(`${API}/api/sessions`); const d = await r.json(); if (d.sessions.length > 0) await switchToSession(d.sessions[0].id); else await createNewSession() } } catch (e) { console.error(e) } }
  const refreshSessionList = async () => { const r = await fetch(`${API}/api/sessions`); const d = await r.json(); setSessionList(d.sessions) }
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  const adjustH = useCallback(() => { const el = textareaRef.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }, [])
  useEffect(() => { adjustH() }, [input, adjustH])

  const sendMessage = async () => {
    if ((!input.trim() && pendingImages.length === 0) || loading || !activeSessionId) return
    const um = input.trim(); const imgs = [...pendingImages]
    setInput(''); setPendingImages([]); setLoading(true)
    setMessages(p => [...p, { role: 'user', content: um, images: imgs.map(i => i.dataUrl) }])
    setMessages(p => [...p, { role: 'assistant', content: '', streaming: true, steps: [] }])
    const ep = agentMode === 'agent' ? '/api/chat/agent' : '/api/chat/stream'
    try {
      const resp = await fetch(`${API}${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: um, sessionId: activeSessionId, model: selectedModel, maxTokens: selectedMaxTokens, images: imgs.map(i => i.dataUrl) }) })
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
        <div className="sidebar-footer">
          <button className="footer-btn theme-btn" onClick={cycleTheme} title="切换主题">
            {theme === 'auto' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 0 0 20z" fill="currentColor"/></svg>}
            {theme === 'light' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/></svg>}
            {theme === 'dark' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
            <span>{theme === 'auto' ? '跟随系统' : theme === 'light' ? '亮色' : '暗色'}</span>
          </button>
          <button className="footer-btn" onClick={() => setSettingsOpen(true)} title="个人设置">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>设置</span>
          </button>
        </div>
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
                {msg.role === 'user' && extractMessageImages(msg).length > 0 && (
                  <div className="message-images">
                    {extractMessageImages(msg).map((imgUrl, j) => (
                      <img key={j} src={imgUrl} className="message-image" alt={`图片 ${j + 1}`} onClick={() => window.open(imgUrl, '_blank')} />
                    ))}
                  </div>
                )}
                {msg.role === 'assistant' ? renderMarkdown(msg.content) : (extractMessageText(msg.content) || msg.content)}
               {msg.streaming && msg.content && <span className="cursor">▎</span>}
             </div>
           </div>
         ))}
          <div ref={messagesEndRef} />
        </div>
        <div className="input-area">
          {pendingImages.length > 0 && (
            <div className="image-preview-bar">
              {pendingImages.map((img, idx) => (
                <div key={idx} className="image-preview-item">
                  <img src={img.dataUrl} alt={img.name} />
                  <button className="image-preview-remove" onClick={() => removePendingImage(idx)} title="移除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="input-wrapper">
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
            <button className="upload-btn" onClick={() => fileInputRef.current?.click()} title="上传图片" disabled={loading || pendingImages.length >= 4}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 15.91l-1.41 1.41a2 2 0 0 1-2.83 0L12 12l-5.2 5.32a2 2 0 0 1-2.83 0l-1.41-1.41a2 2 0 0 1 0-2.83L9.17 5.5a2 2 0 0 1 2.83 0l1.41 1.41a2 2 0 0 1 0 2.83L12 9.17l3.59-3.59a2 2 0 0 1 2.83 0l1.41 1.41a2 2 0 0 1 0 2.83L15.91 12l3.59 3.59a2 2 0 0 1 0 2.83z" transform="rotate(45 12 12)"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder={agentMode === 'agent' ? 'Agent 模式：输入问题，AI 会自主推理和调用工具…' : '输入消息，Enter 发送，Shift+Enter 换行…'} rows={1} />
            <button className={`send-btn${(input.trim() || pendingImages.length > 0) && !loading ? ' active' : ''}`} onClick={sendMessage} disabled={loading || (!input.trim() && pendingImages.length === 0)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
          </div>
        </div>
      </main>
      {settingsOpen && (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h2>个人设置</h2>
              <button className="settings-close" onClick={() => setSettingsOpen(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="settings-body">
              <label className="settings-label">预设提示词（System Prompt）</label>
              <textarea className="settings-textarea" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={4} placeholder="定义 AI 助手的人设和行为…" />
              <label className="settings-label">默认模式</label>
              <div className="settings-mode-select">
                <button className={`mode-btn${defaultAgentMode === 'chat' ? ' active' : ''}`} onClick={() => setDefaultAgentMode('chat')}>对话</button>
                <button className={`mode-btn${defaultAgentMode === 'agent' ? ' active' : ''}`} onClick={() => setDefaultAgentMode('agent')}>Agent</button>
              </div>
            </div>
            <div className="settings-footer">
              <button className="settings-save" onClick={saveSettings}>保存</button>
            </div>
          </div>
        </div>
      )}
   </div>
  )
}
export default App
