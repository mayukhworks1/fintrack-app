import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Y from 'yjs'
import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import BlockEditor from '../BlockEditor'
import { CollabProvider, collabUrl } from './provider'
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

  const go = useCallback((next, info = {}) => {
    if (modeRef.current === next) return
    modeRef.current = next
    setModeState(next)
    modeChangeRef.current?.(next, info)
  }, [])

  useEffect(() => {
    if (!pageId) go('off')
    else if (modeRef.current === 'off') go('connecting')
  }, [pageId, go])

  // Report "no live session" when this editor goes away (and the mode again
  // if it comes back, as React's development double-mount does).
  useEffect(() => {
    if (modeRef.current !== 'off') modeChangeRef.current?.(modeRef.current, {})
    return () => { modeChangeRef.current?.('off', { contentSynced: modeRef.current === 'live' }) }
  }, [])

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
        setSession({ doc, provider, key: `live-${keyRef.current}` })
      })
      provider.on('fatal', (code) => {
        abort(null)
        if (!cancelled) { setFatal(code); go('offline') }
      })
      provider.on('status', ({ status }) => {
        if (status !== 'disconnected' || provider.synced || provider.fatal) return
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
      if (!offlineTimer) offlineTimer = setTimeout(() => go('offline'), OFFLINE_AFTER_MS)
    }
    const onSynced = (ok) => {
      if (!ok) return
      clearTimeout(offlineTimer)
      offlineTimer = null
      go('live')
    }
    // The server rebuilt its copy from the page (restart, version restore, a
    // save while we were away). Edits it has seen are on the page already;
    // edits it has not go out through ordinary saving before re-syncing.
    const onStale = () => {
      const unsynced = provider.unsynced
      endSession(unsynced ? 'offline' : 'connecting', { contentSynced: !unsynced })
    }
    const onFatal = (code) => {
      setFatal(code)
      endSession('offline', { contentSynced: false })
    }
    const onSaved = (at) => setSavedAt(at)
    provider.on('status', onStatus)
    provider.on('synced', onSynced)
    provider.on('stale', onStale)
    provider.on('fatal', onFatal)
    provider.on('saved', onSaved)
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
      provider.awareness.off('change', refreshPeers)
    }
  }, [session, endSession, go])

  const sessionRef = useRef(null)
  sessionRef.current = session
  useEffect(() => () => {
    // Unmount: close whatever is open, after the editor bound to it is gone.
    const s = sessionRef.current
    if (s) setTimeout(() => { s.provider.destroy(); s.doc.destroy() }, 0)
  }, [])

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

  const bar = pageId ? <PresenceBar mode={mode} peers={peers} savedAt={savedAt} /> : null

  return (
    <>
      {bar && (presenceSlot ? createPortal(bar, presenceSlot) : <div className="ft-presence-row">{bar}</div>)}
      {session ? (
        <BlockEditor key={session.key} collaborative value={value} onChange={onChange} uploadImage={uploadImage}
          onReady={handleReady} commands={commands} extensions={liveExtensions} ariaLabel={ariaLabel} />
      ) : (
        <BlockEditor key={`plain-${keyRef.current}`} value={value} onChange={onChange} uploadImage={uploadImage}
          onReady={handleReady} commands={commands} extensions={extensions} ariaLabel={ariaLabel} />
      )}
    </>
  )
}
