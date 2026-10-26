// Small shared pieces for comments: avatar, body with mention chips, styles.
import { useAvatarSrc } from '../../hooks/useAvatarSrc'
import { initials, parseBody } from './commentsModel'

export function Avatar({ person, size = 26 }) {
  const src = useAvatarSrc(person?.avatar_url || null)
  const name = person?.name || 'Someone'
  const box = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  }
  if (src) return <img src={src} alt="" aria-hidden="true" style={{ ...box, objectFit: 'cover' }} />
  return (
    <span aria-hidden="true" style={{
      ...box, background: 'var(--avatar-gradient, linear-gradient(135deg,#6366f1,#0ea5e9))',
      color: 'var(--accent-fg, #fff)', fontSize: Math.max(9, Math.round(size * 0.38)), fontWeight: 700,
    }}>{initials(name)}</span>
  )
}

export function CommentBody({ body }) {
  return (
    <div className="cmt-body">
      {parseBody(body).map((part, i) => part.type === 'mention'
        ? <span key={i} className="cmt-mention" data-user-id={part.id}>@{part.name}</span>
        : <span key={i}>{part.text}</span>)}
    </div>
  )
}

export function CommentStyles() {
  return (
    <style>{`
.cmt-body { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.5; color: var(--text-1); }
.cmt-mention { display: inline-block; padding: 0 5px; border-radius: 6px; font-weight: 600;
  color: var(--accent-ink, var(--accent)); background: var(--accent-dim, rgba(0,113,227,0.1)); }
.cmt-btn-primary { border: none; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600;
  cursor: pointer; background: var(--accent-btn, var(--accent)); color: var(--accent-fg, #fff); }
.cmt-btn-primary:disabled { opacity: .5; cursor: default; }
.cmt-btn-ghost { border: 1px solid var(--border); border-radius: 8px; padding: 5px 10px; font-size: 12px;
  font-weight: 600; cursor: pointer; background: transparent; color: var(--text-2); }
.cmt-btn-ghost:hover { color: var(--text-1); border-color: var(--border-strong, var(--border)); }
.cmt-link { border: none; background: none; padding: 0; font-size: 12px; font-weight: 600; cursor: pointer;
  color: var(--text-2); }
.cmt-link:hover { color: var(--accent); }
.cmt-thread { border: 1px solid var(--border); border-radius: 12px; background: var(--card-bg); padding: 10px 12px; }
.cmt-thread.is-focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow, rgba(0,113,227,0.15)); }
.cmt-thread.is-resolved { opacity: .78; }
.cmt-quote { border-left: 3px solid var(--fin-warning, #f5a524); padding: 2px 8px; margin-bottom: 8px; font-size: 12px;
  color: var(--text-2); background: var(--bg-base); border-radius: 0 6px 6px 0; display: flex; gap: 8px; align-items: flex-start; }
.cmt-tab { border: none; background: none; padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
  color: var(--text-2); border-bottom: 2px solid transparent; }
.cmt-tab[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
.cmt-toggle { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 8px;
  background: transparent; color: var(--text-2); padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
.cmt-toggle[aria-pressed="true"] { color: var(--accent); border-color: var(--accent); }
.cmt-count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; font-size: 11px; line-height: 18px;
  text-align: center; background: var(--accent); color: var(--accent-fg, #fff); }
`}</style>
  )
}
