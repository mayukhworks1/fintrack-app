import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../services/api'
import { DB_CSS } from './dbStyles'
import { PropCell } from './PropertyValue'
import { COMPUTED, isEmptyValue, typeMeta } from './dbModel'
import { docText } from '../blocks/docText'

/** No text and nothing else put in (an image, an embed, a table, a rule). */
export function isDocEmpty(content) {
  const c = String(content || '')
  if (!c.trim()) return true
  return docText(c).trim() === '' && !/"type":"(image|embed|table|horizontalRule|codeBlock|taskList)"/.test(c)
}

const CollabDoc = lazy(() => import('../blocks/collab/CollabDoc'))
const SAVE_AFTER_MS = 900
const LIVE = new Set(['live', 'reconnecting'])

/** A row with nothing put in it: no title, and no values beyond the ones it
 *  was created with (`start`: the column or day it was added in). */
export function rowIsBlank(row, schema, start = {}) {
  if (!row || String(row.title || '').trim()) return false
  return (schema?.properties || []).every(p => {
    if (p.type === 'title' || COMPUTED.has(p.type)) return true
    const v = row.props?.[p.id]
    return isEmptyValue(v) || JSON.stringify(v) === JSON.stringify(start?.[p.id])
  })
}

/**
 * The row's page, body editor and saving. A document body edits live when it
 * can (CollabDoc); otherwise it is saved here after a pause, and on close.
 */
function useRowBody(rowId) {
  const [page, setPage] = useState(null)
  const [error, setError] = useState('')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState('')
  const contentRef = useRef('')
  const savedRef = useRef('')
  const modeRef = useRef('off')
  contentRef.current = content

  useEffect(() => {
    let alive = true
    setPage(null); setError('')
    Promise.resolve().then(() => api.pages.get(rowId))
      .then(p => {
        if (!alive) return
        if (!p?.id) throw new Error('This row could not be opened')
        savedRef.current = p.content || ''
        contentRef.current = p.content || ''
        setContent(p.content || '')
        setPage(p)
      })
      .catch(e => { if (alive) setError(e?.message || 'This row could not be opened') })
    return () => { alive = false }
  }, [rowId])

  const save = useCallback(async () => {
    if (LIVE.has(modeRef.current)) return
    const next = contentRef.current
    if (next === savedRef.current) return
    setStatus('Saving…')
    try {
      await api.pages.update(rowId, { content: next })
      savedRef.current = next
      setStatus(s => (s === 'Saving…' ? 'Saved' : s))
    } catch (e) {
      setStatus(e?.message ? `Not saved: ${e.message}` : 'Not saved')
    }
  }, [rowId])

  useEffect(() => {
    if (!page || content === savedRef.current || LIVE.has(modeRef.current)) return undefined
    const t = setTimeout(save, SAVE_AFTER_MS)
    return () => clearTimeout(t)
  }, [content, page, save])

  const onModeChange = useCallback((next, info = {}) => {
    const was = LIVE.has(modeRef.current)
    modeRef.current = next
    // Leaving a session that holds everything: what is on screen is saved.
    if (was && !LIVE.has(next) && info.contentSynced) savedRef.current = contentRef.current
  }, [])

  return {
    page, error, content, setContent, status, save, onModeChange,
    isContentSaved: () => contentRef.current === savedRef.current,
    bodyEmpty: () => isDocEmpty(contentRef.current),
  }
}

/**
 * A row opened over its database: title, properties and the row's page body,
 * without leaving the database. "Open as page" goes to the full editor.
 */
export default function RowPeek({ row, schema, people, onChange, onCreateOption, onClose, onOpenPage, isMobile }) {
  const body = useRowBody(row.id)
  const titleRef = useRef(null)
  const [title, setTitle] = useState(row.title || '')
  useEffect(() => { if (document.activeElement !== titleRef.current) setTitle(row.title || '') }, [row.title])
  const isDoc = body.page && (body.page.content_type || 'doc') === 'doc'

  const close = useCallback(() => {
    if (title !== (row.title || '')) onChange(row.id, 'title', title)
    body.save()
    onClose({ bodyEmpty: body.bodyEmpty() && title.trim() === '' })
  }, [title, row, onChange, onClose, body])

  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // Escape inside a popover or the editor's menus is theirs.
      if (document.querySelector('.fdb-pop, [data-slash-menu], .ft-page-picker')) return
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (!row.title) titleRef.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const props = schema.properties.filter(p => p.type !== 'title')
  const titleProp = schema.properties.find(p => p.type === 'title')

  return createPortal(
    <div className="fdb-peek-backdrop" onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) close() }}
      onMouseDown={e => e.stopPropagation()}>
      <style>{DB_CSS}</style>
      <aside className="fdb fdb-peek" role="dialog" aria-modal="true" aria-label={`Row: ${title || 'Untitled'}`}
        style={isMobile ? { width: '100vw' } : undefined}>
        <div className="fdb-peek-bar">
          <button type="button" className="fdb-btn" onClick={close} aria-label="Close row">✕ Close</button>
          <span style={{ flex: 1 }} />
          {body.status && <span className="fdb-count" role="status">{body.status}</span>}
          {onOpenPage && (
            <button type="button" className="fdb-btn" onClick={() => { close(); onOpenPage(row) }}>Open as page ↗</button>
          )}
        </div>
        <div className="fdb-peek-body">
          <input ref={titleRef} className="fdb-peek-title" value={title} placeholder="Untitled"
            aria-label={titleProp?.name || 'Title'}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => { if (title !== (row.title || '')) onChange(row.id, 'title', title) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
          <div className="fdb-props">
            {props.map(p => (
              <div key={p.id} style={{ display: 'contents' }}>
                <div className="k"><span aria-hidden="true">{typeMeta(p.type).glyph}</span><span>{p.name}</span></div>
                <div className="v">
                  <PropCell prop={p} row={row} people={people} onCreateOption={onCreateOption} onChange={v => onChange(row.id, p.id, v)} />
                </div>
              </div>
            ))}
          </div>
          {body.error ? (
            <div className="fdb-empty" role="alert">{body.error}</div>
          ) : !body.page ? (
            <div className="fdb-empty" aria-busy="true">Loading…</div>
          ) : isDoc ? (
            <Suspense fallback={<div className="fdb-empty">Loading editor…</div>}>
              <div className="fdb-peek-doc">
                <CollabDoc pageId={row.id} value={body.content} onChange={body.setContent}
                  onModeChange={body.onModeChange} isContentSaved={body.isContentSaved} ariaLabel="Row page" />
              </div>
            </Suspense>
          ) : (
            <div className="fdb-empty">This row's page is not a block document. Open it as a page to edit it.</div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
