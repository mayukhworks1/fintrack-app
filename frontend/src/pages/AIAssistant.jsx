import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Bot, User, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../services/api'
import clsx from 'clsx'

const SUGGESTIONS = [
  'Which project has the highest profit percentage?',
  'Summarize the overall portfolio health',
  'Which client has the most active projects?',
  'Are any projects below target revenue?',
  'What is the total billing for Birla Open Minds?',
  'Which projects are at risk?',
]

function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={clsx('flex gap-3 mb-4', isUser && 'flex-row-reverse')}>
      <div className={clsx(
        'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
        isUser ? 'bg-brand-500' : 'bg-surface-600'
      )}>
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-brand-400" />}
      </div>
      <div className={clsx(
        'max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
        isUser
          ? 'bg-brand-500/20 text-gray-100 rounded-tr-sm'
          : 'bg-surface-700 text-gray-200 rounded-tl-sm'
      )}>
        <div className="whitespace-pre-wrap">{msg.content}</div>
      </div>
    </div>
  )
}

export default function AIAssistant() {
  const [history, setHistory] = useState([
    { role: 'assistant', content: "Hi! I'm FinTrackAI. I have live access to your project data and can help you analyze performance, identify risks, answer questions, and more. What would you like to know?" }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [history])

  const send = async (text) => {
    const msg = text || input.trim()
    if (!msg || loading) return
    setInput('')
    const newHistory = [...history, { role: 'user', content: msg }]
    setHistory(newHistory)
    setLoading(true)
    try {
      const { reply } = await api.ai.chat(msg, history)
      setHistory([...newHistory, { role: 'assistant', content: reply }])
    } catch (e) {
      setHistory([...newHistory, { role: 'assistant', content: `Sorry, I hit an error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center">
            <Sparkles size={16} className="text-brand-400" />
          </div>
          <div>
            <h1 className="font-semibold text-white text-sm">FinTrack AI Assistant</h1>
            <p className="text-xs text-gray-500">Powered by {import.meta.env.VITE_AI_MODEL || 'Mistral 7B'} via OpenRouter</p>
          </div>
        </div>
        <button
          onClick={() => setHistory([{ role: 'assistant', content: "Chat cleared! How can I help you?" }])}
          className="p-2 rounded-lg hover:bg-surface-700 text-gray-500 hover:text-gray-300 transition-colors"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6">
        {history.map((msg, i) => <Message key={i} msg={msg} />)}
        {loading && (
          <div className="flex gap-3 mb-4">
            <div className="w-7 h-7 rounded-full bg-surface-600 flex items-center justify-center flex-shrink-0">
              <Bot size={14} className="text-brand-400" />
            </div>
            <div className="bg-surface-700 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center h-5">
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {history.length <= 2 && (
        <div className="px-6 pb-3">
          <p className="text-xs text-gray-600 mb-2">Try asking:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)}
                className="text-xs px-3 py-1.5 rounded-full bg-surface-700 hover:bg-surface-600 text-gray-400 hover:text-gray-200 transition-colors border border-surface-600">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-6 pb-6 pt-2 border-t border-surface-700">
        <div className="flex gap-3">
          <input
            className="input flex-1"
            placeholder="Ask about your projects..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            disabled={loading}
          />
          <button onClick={() => send()} disabled={loading || !input.trim()} className="btn-primary px-4">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
