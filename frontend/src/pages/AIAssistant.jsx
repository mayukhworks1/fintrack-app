import { useState, useRef, useEffect } from 'react'
import {
  Send, Bot, User, Sparkles, Trash2, Database,
  AlertCircle, ChevronDown, Copy, Check, Square, Download, ShieldCheck,
} from 'lucide-react'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'
import clsx from 'clsx'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, BarChart, Bar, CartesianGrid, XAxis, YAxis } from 'recharts'

/* ───────── Inline text formatting (bold, strip stray markdown) ───────── */
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function formatInline(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-1);font-weight:600">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/[`#*_]/g, '')
    .trim()
}

/* ───────── Renders AI text with numbered lists, bullet lists, sections, paragraphs ───────── */
function AiText({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let i = 0

  const isBullet = (s) => /^[-•·]\s/.test(s)
  const isNumbered = (s) => /^\d+\.\s/.test(s)

  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) { i++; continue }

    // Numbered list
    if (isNumbered(line)) {
      const items = []
      while (i < lines.length && isNumbered(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ''))
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} className="space-y-1.5 my-2 ml-0.5">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 sm:gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>
              <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                {j + 1}
              </span>
              <span dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
            </li>
          ))}
        </ol>
      )
      continue
    }

    // Bullet list
    if (isBullet(line)) {
      const items = []
      while (i < lines.length && isBullet(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-•·]\s/, ''))
        i++
      }
      elements.push(
        <ul key={`ul-${i}`} className="space-y-1.5 my-2 ml-0.5">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 sm:gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>
              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2" style={{ background: 'var(--accent)' }} />
              <span dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
            </li>
          ))}
        </ul>
      )
      continue
    }

    // Section label
    if (/^[A-Z][A-Za-z\s]{1,30}:$/.test(line) || /^[A-Z][A-Za-z\s]{1,30}:\s/.test(line)) {
      const colonIdx = line.indexOf(':')
      const label = line.slice(0, colonIdx)
      const rest = line.slice(colonIdx + 1).trim()
      elements.push(
        <div key={i} className="mt-3 mb-1">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
            {label}
          </span>
          {rest && (
            <span className="text-sm ml-2 leading-relaxed" style={{ color: 'var(--text-1)' }}
              dangerouslySetInnerHTML={{ __html: formatInline(rest) }} />
          )}
        </div>
      )
      i++
      continue
    }

    elements.push(
      <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}
        dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
    )
    i++
  }

  return <div className="space-y-1.5">{elements}</div>
}

const DASHBOARD_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#f97316', '#94a3b8', '#ec4899']

function downloadBlob(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function dashboardToCsv(dashboard) {
  const rows = dashboard?.table?.rows || []
  const columns = dashboard?.table?.columns || []
  const csvRows = [columns.join(',')]
  for (const row of rows) {
    csvRows.push((row || []).map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
  }
  return csvRows.join('\n')
}

function VerificationBadge({ verification }) {
  if (!verification) return null
  const confidence = String(verification.confidence || 'medium')
  const tone = confidence === 'high'
    ? { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.22)', text: 'var(--fin-positive)' }
    : confidence === 'low'
      ? { bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.2)', text: 'var(--fin-negative)' }
      : { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.22)', text: 'var(--fin-warning)' }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.text }}>
      <ShieldCheck size={10} />
      {verification.corrected ? 'Verified + corrected' : `Verified ${confidence}`}
    </span>
  )
}

function DashboardActions({ dashboard }) {
  if (!dashboard) return null
  const base = dashboard.downloadName || 'dashboard'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CopyButton text={dashboard.copyText || dashboard.title || 'Dashboard'} />
      <button
        onClick={() => downloadBlob(`${base}.txt`, dashboard.copyText || dashboard.title || 'Dashboard')}
        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-all hover:bg-white/5"
        style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
      >
        <Download size={10} />
        TXT
      </button>
      {Array.isArray(dashboard?.table?.rows) && dashboard.table.rows.length > 0 && (
        <button
          onClick={() => downloadBlob(`${base}.csv`, dashboardToCsv(dashboard), 'text/csv;charset=utf-8')}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-all hover:bg-white/5"
          style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
        >
          <Download size={10} />
          CSV
        </button>
      )}
      <button
        onClick={() => downloadBlob(`${base}.json`, JSON.stringify(dashboard, null, 2), 'application/json;charset=utf-8')}
        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-all hover:bg-white/5"
        style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
      >
        <Download size={10} />
        JSON
      </button>
    </div>
  )
}

function DashboardCard({ dashboard }) {
  const data = Array.isArray(dashboard?.series) ? dashboard.series : []
  const total = Number(dashboard?.total || data.reduce((sum, item) => sum + Number(item.value || 0), 0))
  if (!data.length) return null
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
          {dashboard?.eyebrow || 'Dashboard'}
        </p>
        <h3 className="text-lg font-bold mt-1" style={{ color: 'var(--text-1)' }}>
          {dashboard?.title || 'Portfolio Distribution'}
        </h3>
        {dashboard?.subtitle && (
          <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>{dashboard.subtitle}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,340px)_1fr] gap-4 items-start">
        <div className="rounded-2xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              {dashboard?.chartType === 'bar' ? (
                <BarChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.14)" vertical={false} />
                  <XAxis dataKey="name" hide />
                  <YAxis allowDecimals={false} stroke="var(--text-3)" fontSize={11} />
                  <RechartsTooltip formatter={(value) => [`${value}`, 'Value']} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {data.map((entry, index) => (
                      <Cell key={entry.name || index} fill={entry.color || DASHBOARD_COLORS[index % DASHBOARD_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>
                    {data.map((entry, index) => (
                      <Cell key={entry.name || index} fill={entry.color || DASHBOARD_COLORS[index % DASHBOARD_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value) => [`${value}`, 'Projects']} />
                  <Legend />
                </PieChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(dashboard?.kpis?.length ? dashboard.kpis : [{ label: 'Total', value: total }]).map((kpi, index) => (
              <div key={`${kpi.label}-${index}`} className="rounded-2xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{kpi.label}</p>
                <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{kpi.value}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {data.map((item, index) => (
              <div key={item.name || index} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color || DASHBOARD_COLORS[index % DASHBOARD_COLORS.length] }} />
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>{item.name}</span>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{item.value}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{item.percent}%</p>
                </div>
              </div>
            ))}
          </div>
          {dashboard?.insight && (
            <div className="rounded-2xl p-3" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)' }}>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>{dashboard.insight}</p>
            </div>
          )}
          <DashboardActions dashboard={dashboard} />
        </div>
      </div>
    </div>
  )
}

/* ───────── Copy-to-clipboard button ───────── */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <button
      onClick={handle}
      aria-label={copied ? 'Copied' : 'Copy message'}
      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-all hover:bg-white/5"
      style={{ color: copied ? 'var(--fin-positive)' : 'var(--text-3)' }}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

const SUGGESTIONS = [
  'Which project has the highest profit %?',
  'Summarize the overall portfolio health',
  'Which client has the most projects?',
  'What does the status board say is blocked right now?',
  'Which projects are currently On Hold or Input Pending?',
  'Are any projects below target revenue?',
  'Total billing for Birla Open Minds?',
  'Which projects are at risk?',
  'Compare all clients by profitability',
  'What is the average project duration?',
  'Which projects have met their targets?',
  'Show me the worst performing project',
]

const RESPONSE_MODES = [
  { id: 'brief', label: 'Brief', instruction: 'Respond briefly in 4-6 concise bullets with only the most important decisions or findings.' },
  { id: 'detailed', label: 'Detailed', instruction: 'Respond with clear sections, context, supporting detail, and next-step recommendations.' },
  { id: 'board', label: 'Board report', instruction: 'Respond like an executive board note with headings, business summary, pressure points, and action items.' },
]

const QUALITY_PROFILES = [
  { id: 'fast', label: 'Fast', temperature: 0.45, note: 'Lower latency' },
  { id: 'balanced', label: 'Balanced', temperature: 0.32, note: 'Best default' },
  { id: 'precise', label: 'Precise', temperature: 0.18, note: 'More grounded' },
]

const TASK_CHIPS = [
  'Show me an overdue collections dashboard',
  'Summarize at-risk projects',
  'Prepare a weekly founder report',
  'Make a pie chart dashboard of all project statuses',
]

function Message({ msg }) {
  const isUser = msg.role === 'user'
  const copyText = msg.dashboard?.copyText || msg.content || ''
  return (
    <div
      className={clsx('flex gap-2 sm:gap-3 mb-4 sm:mb-5 animate-slide-up', isUser && 'flex-row-reverse')}
      role="article"
      aria-label={isUser ? 'Your message' : 'AI response'}
    >
      <div
        className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={isUser
          ? { background: 'var(--accent-btn)', boxShadow: '0 0 12px rgba(37,99,235,0.25)' }
          : { background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }
        }
        aria-hidden="true"
      >
        {isUser
          ? <User size={12} className="text-white" />
          : <Bot size={12} style={{ color: 'var(--accent)' }} />
        }
      </div>

      <div className={clsx('max-w-[88%] sm:max-w-[82%] min-w-0')}>
        <div
          className={clsx('rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm leading-relaxed break-words',
            isUser ? 'rounded-tr-sm' : 'rounded-tl-sm')}
          style={isUser
            ? { background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--text-1)' }
            : { background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-1)' }
          }
        >
          {msg.error
            ? <span className="flex items-start gap-2" style={{ color: 'var(--fin-negative)' }}>
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                <span>{msg.content}</span>
              </span>
            : isUser
              ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              : msg.dashboard
                ? <DashboardCard dashboard={msg.dashboard} />
                : <AiText text={msg.content} />
          }
        </div>

        {/* Assistant footer: model + copy */}
        {!isUser && !msg.error && msg.content && (
          <div className="flex items-center gap-2 mt-1 px-1">
            {msg.model && (
              <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                <Sparkles size={9} style={{ color: 'var(--accent)' }} />
                {msg.model}
              </span>
            )}
            <VerificationBadge verification={msg.verification} />
            {!msg.dashboard && <CopyButton text={copyText} />}
          </div>
        )}
      </div>
    </div>
  )
}

const WELCOME = {
  role: 'assistant',
  content: "Hi! I'm FinTrackAI. I have live access to your project portfolio, invoice tracker, and current status board.\n\nAsk me about revenue, collections, risk, blockers, client delays, or what is happening right now across projects.",
}

const STORAGE_KEY = 'fintrack-ai-history'
const SESSION_KEY = 'fintrack-ai-session'

function loadHistory() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {}
  return [WELCOME]
}

export default function AIAssistant() {
  const toast = useToast()
  const [history, setHistory] = useState(loadHistory)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [responseMode, setResponseMode] = useState('brief')
  const [qualityProfile, setQualityProfile] = useState('balanced')
  const [sessionId, setSessionId] = useState(() => {
    try { return localStorage.getItem(SESSION_KEY) || '' } catch { return '' }
  })
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-40))) } catch {}
  }, [history])

  useEffect(() => {
    try {
      if (sessionId) localStorage.setItem(SESSION_KEY, sessionId)
      else localStorage.removeItem(SESSION_KEY)
    } catch {}
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, loading])

  // Cleanup any in-flight request on unmount
  useEffect(() => () => abortRef.current?.abort(), [])

  const send = async (text) => {
    const msg = (text || input).trim()
    if (!msg || loading) return
    const modeMeta = RESPONSE_MODES.find(mode => mode.id === responseMode) || RESPONSE_MODES[0]
    const qualityMeta = QUALITY_PROFILES.find(profile => profile.id === qualityProfile) || QUALITY_PROFILES[1]
    setInput('')
    const priorHistory = history
    const assistantIndex = priorHistory.length + 1
    setHistory(prev => [...prev, { role: 'user', content: msg }, { role: 'assistant', content: 'Analyzing…', model: null, streaming: true }])
    setLoading(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await api.ai.chatStream(msg, sessionId ? [] : priorHistory, {
        signal: ctrl.signal,
        sessionId,
        responseMode: modeMeta.id,
        temperature: qualityMeta.temperature,
      })
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalModel = null
      let finalReply = ''
      let finalDashboard = null
      let finalVerification = null

      if (!reader) throw new Error('Streaming is unavailable')

      const applyAssistantState = (updater) => {
        setHistory(prev => prev.map((entry, index) => (
          index === assistantIndex ? updater(entry) : entry
        )))
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() || ''

        for (const frame of frames) {
          const line = frame
            .split('\n')
            .find(part => part.startsWith('data: '))
          if (!line) continue

          let event
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          if (event.type === 'session' && event.session_id) {
            setSessionId(event.session_id)
            continue
          }

          if (event.type === 'delta') {
            finalReply += event.delta || ''
            applyAssistantState(entry => ({ ...entry, content: finalReply, dashboard: null, streaming: true }))
            continue
          }

          if (event.type === 'dashboard' && event.dashboard) {
            finalDashboard = event.dashboard
            finalReply = event.dashboard.copyText || event.dashboard.insight || event.dashboard.title || 'Dashboard ready'
            finalModel = event.model_short || 'deterministic-dashboard'
            finalVerification = event.verification || null
            applyAssistantState(entry => ({
              ...entry,
              content: finalReply,
              dashboard: finalDashboard,
              model: finalModel,
              verification: finalVerification,
              streaming: true,
            }))
            continue
          }

          if (event.type === 'done') {
            finalReply = event.content || finalReply
            finalModel = event.model_short || null
            finalVerification = event.verification || finalVerification
            applyAssistantState(entry => ({
              ...entry,
              content: finalReply,
              dashboard: finalDashboard,
              model: finalModel,
              verification: finalVerification,
              streaming: false,
            }))
            continue
          }

          if (event.type === 'error') {
            throw new Error(event.error || 'Streaming failed')
          }
        }
      }

      if (!finalReply.trim()) {
        throw new Error('AI returned an empty response')
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        setHistory(prev => prev.map((entry, index) => (
          index === assistantIndex
            ? { ...entry, content: entry.content || 'Generation stopped.', streaming: false }
            : entry
        )))
      } else {
        const raw = e.message || ''
        const errMsg = /OPENROUTER_API_KEY|Invalid OPENROUTER_API_KEY|quota exceeded/i.test(raw)
          ? raw
          : raw
            ? `AI error: ${raw}`
            : 'AI error: Something went wrong while generating the response.'
        setHistory(prev => prev.map((entry, index) => (
          index === assistantIndex
            ? { ...entry, content: errMsg, error: true, streaming: false }
            : entry
        )))
        toast(errMsg, 'error', 6000)
      }
    } finally {
      setLoading(false)
      abortRef.current = null
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const stopGeneration = () => {
    abortRef.current?.abort()
  }

  const clearChat = () => {
    abortRef.current?.abort()
    const fresh = [{ role: 'assistant', content: "Chat cleared. Ask me anything about your projects." }]
    setHistory(fresh)
    setSessionId('')
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh))
      localStorage.removeItem(SESSION_KEY)
    } catch {}
    inputRef.current?.focus()
  }

  const visibleSuggestions = showAll ? SUGGESTIONS : SUGGESTIONS.slice(0, 5)
  const showSuggestions = history.length <= 2

  return (
    <div className="flex flex-col h-full" role="main" aria-label="AI Assistant">

      {/* Header */}
      <header
        className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'var(--accent-dim)',
              border: '1px solid var(--accent-soft)',
              boxShadow: '0 0 16px var(--accent-glow)',
            }}>
            <Sparkles size={15} style={{ color: 'var(--accent)' }} />
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
              style={{ background: 'var(--fin-positive)', borderColor: 'var(--bg-base)', boxShadow: '0 0 5px rgba(74,222,128,0.6)' }} />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-sm truncate" style={{ color: 'var(--text-1)' }}>FinTrack AI</h1>
            <div className="flex items-center gap-1.5">
              <Database size={9} style={{ color: 'var(--accent)' }} />
              <p className="text-[10px] sm:text-xs truncate" style={{ color: 'var(--text-3)' }}>
                Task-oriented assistant · verified dashboards, summaries, and board-ready responses
              </p>
            </div>
          </div>
        </div>
        <button onClick={clearChat} aria-label="Clear chat history"
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/5 flex-shrink-0"
          style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
          title="Clear chat">
          <Trash2 size={14} />
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-5"
        role="log" aria-label="Chat messages" aria-live="polite">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {RESPONSE_MODES.map(mode => {
            const active = responseMode === mode.id
            return (
              <button
                key={mode.id}
                onClick={() => setResponseMode(mode.id)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all"
                style={active
                  ? { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }
                  : { background: 'var(--bg-input)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
              >
                {mode.label}
              </button>
            )
          })}
          <div className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />
          {QUALITY_PROFILES.map(profile => {
            const active = qualityProfile === profile.id
            return (
              <button
                key={profile.id}
                onClick={() => setQualityProfile(profile.id)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all"
                style={active
                  ? { background: 'rgba(16,185,129,0.12)', color: 'var(--fin-positive)', border: '1px solid rgba(16,185,129,0.22)' }
                  : { background: 'var(--bg-input)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
                title={profile.note}
              >
                {profile.label}
              </button>
            )
          })}
        </div>
        {history.map((msg, i) => <Message key={i} msg={msg} />)}
        {showSuggestions && !loading && (
          <div className="mt-2">
            <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
              <Sparkles size={11} style={{ color: 'var(--accent)' }} /> Try asking:
            </p>
            <div className="flex flex-wrap gap-2" role="list" aria-label="Suggested questions">
              {TASK_CHIPS.map((s) => (
                <button key={s} role="listitem" onClick={() => send(s)} disabled={loading}
                  className="text-xs px-3 py-1.5 rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed text-left"
                  style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--accent)' }}
                  aria-label={s}>
                  {s}
                </button>
              ))}
              {visibleSuggestions.map((s) => (
                <button key={s} role="listitem" onClick={() => send(s)} disabled={loading}
                  className="text-xs px-3 py-1.5 rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed text-left"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                  aria-label={s}>
                  {s}
                </button>
              ))}
              {!showAll && SUGGESTIONS.length > 5 && (
                <button onClick={() => setShowAll(true)}
                  className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1 transition-all"
                  style={{ color: 'var(--accent)', border: '1px solid var(--accent-soft)', background: 'var(--accent-dim)' }}>
                  More <ChevronDown size={10} />
                </button>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="px-3 sm:px-6 pb-4 sm:pb-6 pt-3 sm:pt-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <input
              ref={inputRef}
              className="w-full rounded-xl px-3 sm:px-4 py-2.5 text-sm transition-all outline-none"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
              }}
              placeholder="Ask about your projects…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
              disabled={loading}
              aria-label="Message to AI"
              autoComplete="off"
              maxLength={1000}
            />
          </div>
          {loading ? (
            <button
              onClick={stopGeneration}
              className="px-3 sm:px-4 rounded-xl flex items-center justify-center font-semibold transition-all flex-shrink-0"
              style={{
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.3)',
                color: 'var(--fin-negative)',
              }}
              aria-label="Stop generating"
              title="Stop"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!input.trim()}
              className="px-3 sm:px-4 rounded-xl flex items-center justify-center font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              style={{
                background: !input.trim() ? 'var(--accent-soft)' : 'var(--accent-btn)',
                color: 'white',
                boxShadow: !input.trim() ? 'none' : '0 2px 6px rgba(37,99,235,0.3)',
              }}
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-2" style={{ color: 'var(--text-3)' }}>
          <span className="text-[10px] sm:text-xs flex items-center gap-1.5 min-w-0">
            <Database size={10} style={{ color: 'var(--accent)' }} className="flex-shrink-0" />
            <span className="truncate">AI reads synced portfolio data plus live status context on every response</span>
          </span>
          {input.length > 0 && (
            <span className="text-[10px] sm:text-xs tabular-nums flex-shrink-0"
              style={{ color: input.length > 900 ? 'var(--fin-negative)' : 'var(--text-3)' }}>
              {input.length}/1000
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
