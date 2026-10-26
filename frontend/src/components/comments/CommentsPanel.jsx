// The comments side panel for one page: open / resolved threads, a composer
// for page-level discussion, replies, edit/delete of one's own comments and
// resolve/reopen. Anchored threads (from the block editor) show the text they
// were left on and a "Go to" action that the editor handles.
import { memo, useEffect, useRef, useState } from 'react'
import { X, MessageSquare, CornerDownRight, Check, RotateCcw, LocateFixed } from 'lucide-react'
import { useComments } from './useComments'
import MentionComposer from './MentionComposer'
import { Avatar, CommentBody, CommentStyles } from './CommentBits'
import { emitCommentGoTo, fullIst, relativeIst } from './commentsModel'

// One clock for the whole panel: relative times move on once a minute.
function useMinute() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(iv)
  }, [])
  return now
}

// Threads drawn at a time; a page with hundreds of threads shows the newest.
const PAGE_SIZE = 30

function CommentItem({ comment, onEdit, onDelete, searchMentions, now }) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const name = comment.author?.name || 'Someone'
  return (
    <div className="cmt-item" style={{ display: 'flex', gap: 8, padding: '6px 0' }}>
      <Avatar person={comment.author} size={24} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>{name}</span>
          <time dateTime={comment.created_at} title={fullIst(comment.created_at)}
            style={{ fontSize: 11, color: 'var(--text-3)' }}>{relativeIst(comment.created_at, now)}</time>
          {comment.edited_at && !comment.deleted && (
            <span title={`Edited ${fullIst(comment.edited_at)}`} style={{ fontSize: 11, color: 'var(--text-3)' }}>(edited)</span>
          )}
        </div>
        {comment.deleted ? (
          <div style={{ fontSize: 12.5, fontStyle: 'italic', color: 'var(--text-3)' }}>Comment deleted</div>
        ) : editing ? (
          <div style={{ marginTop: 4 }}>
            <MentionComposer compact autoFocus initialBody={comment.body} submitLabel="Save" ariaLabel="Edit comment"
              searchMentions={searchMentions}
              onCancel={() => setEditing(false)}
              onSubmit={async (body) => { await onEdit(comment.id, body); setEditing(false) }} />
          </div>
        ) : (
          <CommentBody body={comment.body} />
        )}
        {comment.mine && !comment.deleted && !editing && (
          <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
            {confirming ? (
              <>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Delete this comment?</span>
                <button type="button" className="cmt-link" style={{ color: 'var(--fin-negative, #d70015)' }}
                  onClick={() => { setConfirming(false); onDelete(comment.id) }}>Delete</button>
                <button type="button" className="cmt-link" onClick={() => setConfirming(false)}>Keep</button>
              </>
            ) : (
              <>
                <button type="button" className="cmt-link" onClick={() => setEditing(true)}>Edit</button>
                <button type="button" className="cmt-link" onClick={() => setConfirming(true)}>Delete</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const ThreadCard = memo(function ThreadCard({ thread, pageId, focused, c, now }) {
  const [replying, setReplying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef(null)
  const resolved = !!thread.resolved_at

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [focused])

  const run = async (fn) => {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e?.message || 'Something went wrong') } finally { setBusy(false) }
  }

  return (
    <article ref={ref} aria-label={`Comment thread by ${thread.comments[0]?.author?.name || 'someone'}`}
      className={`cmt-thread ${focused ? 'is-focus' : ''} ${resolved ? 'is-resolved' : ''}`}
      data-thread-id={thread.id}>
      {thread.anchor && (
        <div className="cmt-quote">
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
            {thread.anchor.quote ? `“${thread.anchor.quote}”` : 'On a block in this page'}
          </span>
          <button type="button" className="cmt-link" title="Show where this comment was left"
            onClick={() => emitCommentGoTo({ pageId, threadId: thread.id, anchor: thread.anchor })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            <LocateFixed size={12} aria-hidden="true" /> Go to
          </button>
        </div>
      )}
      {thread.comments.map(cm => (
        <div key={cm.id} style={cm.id !== thread.id ? { paddingLeft: 14, borderLeft: '2px solid var(--border)', marginLeft: 10 } : undefined}>
          <CommentItem comment={cm} searchMentions={c.searchMentions} now={now}
            onEdit={c.edit} onDelete={(id) => run(() => c.remove(id))} />
        </div>
      ))}
      {resolved && (
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', margin: '2px 0 4px' }}>
          Resolved{thread.resolved_by?.name ? ` by ${thread.resolved_by.name}` : ''} · <span title={fullIst(thread.resolved_at)}>{relativeIst(thread.resolved_at, now)}</span>
        </div>
      )}
      {replying && (
        <div style={{ marginTop: 6 }}>
          <MentionComposer compact autoFocus submitLabel="Reply" ariaLabel="Reply"
            placeholder="Reply… type @ to mention" searchMentions={c.searchMentions}
            onCancel={() => setReplying(false)}
            onSubmit={async (body) => { await c.reply(thread.id, body); setReplying(false) }} />
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--fin-negative, #d70015)', marginTop: 4 }}>{error}</div>}
      {!replying && (
        <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
          <button type="button" className="cmt-link" onClick={() => setReplying(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CornerDownRight size={12} aria-hidden="true" /> Reply
          </button>
          {resolved ? (
            <button type="button" className="cmt-link" disabled={busy} onClick={() => run(() => c.reopen(thread.id))}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <RotateCcw size={12} aria-hidden="true" /> Reopen
            </button>
          ) : (
            <button type="button" className="cmt-link" disabled={busy} onClick={() => run(() => c.resolve(thread.id))}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Check size={12} aria-hidden="true" /> Resolve
            </button>
          )}
        </div>
      )}
    </article>
  )
})

const REFRESH_MS = 45_000

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
]

export default function CommentsPanel({ pageId, onClose, focusThreadId = null, style }) {
  const c = useComments(pageId)
  const [filter, setFilter] = useState('open')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const now = useMinute()

  // A thread asked for by a notification may be resolved: show it anyway.
  useEffect(() => {
    if (!focusThreadId) return
    const t = c.threads.find(x => x.id === focusThreadId)
    if (t?.resolved_at && filter === 'open') setFilter('all')
  }, [focusThreadId, c.threads]) // eslint-disable-line react-hooks/exhaustive-deps

  // While the panel is open, other people's comments arrive without a reload:
  // on returning to the tab, and every so often while it is visible.
  useEffect(() => {
    if (!pageId) return undefined
    const reload = c.reload
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    const iv = setInterval(() => { if (document.visibilityState !== 'hidden') reload() }, REFRESH_MS)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(iv)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pageId]) // eslint-disable-line react-hooks/exhaustive-deps

  const matching = c.threads.filter(t => filter === 'all' ? true : filter === 'open' ? !t.resolved_at : !!t.resolved_at)
  // A thread asked for by a notification is drawn even when further down.
  const focusAt = focusThreadId ? matching.findIndex(t => t.id === focusThreadId) : -1
  const shown = matching.slice(0, Math.max(limit, focusAt + 1))

  return (
    <aside aria-label="Comments" className="cmt-panel"
      onKeyDown={e => { if (e.key === 'Escape' && e.target === e.currentTarget) onClose?.() }}
      style={{
        display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', color: 'var(--text-1)',
        borderLeft: '1px solid var(--border)', minHeight: 0, ...style,
      }}>
      <CommentStyles />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 6px', flexShrink: 0 }}>
        <MessageSquare size={16} aria-hidden="true" style={{ color: 'var(--text-2)' }} />
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, flex: 1 }}>Comments</h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close comments" className="cmt-link" style={{ padding: 4 }}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div role="tablist" aria-label="Show threads" style={{ display: 'flex', gap: 2, padding: '0 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {FILTERS.map(f => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className="cmt-tab"
            onClick={() => { setFilter(f.key); setLimit(PAGE_SIZE) }}>
            {f.label}{f.key !== 'all' ? ` (${c.counts?.[f.key] ?? 0})` : ''}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        {!c.ready ? (
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>
            Comments switch on once the latest database update has run. Try again in a minute.
          </p>
        ) : (
          <MentionComposer searchMentions={c.searchMentions} ariaLabel="New comment"
            onSubmit={async (body) => { await c.create(body); setFilter(f => f === 'resolved' ? 'open' : f) }} />
        )}
        {c.error && <div role="alert" style={{ fontSize: 12, color: 'var(--fin-negative, #d70015)' }}>{c.error}</div>}
        {c.loading && !c.loaded && <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>Loading comments…</p>}
        {c.loaded && c.ready && shown.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '8px 0 0', textAlign: 'center' }}>
            {filter === 'resolved' ? 'No resolved threads yet.' : filter === 'open' ? 'No open comments. Start the discussion above.' : 'No comments yet.'}
          </p>
        )}
        {shown.map(t => (
          <ThreadCard key={t.id} thread={t} pageId={pageId} c={c.actions} now={now} focused={t.id === focusThreadId} />
        ))}
        {matching.length > shown.length && (
          <button type="button" className="cmt-link" style={{ alignSelf: 'center', padding: 6 }}
            onClick={() => setLimit(l => l + PAGE_SIZE)}>
            Show more ({matching.length - shown.length} more)
          </button>
        )}
      </div>
    </aside>
  )
}
