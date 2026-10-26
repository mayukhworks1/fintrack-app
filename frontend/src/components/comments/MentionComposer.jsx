// A plain-text comment box with @mention autocomplete.
//
// Typing "@" followed by a few letters lists the people who can open the page;
// picking one writes "@Name" into the box and remembers who it was. On submit
// those become stored mention tokens (see commentsModel.draftToTokens).
import { useEffect, useRef, useState } from 'react'
import { draftToTokens, insertMention, mentionQueryAt, tokensToDraft } from './commentsModel'
import { Avatar } from './CommentBits'

export default function MentionComposer({
  onSubmit, searchMentions, initialBody = '', placeholder = 'Add a comment… type @ to mention',
  submitLabel = 'Comment', onCancel, autoFocus = false, compact = false, ariaLabel = 'Comment',
}) {
  const seed = useRef(tokensToDraft(initialBody))
  const [text, setText] = useState(seed.current.text)
  const [mentions, setMentions] = useState(seed.current.mentions)
  const [at, setAt] = useState(null)
  const [results, setResults] = useState([])
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const taRef = useRef(null)
  const seq = useRef(0)
  const caretRef = useRef(null)

  useEffect(() => { if (autoFocus) taRef.current?.focus() }, [autoFocus])

  // Look people up while an "@query" is being typed.
  useEffect(() => {
    if (!at || !searchMentions) { setResults([]); return }
    const mine = ++seq.current
    const timer = setTimeout(() => {
      Promise.resolve(searchMentions(at.query))
        .then(list => { if (mine === seq.current) { setResults(Array.isArray(list) ? list : []); setActive(0) } })
        .catch(() => { if (mine === seq.current) setResults([]) })
    }, at.query ? 120 : 0)
    return () => clearTimeout(timer)
  }, [at?.query, at?.start, searchMentions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Put the caret after an inserted mention once React has re-rendered.
  useEffect(() => {
    if (caretRef.current == null || !taRef.current) return
    const pos = caretRef.current
    caretRef.current = null
    try { taRef.current.focus(); taRef.current.setSelectionRange(pos, pos) } catch { /* detached */ }
  }, [text])

  const onChange = (e) => {
    const value = e.target.value
    setText(value)
    setError('')
    setAt(mentionQueryAt(value, e.target.selectionStart ?? value.length))
  }

  const pick = (person) => {
    if (!at || !person) return
    const name = String(person.name || person.email || 'someone').replace(/[[\]()\n]/g, '').trim()
    const next = insertMention(text, at, name)
    caretRef.current = next.caret
    setText(next.text)
    setMentions(ms => ms.some(m => m.id === person.id) ? ms : [...ms, { id: person.id, name }])
    setAt(null)
    setResults([])
  }

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(draftToTokens(trimmed, mentions))
      setText('')
      setMentions([])
      setAt(null)
    } catch (e) {
      setError(e?.message || 'Could not save the comment')
    } finally {
      setBusy(false)
    }
  }

  const listOpen = !!at && results.length > 0
  const onKeyDown = (e) => {
    if (listOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % results.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + results.length) % results.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(results[active]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAt(null); return }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); return }
    if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel() }
  }

  return (
    <div className="cmt-composer" style={{ position: 'relative' }}>
      <textarea
        ref={taRef}
        aria-label={ariaLabel}
        value={text}
        placeholder={placeholder}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setAt(null), 150)}
        rows={compact ? 2 : 3}
        disabled={busy}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: compact ? 44 : 64,
          padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)',
          background: 'var(--card-bg)', color: 'var(--text-1)', fontSize: 13, lineHeight: 1.45,
          fontFamily: 'inherit', outline: 'none',
        }}
      />
      {listOpen && (
        <ul role="listbox" aria-label="Mention someone" className="cmt-mention-list"
          style={{
            position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, zIndex: 5, listStyle: 'none',
            padding: 4, background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: '0 12px 28px rgba(0,0,0,0.16)', maxHeight: 220, overflowY: 'auto',
          }}>
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); pick(p) }}
              onMouseEnter={() => setActive(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                background: i === active ? 'var(--accent-dim, rgba(0,113,227,0.08))' : 'transparent',
              }}>
              <Avatar person={p} size={22} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                  {p.name}{p.me ? ' (you)' : ''}
                </span>
                {p.email && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <div role="alert" style={{ marginTop: 4, fontSize: 12, color: 'var(--fin-negative, #d70015)' }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ marginRight: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
          {compact ? '' : 'Ctrl + Enter to send'}
        </span>
        {onCancel && (
          <button type="button" onClick={onCancel} className="cmt-btn-ghost" disabled={busy}>Cancel</button>
        )}
        <button type="button" onClick={submit} className="cmt-btn-primary" disabled={busy || !text.trim()}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
