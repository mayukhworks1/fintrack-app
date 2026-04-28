import { useState, useRef, useEffect } from 'react'
import {
  Send, Loader2, Bot, User, Sparkles, Trash2, Database,
  AlertCircle, ChevronDown, Copy, Check, Square,
} from 'lucide-react'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'
import clsx from 'clsx'

/* ───────── Inline text formatting (bold, strip stray markdown) ───────── */
function formatInline(text) {
  return text
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
                style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--fin-positive)' }}>
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
              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2" style={{ background: 'var(--fin-positive)' }} />
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
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--fin-positive)' }}>
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
  'Are any projects below target revenue?',
  'Total billing for Birla Open Minds?',
  'Which projects are at risk?',
  'Compare all clients by profitability',
  'What is the average project duration?',
  'Which projects have met their targets?',
  'Show me the worst performing project',
]

function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div
      className={clsx('flex gap-2 sm:gap-3 mb-4 sm:mb-5 animate-slide-up', isUser && 'flex-row-reverse')}
      role="article"
      aria-label={isUser ? 'Your message' : 'AI response'}
    >
      <div
        className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={isUser
          ? { background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 0 12px rgba(37,99,235,0.25)' }
          : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }
        }
        aria-hidden="true"
      >
        {isUser
          ? <User size={12} className="text-white" />
          : <Bot size={12} style={{ color: 'var(--fin-positive)' }} />
        }
      </div>

      <div className={clsx('max-w-[88%] sm:max-w-[82%] min-w-0')}>
        <div
          className={clsx('rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm leading-relaxed break-words',
            isUser ? 'rounded-tr-sm' : 'rounded-tl-sm')}
          style={isUser
            ? { background: 'rgba(34,197,94,0.12)', border: '1px solid var(--accent-soft)', color: 'var(--text-1)' }
            : { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-1)' }
          }
        >
          {msg.error
            ? <span className="flex items-start gap-2" style={{ color: 'var(--fin-negative)' }}>
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                <span>{msg.content}</span>
              </span>
            : isUser
              ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              : <AiText text={msg.content} />
          }
        </div>

        {/* Assistant footer: model + copy */}
        {!isUser && !msg.error && msg.content && (
          <div className="flex items-center gap-2 mt-1 px-1">
            {msg.model && (
              <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                <Sparkles size={9} style={{ color: 'var(--fin-positive)' }} />
                {msg.model}
              </span>
            )}
            <CopyButton text={msg.content} />
          </div>
        )}
      </div>
    </div>
  )
}

function TypingIndicator({ onStop }) {
  return (
    <div className="flex gap-2 sm:gap-3 mb-5" aria-live="polite" aria-label="AI is analyzing your data">
      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <Bot size={12} style={{ color: 'var(--fin-positive)' }} />
      </div>
      <div className="rounded-2xl rounded-tl-sm px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-3"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[0, 150, 300].map((delay) => (
              <span key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce"
                style={{ background: 'var(--text-3)', animationDelay: `${delay}ms` }} aria-hidden="true" />
            ))}
          </div>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>Analyzing…</span>
        </div>
        {onStop && (
          <button
            onClick={onStop}
            aria-label="Stop generating"
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-all hover:bg-white/5"
            style={{ color: 'var(--fin-negative)', border: '1px solid var(--fin-neg-border)' }}
          >
            <Square size={9} fill="currentColor" /> Stop
          </button>
        )}
      </div>
    </div>
  )
}

const WELCOME = {
  role: 'assistant',
  content: "Hi! I'm FinTrackAI. I have live access to all your Fintrack project data — every client, billing amount, profit margin, and target.\n\nWhat would you like to know?",
}

const STORAGE_KEY = 'fintrack-ai-history'

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
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-40))) } catch {}
  }, [history])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, loading])

  // Cleanup any in-flight request on unmount
  useEffect(() => () => abortRef.current?.abort(), [])

  const send = async (text) => {
    const msg = (text || input).trim()
    if (!msg || loading) return
    setInput('')
    const priorHistory = history
    setHistory(prev => [...prev, { role: 'user', content: msg }])
    setLoading(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const { reply, model } = await api.ai.chat(msg, priorHistory, { signal: ctrl.signal })
      setHistory(prev => [...prev, { role: 'assistant', content: reply, model }])
    } catch (e) {
      if (e.name === 'AbortError') {
        setHistory(prev => [...prev, { role: 'assistant', content: 'Generation stopped.', error: false, model: null }])
      } else {
        const raw = e.message || ''
        const errMsg = raw.includes('500')
          ? 'Backend error — check that OPENROUTER_API_KEY is set in HF Space secrets'
          : raw.includes('OPENROUTER')
            ? raw
            : `AI error: ${raw}`
        setHistory(prev => [...prev, { role: 'assistant', content: errMsg, error: true }])
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
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)) } catch {}
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
              background: 'linear-gradient(135deg, var(--accent-soft) 0%, rgba(34,197,94,0.05) 100%)',
              border: '1px solid rgba(34,197,94,0.25)',
              boxShadow: '0 0 20px rgba(34,197,94,0.15)',
            }}>
            <Sparkles size={15} style={{ color: 'var(--fin-positive)' }} />
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
              style={{ background: 'var(--fin-positive)', borderColor: 'var(--bg-base)', boxShadow: '0 0 6px #4ade80' }} />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-sm truncate" style={{ color: 'var(--text-1)' }}>FinTrack AI</h1>
            <div className="flex items-center gap-1.5">
              <Database size={9} style={{ color: 'var(--fin-positive)' }} />
              <p className="text-[10px] sm:text-xs truncate" style={{ color: 'var(--text-3)' }}>
                Live data · nvidia/nemotron
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
        {history.map((msg, i) => <Message key={i} msg={msg} />)}
        {loading && <TypingIndicator onStop={stopGeneration} />}

        {showSuggestions && !loading && (
          <div className="mt-2">
            <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
              <Sparkles size={11} style={{ color: 'var(--fin-positive)' }} /> Try asking:
            </p>
            <div className="flex flex-wrap gap-2" role="list" aria-label="Suggested questions">
              {visibleSuggestions.map((s) => (
                <button key={s} role="listitem" onClick={() => send(s)} disabled={loading}
                  className="text-xs px-3 py-1.5 rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:border-green-500/40 text-left"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                  aria-label={s}>
                  {s}
                </button>
              ))}
              {!showAll && SUGGESTIONS.length > 5 && (
                <button onClick={() => setShowAll(true)}
                  className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1 transition-all"
                  style={{ color: 'var(--fin-positive)', border: '1px solid var(--accent-soft)', background: 'rgba(34,197,94,0.05)' }}>
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
                background: !input.trim()
                  ? 'var(--accent-soft)'
                  : 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: 'white',
                boxShadow: !input.trim() ? 'none' : '0 4px 12px rgba(34,197,94,0.35)',
              }}
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-2" style={{ color: 'var(--text-3)' }}>
          <span className="text-[10px] sm:text-xs flex items-center gap-1.5 min-w-0">
            <Database size={10} style={{ color: 'var(--fin-positive)' }} className="flex-shrink-0" />
            <span className="truncate">AI reads live project data every response</span>
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
