/**
 * ⌘K — everything on the site, one keystroke away.
 *
 * Six pages, eleven modules and thirteen questions is more than a nav bar can
 * hold, and the mega menu only answers "where do I go". This answers "take me
 * to the thing I am thinking of" — including individual FAQ answers and
 * individual sandbox modules, which are the two places nothing else links
 * directly into.
 *
 * Built rather than installed: a palette is a list, a filter and a focus trap,
 * and the packages that do it bring a styling system and a portal runtime to
 * solve a problem that is three useEffects.
 *
 * The rules that matter:
 *
 *   It opens on ⌘K and on Ctrl+K, and on "/" only when nothing else has focus.
 *   A site that swallows "/" while you are typing in its own search box is a
 *   site that has forgotten it is a document.
 *
 *   Arrow keys move a highlight, not focus. Focus stays in the input so you
 *   can keep typing, which is the whole point of a palette; the highlighted
 *   row is announced through aria-activedescendant instead.
 *
 *   Escape closes and focus returns to whatever had it. A dialog that dumps
 *   you at the top of the document has lost your place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft, Command } from 'lucide-react'
import { ALL_PAGES } from './MegaNav'
import { FAQ } from '../content/publicContent'

/** Subsequence match, the way every palette worth using filters. */
function score(needle, hay) {
  if (!needle) return 0
  const n = needle.toLowerCase(), h = hay.toLowerCase()
  const direct = h.indexOf(n)
  if (direct >= 0) return 1000 - direct          // contiguous wins, earlier wins more
  let i = 0, hits = 0
  for (const ch of h) { if (ch === n[i]) { i++; hits++; if (i === n.length) break } }
  return i === n.length ? hits : -1
}

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent('ft-open-command-palette'))
}

export default function CommandPalette() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const restoreRef = useRef(null)

  const ITEMS = useMemo(() => [
    ...ALL_PAGES.map(p => ({
      id: `page:${p.to}`, group: 'Pages', label: p.label, hint: p.blurb, to: p.to,
    })),
    ...FAQ.map(f => ({
      id: `faq:${f.q}`, group: 'Questions', label: f.q, hint: f.group, to: '/faq',
    })),
    { id: 'act:try', group: 'Actions', label: 'Try the sandbox',
      hint: 'a working copy over invented data', to: '/#try' },
    { id: 'act:signin', group: 'Actions', label: 'Sign in',
      hint: 'email, Google or Zoho', to: '/login' },
  ], [])

  const results = useMemo(() => {
    if (!q.trim()) return ITEMS.slice(0, 8)
    return ITEMS
      .map(it => ({ it, s: Math.max(score(q.trim(), it.label), score(q.trim(), it.hint ?? '') - 400) }))
      .filter(r => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 9)
      .map(r => r.it)
  }, [q, ITEMS])

  useEffect(() => { setCursor(0) }, [q])

  const close = useCallback(() => {
    setOpen(false)
    setQ('')
    restoreRef.current?.focus?.()
  }, [])

  // Global opener. "/" is only honoured when the keystroke did not come from
  // somewhere a person is typing.
  useEffect(() => {
    const onKey = (e) => {
      const typing = e.target instanceof HTMLInputElement
        || e.target instanceof HTMLTextAreaElement
        || e.target?.isContentEditable
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        restoreRef.current = document.activeElement
        setOpen(o => !o)
        return
      }
      if (e.key === '/' && !typing && !open) {
        e.preventDefault()
        restoreRef.current = document.activeElement
        setOpen(true)
      }
    }
    const onCustomOpen = () => {
      restoreRef.current = document.activeElement
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('ft-open-command-palette', onCustomOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('ft-open-command-palette', onCustomOpen)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-cursor]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open, results])

  const go = (item) => {
    close()
    if (item.to.startsWith('/#')) {
      navigate('/')
      // After the route has painted, or there is no anchor to scroll to yet.
      requestAnimationFrame(() =>
        document.querySelector(item.to.slice(1))?.scrollIntoView({ behavior: 'smooth' }))
      return
    }
    navigate(item.to)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter' && results[cursor]) { e.preventDefault(); go(results[cursor]) }
  }

  if (!open) return null

  let lastGroup = null

  return (
    <div className="ft-cmd-veil" onPointerDown={e => { if (e.target === e.currentTarget) close() }}>
      <div role="dialog" aria-modal="true" aria-label="Search the site" className="ft-cmd">
        <div className="flex items-center gap-2.5 px-4"
             style={{ height: 52, borderBottom: '1px solid var(--card-border)' }}>
          <Search size={16} aria-hidden="true" style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to a page, a question, a module…"
            aria-label="Search the site"
            aria-controls="ft-cmd-list"
            aria-activedescendant={results[cursor] ? `ft-cmd-${cursor}` : undefined}
            className="flex-1 min-w-0"
            style={{ height: 50, background: 'transparent', border: 0, outline: 'none',
                     fontSize: 15, color: 'var(--text-1)' }}
          />
          <kbd className="ft-kbd shrink-0">esc</kbd>
        </div>

        <ul id="ft-cmd-list" role="listbox" ref={listRef}
            className="m-0 p-1.5 overflow-y-auto" style={{ listStyle: 'none', maxHeight: '52vh' }}>
          {results.length === 0 && (
            <li className="px-3 py-6 text-center" style={{ fontSize: 13, color: 'var(--text-3)' }}>
              Nothing matches “{q}”.
            </li>
          )}
          {results.map((item, i) => {
            const head = item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            const on = i === cursor
            return (
              <li key={item.id}>
                {head && (
                  <p className="ft-eyebrow px-3 pt-3 pb-1.5" style={{ fontSize: '0.58rem' }}>{head}</p>
                )}
                <div
                  id={`ft-cmd-${i}`}
                  role="option"
                  aria-selected={on}
                  data-cursor={on ? '' : undefined}
                  onPointerEnter={() => setCursor(i)}
                  onClick={() => go(item)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer"
                  style={{ background: on ? 'var(--accent-dim)' : 'transparent' }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold"
                          style={{ fontSize: 13.5, color: on ? 'var(--accent)' : 'var(--text-1)' }}>
                      {item.label}
                    </span>
                    {item.hint && (
                      <span className="block truncate" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                        {item.hint}
                      </span>
                    )}
                  </span>
                  {on && <CornerDownLeft size={13} aria-hidden="true" style={{ color: 'var(--accent)' }} />}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="flex items-center gap-3 px-4 py-2"
             style={{ borderTop: '1px solid var(--card-border)', background: 'var(--bg-input)' }}>
          {[['↑ ↓', 'move'], ['↵', 'open'], ['esc', 'close']].map(([k, what]) => (
            <span key={k} className="flex items-center gap-1.5">
              <kbd className="ft-kbd">{k}</kbd>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{what}</span>
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            <Command size={11} aria-hidden="true" />K
          </span>
        </div>
      </div>
    </div>
  )
}
