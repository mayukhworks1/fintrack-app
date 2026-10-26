import { initials } from './presence'

const LABELS = {
  connecting:   { text: 'Connecting…', tone: 'wait', title: 'Opening a live session. Changes save normally meanwhile.' },
  live:         { text: 'Live', tone: 'live', title: 'Changes sync instantly to everyone on this page and save automatically.' },
  reconnecting: { text: 'Reconnecting…', tone: 'wait', title: 'The live connection dropped. Keep typing — your changes sync when it is back.' },
  offline:      { text: 'Offline — saving normally', tone: 'off', title: 'Live editing is unavailable. Your changes are saved the usual way.' },
}

const MAX_AVATARS = 4

/**
 * The live-editing header: a connection chip and the people editing now.
 * `peers` are other editors ({ clientId, name, color }); `mode` is CollabDoc's.
 */
export function PresenceBar({ mode, peers = [], savedAt }) {
  const label = LABELS[mode]
  if (!label) return null
  const shown = peers.slice(0, MAX_AVATARS)
  const more = peers.length - shown.length
  const savedTitle = mode === 'live' && savedAt ? ` Last saved ${new Date(savedAt).toLocaleTimeString()}.` : ''
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
    </span>
  )
}

export default PresenceBar
