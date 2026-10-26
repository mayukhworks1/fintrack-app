import { useEffect, useState } from 'react'
import { initials } from './presence'

// Calm, specific wording: what is happening to the person's changes now.
const LABELS = {
  connecting:   { text: 'Connecting…', tone: 'wait', title: 'Opening a live session. Your changes save as usual meanwhile.' },
  live:         { text: 'Live', tone: 'live', title: 'Changes sync instantly to everyone on this page and save automatically.' },
  reconnecting: { text: 'Reconnecting…', tone: 'wait', title: 'The live connection dropped. Keep typing: your changes are kept here and sync when it is back.' },
  offline:      { text: 'Saving normally', tone: 'off', title: 'Live editing is paused. Your changes save to this page as usual, and live editing comes back on its own.' },
}
const NO_NETWORK = { text: 'Offline — changes save when you reconnect', tone: 'off', title: 'This device is offline. Keep working: your changes are kept here and saved once the connection is back.' }

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return online
}

const READ_ONLY = { text: 'Read only', tone: 'off', title: 'This page cannot be edited right now.' }

const MAX_AVATARS = 4

/**
 * The live-editing header: a connection chip, the people editing now, and a
 * note when something needs the reader's attention (the page went to the
 * trash, is too large to edit live, was reloaded).
 * `peers` are other editors ({ clientId, name, color }); `mode` is CollabDoc's.
 */
export function PresenceBar({ mode, peers = [], savedAt, note }) {
  const online = useOnline()
  const base = LABELS[mode]
  if (!base) return null
  const label = note?.lock ? READ_ONLY : !online && mode !== 'live' ? NO_NETWORK : base
  const shown = peers.slice(0, MAX_AVATARS)
  const more = peers.length - shown.length
  const savedTitle = mode === 'live' && savedAt ? ` Last saved ${new Date(savedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })} IST.` : ''
  return (
    <span className="ft-presence" data-mode={mode}>
      {peers.length > 0 && (
        <span className="ft-presence-avatars" role="list" aria-label={`${peers.length} other ${peers.length === 1 ? 'person' : 'people'} editing`}>
          {shown.map(p => (
            <span key={p.clientId} role="listitem" className="ft-presence-avatar" title={`${p.name} is editing`}
              style={{ background: p.color }} aria-label={p.name}>{initials(p.name)}</span>
          ))}
          {more > 0 && <span role="listitem" className="ft-presence-avatar ft-presence-more" title={peers.slice(MAX_AVATARS).map(p => p.name).join(', ')}>+{more}</span>}
        </span>
      )}
      <span className={`ft-presence-chip is-${label.tone}`} role="status" aria-live="polite" title={label.title + savedTitle}>
        <span className="ft-presence-dot" aria-hidden="true" />{label.text}
      </span>
      {note?.text && (
        <span className={`ft-presence-note is-${note.tone || 'info'}`} role={note.tone === 'warn' ? 'alert' : 'note'}>{note.text}</span>
      )}
    </span>
  )
}

export default PresenceBar
