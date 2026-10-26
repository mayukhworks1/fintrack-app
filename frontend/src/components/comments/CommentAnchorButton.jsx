// <CommentAnchorButton anchor={{ block_id, from, to, quote }} /> — for the
// block editor's selection toolbar or block menu. `anchor` may be a function,
// read when the composer opens (the selection at that moment). Opens a small composer and
// starts a thread pinned to that block/selection, then opens the comments
// panel on it. The page defaults to the one whose comments are on screen.
import { useEffect, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import MentionComposer from './MentionComposer'
import { CommentStyles } from './CommentBits'
import { useComments } from './useComments'
import { getActiveCommentsPage, openCommentsPanel } from './commentsModel'

export default function CommentAnchorButton({
  anchor, pageId, onCreated, label = 'Comment', compact = false, className = 'cmt-toggle', style, align = 'left',
}) {
  const pid = pageId || getActiveCommentsPage()
  const c = useComments(pid)
  const [open, setOpen] = useState(false)
  const [taken, setTaken] = useState(null)
  const wrap = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!pid) return null

  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-block' }}>
      <CommentStyles />
      <button type="button" className={className} style={style} aria-expanded={open}
        aria-label={compact ? label : undefined} title={label}
        onMouseDown={e => e.preventDefault() /* keep the editor's selection */}
        onClick={() => {
          if (!open) setTaken(typeof anchor === 'function' ? anchor() : anchor)
          setOpen(o => !o)
        }}>
        <MessageSquarePlus size={14} aria-hidden="true" />
        {!compact && <span>{label}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Comment on selection" style={{
          position: 'absolute', top: '100%', ...(align === 'right' ? { right: 0 } : { left: 0 }), marginTop: 6,
          width: 'min(300px, calc(100vw - 24px))', zIndex: 2200, padding: 10, textAlign: 'left',
          background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        }}>
          {taken?.quote && (
            <div className="cmt-quote" style={{ marginBottom: 8 }}>
              <span style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                “{taken.quote}”
              </span>
            </div>
          )}
          <MentionComposer compact autoFocus ariaLabel="Comment on selection" searchMentions={c.searchMentions}
            onCancel={() => setOpen(false)}
            onSubmit={async (body) => {
              const thread = await c.create(body, taken || null)
              setOpen(false)
              onCreated?.(thread)
              if (thread?.id) openCommentsPanel(pid, thread.id)
            }} />
        </div>
      )}
    </span>
  )
}
