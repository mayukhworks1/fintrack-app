// The "Comments (n)" button for the page editor's header, and the side panel
// it opens. The panel is portalled to <body> so it sits beside the editor
// drawer whatever the drawer's layout. It also opens on request: from a
// notification (openCommentsPanel before navigating) or from the block editor.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare } from 'lucide-react'
import CommentsPanel from './CommentsPanel'
import { CommentStyles } from './CommentBits'
import { useComments } from './useComments'
import { COMMENTS_OPEN_EVENT, claimPendingOpen, setActiveCommentsPage } from './commentsModel'
import { api } from '../../services/api'
import { refreshUnread } from '../notifications/notificationStore'

export default function CommentsToggle({ pageId, compact = false, defaultOpen = false }) {
  const { counts } = useComments(pageId)
  const [open, setOpen] = useState(defaultOpen)
  const [focusThreadId, setFocusThreadId] = useState(null)

  useEffect(() => {
    setActiveCommentsPage(pageId)
    const pending = claimPendingOpen(pageId)
    if (pending) { setOpen(true); setFocusThreadId(pending.threadId || null) }
    const onOpen = (e) => {
      if (e.detail?.pageId !== pageId) return
      claimPendingOpen(pageId)
      setOpen(true)
      setFocusThreadId(e.detail?.threadId || null)
    }
    window.addEventListener(COMMENTS_OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener(COMMENTS_OPEN_EVENT, onOpen)
      setActiveCommentsPage(null)
    }
  }, [pageId])

  // Reading a page's comments reads its notifications.
  useEffect(() => {
    if (!open || !pageId) return
    Promise.resolve(api.notifications?.markAllRead?.(pageId)).then(() => refreshUnread()).catch(() => {})
  }, [open, pageId])

  if (!pageId) return null
  const n = counts?.open || 0
  const panel = open && typeof document !== 'undefined' && createPortal(
    <div className="cmt-dock" style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(380px, 100vw)', zIndex: 2100,
      boxShadow: '-8px 0 32px rgba(0,0,0,0.18)', display: 'flex',
      paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      background: 'var(--bg-base)', boxSizing: 'border-box',
    }} onClick={e => e.stopPropagation()}>
      <CommentsPanel pageId={pageId} focusThreadId={focusThreadId}
        onClose={() => { setOpen(false); setFocusThreadId(null) }} style={{ flex: 1, width: '100%' }} />
    </div>,
    document.body,
  )

  return (
    <>
      <CommentStyles />
      <button type="button" className="cmt-toggle" aria-pressed={open}
        aria-label={`Comments${n ? ` (${n} open)` : ''}`} title="Comments"
        onClick={() => { setOpen(o => !o); setFocusThreadId(null) }}>
        <MessageSquare size={14} aria-hidden="true" />
        {!compact && <span>Comments</span>}
        {n > 0 && <span className="cmt-count" aria-hidden="true">{n > 99 ? '99+' : n}</span>}
      </button>
      {panel}
    </>
  )
}
