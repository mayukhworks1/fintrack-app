/**
 * AgentInterviewCard — clarification question UI for the Agentic Web Studio.
 *
 * The AI analyses an ambiguous prompt and produces structured questions (theme
 * choice, section selection, etc.). This card renders them as interactive chips
 * and collects the user's answers before generation starts.
 *
 * Props:
 *   questions   — Array of {id, text, type: "single"|"multi", options: string[]}
 *   onSubmit    — Called with {[id]: answer, ...} when the user clicks "Start"
 *   onSkip      — Called when the user wants to skip and generate immediately
 *   disabled    — Disables all inputs (e.g. while generating)
 */
import { useState, useCallback } from 'react'

export default function AgentInterviewCard({ questions = [], onSubmit, onSkip, disabled = false }) {
  // Each answer is keyed by question id.
  // Single-select: string, Multi-select: string[]
  const [answers, setAnswers] = useState(() => {
    const init = {}
    for (const q of questions) {
      init[q.id] = q.type === 'multi' ? [] : ''
    }
    return init
  })

  const toggle = useCallback((qId, type, value) => {
    setAnswers(prev => {
      if (type === 'single') {
        return { ...prev, [qId]: value }
      }
      // multi — toggle the value in the array
      const arr = prev[qId] || []
      const next = arr.includes(value)
        ? arr.filter(v => v !== value)
        : [...arr, value]
      return { ...prev, [qId]: next }
    })
  }, [])

  const handleSubmit = () => {
    if (disabled) return
    // Flatten multi answers to comma-separated strings for the API
    const flat = {}
    for (const [k, v] of Object.entries(answers)) {
      flat[k] = Array.isArray(v) ? v.join(', ') : v
    }
    onSubmit?.(flat)
  }

  if (!questions.length) return null

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius, 8px)',
      background: 'var(--bg-card)',
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
          🎯 A few questions to craft the perfect page
        </span>
      </div>

      {questions.map(q => (
        <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>
            {q.text}
            {q.type === 'multi' && (
              <span style={{ fontWeight: 400, color: 'var(--text-2)', marginLeft: 6 }}>
                (select all that apply)
              </span>
            )}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(q.options || []).map(opt => {
              const isSelected = q.type === 'multi'
                ? (answers[q.id] || []).includes(opt)
                : answers[q.id] === opt
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(q.id, q.type, opt)}
                  style={{
                    fontSize: 12,
                    padding: '5px 12px',
                    borderRadius: 99,
                    border: isSelected
                      ? '1.5px solid var(--accent, #3b82f6)'
                      : '1px solid var(--border)',
                    background: isSelected
                      ? 'color-mix(in srgb, var(--accent, #3b82f6) 12%, transparent)'
                      : 'var(--bg-base, #f8fafc)',
                    color: isSelected ? 'var(--accent, #3b82f6)' : 'var(--text-2)',
                    cursor: disabled ? 'default' : 'pointer',
                    fontWeight: isSelected ? 600 : 400,
                    transition: 'all .15s ease',
                    lineHeight: 1.4,
                  }}
                >
                  {q.type === 'multi' && (
                    <span style={{ marginRight: 4 }}>{isSelected ? '✓' : '○'}</span>
                  )}
                  {opt}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button
          type="button"
          onClick={onSkip}
          disabled={disabled}
          style={{
            fontSize: 12,
            padding: '6px 14px',
            borderRadius: 'var(--radius, 8px)',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-2)',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          Skip — use prompt as-is
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '6px 16px',
            borderRadius: 'var(--radius, 8px)',
            border: 'none',
            background: 'var(--accent, #3b82f6)',
            color: '#fff',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          ✨ Generate with preferences
        </button>
      </div>
    </div>
  )
}
