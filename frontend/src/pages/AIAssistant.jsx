import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Bot, User, Sparkles, Trash2, Database, AlertCircle, ChevronDown } from 'lucide-react'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'
import clsx from 'clsx'

/**
 * Renders AI text as clean readable HTML.
 * Handles: numbered lists, section labels (Word:), bold (**text**), line breaks.
 * Strips any leftover markdown symbols.
 */
function AiText({ text }) {
  if (!text) return null

  const lines = text.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()

    if (!line) { i++; continue }

    // Numbered list item: "1. something"
    if (/^\d+\.\s/.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ''))
        i++
      }
      elements.push(
        <ol key={i} className="space-y-1.5 my-2 ml-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>
              <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                {j + 1}
              </span>
              <span dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
            </li>
          ))}
        </ol>
      )
      continue
    }

    // Section label: "Word:" or "Word Word:" at the start of a line
    if (/^[A-Z][A-Za-z\s]{1,30}:$/.test(line) || /^[A-Z][A-Za-z\s]{1,30}:\s/.test(line)) {
      const colonIdx = line.indexOf(':')
      const label    = line.slice(0, colonIdx)
      const rest     = line.slice(colonIdx + 1).trim()
      elements.push(
        <div key={i} className="mt-3 mb-1">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#22c55e' }}>
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

    // Regular paragraph
    elements.push(
      <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}
        dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
    )
    i++
  }

  return <div className="space-y-1.5">{elements}</div>
}

function formatInline(text) {
  return text
    // **bold** → <strong>
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-1);font-weight:600">$1</strong>')
    // *italic* → <em>
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // strip remaining lone asterisks, backticks, hashes
    .replace(/[`#*_]/g, '')
    // ₹ numbers with commas stay as-is
    .trim()
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
      className={clsx('flex gap-3 mb-5 animate-slide-up', isUser && 'flex-row-reverse')}
      role="article"
      aria-label={isUser ? 'Your message' : 'AI response'}
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={isUser
          ? { background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 0 12px rgba(34,197,94,0.3)' }
          : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }
        }
        aria-hidden="true"
      >
        {isUser
          ? <User size={13} className="text-white" />
          : <Bot size={13} style={{ color: '#4ade80' }} />
        }
      </div>

      {/* Bubble */}
      <div
        className={clsx('max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed', isUser ? 'rounded-tr-sm' : 'rounded-tl-sm')}
        style={isUser
          ? { background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.2)', color: 'var(--text-1)' }
          : { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-1)' }
        }
      >
        {msg.error
          ? <span className="flex items-center gap-2" style={{ color: '#f87171' }}>
              <AlertCircle size={13} />{msg.content}
            </span>
          : isUser
            ? <p className="text-sm leading-relaxed">{msg.content}</p>
            : <AiText text={msg.content} />
        }
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 mb-5" aria-live="polite" aria-label="AI is analyzing your data">
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <Bot size={13} style={{ color: '#4ade80' }} />
      </div>
      <div className="rounded-2xl rounded-tl-sm px-4 py-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[0, 150, 300].map((delay) => (
              <span key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce"
                style={{ background: 'var(--text-3)', animationDelay: `${delay}ms` }} aria-hidden="true" />
            ))}
          </div>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>Analyzing your data…</span>
        </div>
      </div>
    </div>
  )
}

export default function AIAssistant() {
  const toast = useToast()
  const [history, setHistory] = useState([{
    role: 'assistant',
    content: "Hi! I'm FinTrackAI. I have live access to all your Fintrack project data and can answer specific questions about clients, billing, profit margins, targets, and more.\n\nWhat would you like to know?",
  }])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [showAll, setShowAll]   = useState(false)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, loading])

  const send = async (text) => {
    const msg = (text || input).trim()
    if (!msg || loading) return
    setInput('')
    const newHistory = [...history, { role: 'user', content: msg }]
    setHistory(newHistory)
    setLoading(true)
    try {
      const { reply } = await api.ai.chat(msg, history)
      setHistory(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      const raw = e.message || ''
      const errMsg = raw.includes('500')
        ? 'Backend error — check that OPENROUTER_API_KEY is set in HF Space secrets'
        : raw.includes('OPENROUTER')
          ? raw
          : `AI error: ${raw}`
      setHistory(prev => [...prev, { role: 'assistant', content: errMsg, error: true }])
      toast(errMsg, 'error', 6000)
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const clearChat = () => {
    setHistory([{ role: 'assistant', content: "Chat cleared! Ask me anything about your projects." }])
    inputRef.current?.focus()
  }

  const visibleSuggestions = showAll ? SUGGESTIONS : SUGGESTIONS.slice(0, 5)
  const showSuggestions = history.length <= 2

  return (
    <div className="flex flex-col h-full" role="main" aria-label="AI Assistant">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          {/* AI avatar with glow */}
          <div className="relative w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.2) 0%, rgba(34,197,94,0.05) 100%)', border: '1px solid rgba(34,197,94,0.25)', boxShadow: '0 0 20px rgba(34,197,94,0.15)' }}>
            <Sparkles size={16} style={{ color: '#4ade80' }} />
            {/* Live indicator */}
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
              style={{ background: '#4ade80', borderColor: 'var(--bg-base)', boxShadow: '0 0 6px #4ade80' }} />
          </div>
          <div>
            <h1 className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>FinTrack AI</h1>
            <div className="flex items-center gap-1.5">
              <Database size={9} style={{ color: '#4ade80' }} />
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>Live data access · nvidia/nemotron</p>
            </div>
          </div>
        </div>
        <button onClick={clearChat} aria-label="Clear chat history"
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/5"
          style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
          title="Clear chat">
          <Trash2 size={14} />
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-5"
        role="log" aria-label="Chat messages" aria-live="polite">
        {history.map((msg, i) => <Message key={i} msg={msg} />)}
        {loading && <TypingIndicator />}

        {/* Suggestions (shown when chat is fresh) */}
        {showSuggestions && !loading && (
          <div className="mt-2">
            <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
              <Sparkles size={11} style={{ color: '#4ade80' }} /> Try asking:
            </p>
            <div className="flex flex-wrap gap-2" role="list" aria-label="Suggested questions">
              {visibleSuggestions.map((s) => (
                <button key={s} role="listitem" onClick={() => send(s)} disabled={loading}
                  className="text-xs px-3 py-1.5 rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:border-green-500/40"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                  aria-label={s}>
                  {s}
                </button>
              ))}
              {!showAll && SUGGESTIONS.length > 5 && (
                <button onClick={() => setShowAll(true)}
                  className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1 transition-all"
                  style={{ color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', background: 'rgba(34,197,94,0.05)' }}>
                  More <ChevronDown size={10} />
                </button>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="px-6 pb-6 pt-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex gap-2.5">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              className="w-full rounded-xl px-4 py-2.5 text-sm pr-4 transition-all outline-none"
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
            />
          </div>
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="px-4 rounded-xl flex items-center justify-center font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            style={{
              background: loading || !input.trim()
                ? 'rgba(34,197,94,0.2)'
                : 'linear-gradient(135deg, #22c55e, #16a34a)',
              color: 'white',
              boxShadow: loading || !input.trim() ? 'none' : '0 4px 12px rgba(34,197,94,0.35)',
            }}
            aria-label={loading ? 'Sending…' : 'Send message'}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <p className="text-xs text-center mt-2.5 flex items-center justify-center gap-1.5" style={{ color: 'var(--text-3)' }}>
          <Database size={10} style={{ color: '#4ade80' }} />
          AI reads all live project records before every response
        </p>
      </div>
    </div>
  )
}
