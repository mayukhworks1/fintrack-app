// The notification bell: unread badge, a dropdown of recent mentions and
// replies, mark one / all read. Opening one takes you to the page with its
// comments panel open on the thread.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import {
  loadNotifications, markAllNotificationsRead, markNotificationRead, useNotifications,
} from './notificationStore'
import { Avatar } from '../comments/CommentBits'
import { fullIst, openCommentsPanel, relativeIst } from '../comments/commentsModel'

function verb(kind) {
  if (kind === 'mention') return 'mentioned you on'
  if (kind === 'reply') return 'replied on'
  return 'commented on'
}

export function notificationHref(n) {
  if (!n?.page_id) return '/pages'
  const q = new URLSearchParams({ page: n.page_id, comments: '1' })
  if (n.thread_id) q.set('thread', n.thread_id)
  return `/pages?${q}`
}

function Dropdown({ anchorRect, variant, onClose }) {
  const s = useNotifications()
  const navigate = useNavigate()
  const ref = useRef(null)

  useEffect(() => { loadNotifications() }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('[data-notification-bell]')) onClose() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [onClose])

  const width = Math.min(360, (typeof window !== 'undefined' ? window.innerWidth : 400) - 16)
  const pos = variant === 'sidebar' && anchorRect && anchorRect.right + width + 16 < window.innerWidth
    ? { left: anchorRect.right + 8, bottom: Math.max(8, window.innerHeight - anchorRect.bottom) }
    : { right: 8, top: (anchorRect?.bottom || 48) + 6 }

  const open = (n) => {
    markNotificationRead(n.id)
    onClose()
    if (n.page_id) openCommentsPanel(n.page_id, n.thread_id || null)
    navigate(notificationHref(n))
  }

  return (
    <div ref={ref} role="dialog" aria-label="Notifications" style={{
      position: 'fixed', ...pos, width, maxHeight: 'min(520px, calc(100dvh - 24px))', zIndex: 2500,
      display: 'flex', flexDirection: 'column', background: 'var(--card-bg)', color: 'var(--text-1)',
      border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 18px 48px rgba(0,0,0,0.22)', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, flex: 1 }}>Notifications</h2>
        <button type="button" onClick={markAllNotificationsRead} disabled={!s.count}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', cursor: s.count ? 'pointer' : 'default', fontSize: 12, fontWeight: 600, color: s.count ? 'var(--accent)' : 'var(--text-3)' }}>
          <CheckCheck size={13} aria-hidden="true" /> Mark all read
        </button>
      </div>
      <div style={{ overflowY: 'auto' }}>
        {s.loading && !s.loaded && <p style={{ margin: 0, padding: 16, fontSize: 13, color: 'var(--text-2)' }}>Loading…</p>}
        {s.error && <p role="alert" style={{ margin: 0, padding: 16, fontSize: 13, color: 'var(--fin-negative, #d70015)' }}>{s.error}</p>}
        {s.loaded && !s.error && s.items.length === 0 && (
          <p style={{ margin: 0, padding: '24px 16px', fontSize: 13, color: 'var(--text-2)', textAlign: 'center' }}>
            You're all caught up. Mentions and replies on pages show up here.
          </p>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {s.items.map(n => (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} data-unread={!n.read}
                style={{
                  display: 'flex', gap: 10, width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none',
                  borderBottom: '1px solid var(--border)', cursor: 'pointer', color: 'inherit',
                  background: n.read ? 'transparent' : 'var(--accent-dim, rgba(0,113,227,0.06))',
                }}>
                <Avatar person={n.actor} size={28} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, lineHeight: 1.4 }}>
                    <strong>{n.actor?.name || 'Someone'}</strong> {verb(n.kind)} <strong>{n.page_title || 'Untitled'}</strong>
                  </span>
                  {n.excerpt && (
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.excerpt}
                    </span>
                  )}
                  <time dateTime={n.created_at} title={fullIst(n.created_at)} style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {relativeIst(n.created_at)}
                  </time>
                </span>
                {!n.read && <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', marginTop: 6, flexShrink: 0 }} />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * variant "sidebar": a nav row for the app sidebar (collapsible).
 * variant "icon": a compact icon button for the mobile top bar.
 */
export default function NotificationBell({ variant = 'sidebar', collapsed = false }) {
  const { count } = useNotifications()
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const btn = useRef(null)

  useLayoutEffect(() => {
    if (open && btn.current) setRect(btn.current.getBoundingClientRect())
  }, [open])

  const badge = count > 0 && (
    <span data-testid="notification-badge" aria-hidden="true" style={{
      position: variant === 'sidebar' && !collapsed ? 'static' : 'absolute',
      top: -4, right: -6, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, fontSize: 10, fontWeight: 700,
      lineHeight: '16px', textAlign: 'center', background: 'var(--fin-negative, #e5484d)', color: '#fff',
      marginLeft: variant === 'sidebar' && !collapsed ? 'auto' : 0,
    }}>{count > 99 ? '99+' : count}</span>
  )
  const label = `Notifications${count ? ` (${count} unread)` : ''}`

  return (
    <>
      {variant === 'sidebar' ? (
        <button ref={btn} type="button" data-notification-bell onClick={() => setOpen(o => !o)}
          className={`runey-nav-link ${collapsed ? 'is-collapsed' : ''}`}
          aria-label={label} aria-expanded={open} aria-haspopup="dialog" title={collapsed ? label : undefined}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Bell size={15} aria-hidden="true" />
            {collapsed && badge}
          </span>
          {!collapsed && <span className="flex-1 truncate font-medium">Notifications</span>}
          {!collapsed && badge}
        </button>
      ) : (
        <button ref={btn} type="button" data-notification-bell onClick={() => setOpen(o => !o)}
          className="btn-icon" aria-label={label} aria-expanded={open} aria-haspopup="dialog"
          style={{ padding: '0.375rem', position: 'relative' }}>
          <Bell size={16} aria-hidden="true" />
          {badge}
        </button>
      )}
      {open && typeof document !== 'undefined' && createPortal(
        <Dropdown anchorRect={rect} variant={variant} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  )
}
