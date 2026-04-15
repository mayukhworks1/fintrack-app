import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Bot, User, Sparkles, Trash2, RefreshCw, AlertCircle } from 'lucide-react'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'
import clsx from 'clsx'

const SUGGESTIONS = [
  'Which project has the highest profit %?',
  'Summarize the overall portfolio health',
  'Which client has the most projects?',
  'Are any projects below target revenue?',
  'Total billing for Birla Open Minds?',
  'Which projects are at risk?',
  'Compare all clients by profitability',
  'What is the average project duration?',
]

function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div
      className={clsx('flex gap-3 mb-4 animate-fade-in', isUser && 'flex-row-reverse')}
      role="article"
      aria-label={isUser ? 'Your message' : 'AI response'}
    >
      <div className={clsx(
        'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
        isUser ? 'bg-brand-500' : 'bg-surface-600 border border-surface-500'
      )} aria-hidden="true">
        {isUser
          ? <User size={13} className="text-white" />
          : <Bot size={13} className="text-brand-400" />}
      </div>
      <div className={clsx(
        'max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
        isUser
          ? 'bg-brand-500/20 text-gray-100 rounded-tr-sm border border-brand-500/20'
          : 'bg-surface-700 text-gray-200 rounded-tl-sm border border-surface-600'
      )}>
        {msg.error
          ? <span className="text-red-400 flex items-center gap-2"><AlertCircle size={13} />{msg.content}</span>
          : <div className="whitespace-pre-wrap">{msg.content}</div>
        }
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 mb-4" aria-live="polite" aria-label="AI is typing">
      <div className="w-7 h-7 rounded-full bg-surface-600 border border-surface-500 flex items-center justify-center flex-shrink-0">
        <Bot size={13} className="text-brand-400" />
      </div>
      <div className="bg-surface-700 rounded-2xl rounded-tl-sm border border-surface-600 px-4 py-3">
        <div className="flex gap-1 items-center h-5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function AIAssistant() {
  const toast = useToast()
  const [history, setHistory] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm FinTrackAI. I have live access to your project data and can help you analyze performance, identify risks, spot trends, and more.\n\nWhat would you like to know?",
    }
  ])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
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
      const errMsg = e.message.includes('500')
        ? 'Backend error — check that OPENROUTER_API_KEY is set in HF Space secrets'
        : `Error: ${e.message}`
      setHistory(prev => [...prev, { role: 'assistant', content: errMsg, error: true }])
      toast(errMsg, 'error', 6000)
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const clearChat = () => {
    setHistory([{ role: 'assistant', content: "Chat cleared! How can I help you?" }])
    inputRef.current?.focus()
  }

  const showSuggestions = history.length <= 2

  return (
    <div className="flex flex-col h-full" role="main" aria-label="AI Assistant">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-surface-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center flex-shrink-0" aria-hidden="true">
            <Sparkles size={15} className="text-brand-400" />
          </div>
          <div>
            <h1 className="font-semibold text-white text-sm">FinTrack AI</h1>
            <p className="text-xs text-gray-500">
              {import.meta.env.VITE_AI_MODEL || 'Mistral 7B'} · Live data access
            </p>
          </div>
        </div>
        <button
          onClick={clearChat}
          aria-label="Clear chat history"
          className="btn-icon"
          title="Clear chat"
        >
          <Trash2 size={15} />
        </button>
      </header>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto p-6"
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {history.map((msg, i) => <Message key={i} msg={msg} />)}
        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {showSuggestions && (
        <div className="px-6 pb-3 flex-shrink-0">
          <p className="text-xs text-gray-600 mb-2">Try asking:</p>
          <div className="flex flex-wrap gap-1.5" role="list" aria-label="Suggested questions">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                role="listitem"
                onClick={() => send(s)}
                disabled={loading}
                className="text-xs px-3 py-1.5 rounded-full bg-surface-700 hover:bg-surface-600 text-gray-400 hover:text-gray-200 transition-colors border border-surface-600 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={s}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-6 pb-6 pt-3 border-t border-surface-700 flex-shrink-0">
        <div className="flex gap-3">
          <input
            ref={inputRef}
            className="input flex-1"
            placeholder="Ask about your projects…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            disabled={loading}
            aria-label="Message to AI"
            autoComplete="off"
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="btn-primary px-4 flex-shrink-0"
            aria-label={loading ? 'Sending…' : 'Send message'}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-2 text-center">
          AI has real-time access to your Teable project data
        </p>
      </div>
    </div>
  )
}
