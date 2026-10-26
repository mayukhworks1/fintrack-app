import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Y from 'yjs'
import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import BlockEditor from '../BlockEditor'
import { CLOSE, CollabProvider, collabUrl } from './provider'
import { PresenceBar } from './PresenceBar'
import { peersOf, sameDoc } from './presence'
import * as apiModule from '../../../services/api'
import './collab.css'

const FIELD = 'default'
// Read through the module so a partial stand-in for the API (tests, embeds)
// simply means "no live session" rather than a crash.
const apiValue = (name, fallback) => { try { return apiModule[name] ?? fallback } catch { return fallback } }
const getToken = () => { const f = apiValue('getAuthToken', null); return f ? f() : '' }
// A dropped connection reads as "Reconnecting" for this long before the page
// falls back to ordinary saving.
const OFFLINE_AFTER_MS = 8000

export const NOTES = {
  tooLargeLive: { tone: 'info', text: 'This page is too large to edit live. Your changes save the usual way.' },
  trashed: { tone: 'warn', lock: true, text: 'This page was moved to the trash, so it can no longer be edited. Restore it from the trash to keep working.' },
  reloaded: { tone: 'info', text: 'This page was changed elsewhere (a restored version or another save). The latest copy is loaded.' },
  denied: { tone: 'warn', text: 'Live editing is not available for this page. Your changes save the usual way.' },
}

/** What a closed session means for the page: next mode, whether the content
 *  on screen is already on the server, an optional note, and read-only. */
export function fatalOutcome(code) {
  if (code === CLOSE.TRASHED) return { mode: 'offline', contentSynced: true, note: NOTES.trashed, readOnly: true }
  if (code === CLOSE.TOO_LARGE || code === CLOSE.MESSAGE_TOO_BIG) return { mode: 'offline', contentSynced: false, note: NOTES.tooLargeLive }
  if (code === CLOSE.FORBIDDEN || code === CLOSE.NOT_FOUND) return { mode: 'offline', contentSynced: false, note: NOTES.denied }
  return { mode: 'offline', contentSynced: false, note: null }
}

/**
 * A block document that edits live when it can.
 *
 * It always opens as the ordinary editor over `value` (instant, works with no
 * socket at all) and upgrades to a live session once the server's copy is in
 * hand and nothing typed is unsaved — so the swap can never drop a keystroke.
 * Live, the server owns saving the content; this reports `mode` so the page
 * leaves content out of its own autosave:
 *
 *   connecting    first attempt in flight (ordinary saving)
 *   live          synced; the server saves the content
 *   reconnecting  socket dropped; edits queue locally and merge on reconnect
 *   offline       no live session (ordinary saving); retried in the background
 *
 * onModeChange(mode, { contentSynced }) — contentSynced says the current
 * content is already on the server (a clean hand-back from a live session).
 * Leaving a session with edits the server has not taken reports
 * contentSynced: false, so the page saves them; if this editor is going away
 * at that moment it saves them itself (and warns before the tab closes).
 * isContentSaved() — whether `value` matches what the page last saved.
 */
export default function CollabDoc({
  pageId, value, onChange, uploadImage, onReady, onModeChange, isContentSaved,
  presenceSlot, commands, extensions, ariaLabel, providerOptions,
}) {
  const [session, setSession] = useState(null)      // { doc, provider, key }
  const [mode, setModeState] = useState(pageId ? 'connecting' : 'off')
  const [peers, setPeers] = useState([])
  const [savedAt, setSavedAt] = useState(null)
  const [fatal, setFatal] = useState(null)
  const [note, setNote] = useState(null)            // { tone, text }
  const [readOnly, setReadOnly] = useState(false)
  const valueRef = useRef(value)
  valueRef.current = value
  const savedRef = useRef(isContentSaved)
  savedRef.current = isContentSaved
  const modeChangeRef = useRef(onModeChange)
  modeChangeRef.current = onModeChange
  const modeRef = useRef(mode)
  const editorRef = useRef(null)
  const pendingSelRef = useRef(null)
  const attemptRef = useRef(null)
  const failuresRef = useRef(0)
  const keyRef = useRef(0)
  const pageIdRef = useRef(pageId)
  pageIdRef.current = pageId

  const go = useCallback((next, info = {}) => {
    if (modeRef.current === next) return
    modeRef.current = next
    setModeState(next)
    modeChangeRef.current?.(next, info)
  }, [])

  const latestContent = useCallback(() => {
    const ed = editorRef.current
    if (ed && !ed.isDestroyed) { try { return JSON.stringify(ed.getJSON()) } catch { /* fall through */ } }
    return valueRef.current
  }, [])

  const endFatal = useCallback((code, end) => {
    const out = fatalOutcome(code)
    setFatal(code)
    setNote(out.note)
    if (out.readOnly) setReadOnly(true)
    end(out.mode, { contentSynced: out.contentSynced })
  }, [])

  useEffect(() => {
    if (!pageId) go('off')
    else if (modeRef.current === 'off') go('connecting')
  }, [pageId, go])

  // ── Upgrade: ordinary editor -> live session ──────────────────────────────
  useEffect(() => {
    if (!pageId || session || fatal) return undefined
    let cancelled = false
    let timer = null
    const later = (ms) => { if (!cancelled) timer = setTimeout(start, ms) }

    function start() {
      if (cancelled) return
      // Unsaved typing goes out through ordinary autosave first; a live session
      // opened now would refuse that save.
      if (savedRef.current && !savedRef.current()) { later(1500); return }
      const doc = new Y.Doc()
      const startedWith = valueRef.current
      const provider = new CollabProvider({ url: collabUrl(pageId, apiValue('API_BASE_URL', '')), doc, getToken, ...providerOptions })
      const abort = (retryMs) => {
        if (attemptRef.current?.provider !== provider) return
        attemptRef.current = null
        provider.destroy()
        doc.destroy()
        if (retryMs != null) later(retryMs)
      }
      attemptRef.current = { provider, startedWith, abort }
      provider.on('synced', (ok) => {
        if (!ok || cancelled || attemptRef.current?.provider !== provider) return
        const server = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(FIELD))
        if (!sameDoc(server, valueRef.current) && savedRef.current && !savedRef.current()) {
          abort(1500)   // typed during the handshake: save that first
          return
        }
        attemptRef.current = null
        failuresRef.current = 0
        const ed = editorRef.current
        if (ed && !ed.isDestroyed) {
          const { from, to } = ed.state.selection
          pendingSelRef.current = { from, to, focused: ed.isFocused }
        }
        keyRef.current += 1
        setNote(n => (n === NOTES.reloaded ? n : null))
        setSession({ doc, provider, key: `live-${keyRef.current}` })
      })
      // These listeners stay on the provider once it becomes the session's;
      // from then on the session's own listeners answer for it.
      const mine = () => !cancelled && attemptRef.current?.provider === provider
      provider.on('error', (msg) => {
        if (!mine() || msg?.code !== 'too_large') return
        setNote(msg.mode === 'rest' ? NOTES.tooLargeLive : { tone: 'warn', text: msg.message || 'This document is too large to save.' })
      })
      provider.on('fatal', (code) => {
        if (!mine()) return
        abort(null)
        endFatal(code, go)
      })
      provider.on('status', ({ status }) => {
        if (!mine() || status !== 'disconnected' || provider.synced || provider.fatal) return
        failuresRef.current += 1
        go('offline')
        abort(Math.min(30000, 1000 * 2 ** Math.min(failuresRef.current, 5)))
      })
    }

    start()
    return () => {
      cancelled = true
      clearTimeout(timer)
      attemptRef.current?.abort(null)
    }
  }, [pageId, session, fatal]) // eslint-disable-line react-hooks/exhaustive-deps

  // Typing while an attempt is mid-handshake: drop it and let autosave run.
  useEffect(() => {
    const a = attemptRef.current
    if (a && !session && value !== a.startedWith) a.abort(1500)
  }, [value, session])

  // ── A live session ────────────────────────────────────────────────────────
  const endSession = useCallback((next, info) => {
    setSession(s => {
      if (s) setTimeout(() => { s.provider.destroy(); s.doc.destroy() }, 0)
      return null
    })
    setPeers([])
    go(next, info)
  }, [go])

  useEffect(() => {
    if (!session) return undefined
    const { provider, doc } = session
    let offlineTimer = null
    const refreshPeers = () => setPeers(peersOf(provider.awareness, doc.clientID))
    const onStatus = ({ status }) => {
      if (status === 'connected') return            // live once synced
      if (modeRef.current === 'live') go('reconnecting')
      if (!offlineTimer) {
        // Still no connection: hand the content back to ordinary saving.
        // What the server has not acknowledged is not synced.
        offlineTimer = setTimeout(() => go('offline', { contentSynced: false }), OFFLINE_AFTER_MS)
      }
    }
    const onSynced = (ok) => {
      if (!ok) return
      clearTimeout(offlineTimer)
      offlineTimer = null
      go('live')
    }
    // The server rebuilt its copy from the page (restart, version restore, a
    // save elsewhere). Edits it never received go out through ordinary saving;
    // otherwise the page reloads the server's copy by re-syncing.
    const onStale = () => {
      const unsynced = provider.unsynced
      if (!unsynced) setNote(NOTES.reloaded)
      endSession(unsynced ? 'offline' : 'connecting', { contentSynced: !unsynced })
    }
    const onFatal = (code) => endFatal(code, endSession)
    const onSaved = (at) => {
      setSavedAt(at)
      setNote(n => (n && n.tone === 'warn' && n !== NOTES.trashed && n !== NOTES.denied ? null : n))
    }
    const onError = (msg) => {
      if (msg?.code !== 'too_large') return
      if (msg.mode === 'rest') { setNote(NOTES.tooLargeLive); return }
      setNote({ tone: 'warn', text: msg.message || 'This document is too large to save. Remove some content to keep your changes.' })
    }
    provider.on('status', onStatus)
    provider.on('synced', onSynced)
    provider.on('stale', onStale)
    provider.on('fatal', onFatal)
    provider.on('saved', onSaved)
    provider.on('error', onError)
    provider.awareness.on('change', refreshPeers)
    refreshPeers()
    go('live')
    return () => {
      clearTimeout(offlineTimer)
      provider.off('status', onStatus)
      provider.off('synced', onSynced)
      provider.off('stale', onStale)
      provider.off('fatal', onFatal)
      provider.off('saved', onSaved)
      provider.off('error', onError)
      provider.awareness.off('change', refreshPeers)
    }
  }, [session, endSession, go, endFatal])

  const sessionRef = useRef(null)
  sessionRef.current = session

  // Edits the server has not taken: queued while reconnecting, or never sent.
  const unsyncedNow = useCallback(() => {
    const s = sessionRef.current
    if (!s) return false
    return s.provider.unsynced || modeRef.current === 'reconnecting'
  }, [])

  // Closing the tab with such edits asks first.
  useEffect(() => {
    if (!session) return undefined
    const onUnload = (e) => {
      if (!unsyncedNow()) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [session, unsyncedNow])

  // Report "no live session" when this editor goes away (and the mode again
  // if it comes back, as React's development double-mount does). Content the
  // live session never delivered is saved here, since no editor remains to
  // hand it to.
  useEffect(() => {
    if (modeRef.current !== 'off') modeChangeRef.current?.(modeRef.current, {})
    return () => {
      const s = sessionRef.current
      const unsynced = !!s && unsyncedNow()
      const content = unsynced ? latestContent() : null
      modeChangeRef.current?.('off', { contentSynced: modeRef.current === 'live' && !unsynced, content })
      if (unsynced && pageIdRef.current && content) {
        const update = apiValue('api', null)?.pages?.update
        if (typeof update === 'function') Promise.resolve().then(() => update(pageIdRef.current, { content })).catch(() => {})
      }
      // Close whatever is open, after the editor bound to it is gone.
      if (s) setTimeout(() => { s.provider.destroy(); s.doc.destroy() }, 0)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const restoreSelection = useCallback(() => {
    const sel = pendingSelRef.current
    const ed = editorRef.current
    pendingSelRef.current = null
    if (!sel || !ed || ed.isDestroyed) return
    const max = ed.state.doc.content.size
    try {
      ed.commands.setTextSelection({ from: Math.min(sel.from, max), to: Math.min(sel.to, max) })
      if (sel.focused) ed.commands.focus()
    } catch { /* positions no longer valid: leave the cursor where it is */ }
  }, [])

  const liveExtensions = useMemo(() => {
    if (!session) return null
    return [
      ...(extensions || []),
      Collaboration.configure({ document: session.doc, field: FIELD, onFirstRender: () => setTimeout(restoreSelection, 0) }),
      CollaborationCaret.configure({ provider: session.provider, user: session.provider.user || { name: 'Editor', color: '#2383e2' } }),
    ]
  }, [session]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleReady = useCallback((ed) => {
    editorRef.current = ed
    onReady?.(ed)
  }, [onReady])

  const bar = pageId ? <PresenceBar mode={mode} peers={peers} savedAt={savedAt} note={note} /> : null

  return (
    <>
      {bar && (presenceSlot ? createPortal(bar, presenceSlot) : <div className="ft-presence-row">{bar}</div>)}
      {session ? (
        <BlockEditor key={session.key} collaborative value={value} onChange={onChange} uploadImage={uploadImage} pageId={pageId}
          onReady={handleReady} commands={commands} extensions={liveExtensions} ariaLabel={ariaLabel} readOnly={readOnly} />
      ) : (
        <BlockEditor key={`plain-${keyRef.current}`} value={value} onChange={onChange} uploadImage={uploadImage} pageId={pageId}
          onReady={handleReady} commands={commands} extensions={extensions} ariaLabel={ariaLabel} readOnly={readOnly} />
      )}
    </>
  )
}
