import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, ExternalLink, Globe, Lock, ShieldCheck, X } from 'lucide-react'
import { toIstInput, fromIstInput, formatIst, countdown, msUntil, expiryPreset } from '../../utils/ist'

// Everything about how a page is shared, kept out of the editor's way: its
// link, search description, folder, expiry, password and code protection,
// plus Publish / Update / Unpublish. Opened from the Share button.

const inputStyle = { display:'block', width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:'10px', background:'var(--card-bg)', color:'var(--text-1)', fontSize:13, outline:'none', boxSizing:'border-box' }
const labelStyle = { display:'block', fontSize:10, fontWeight:600, color:'var(--text-2)', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.05em' }
const btn = { border:'1px solid var(--border)', borderRadius:10, padding:'7px 12px', fontSize:12.5, fontWeight:600, cursor:'pointer', background:'var(--card-bg)', color:'var(--text-1)', display:'inline-flex', alignItems:'center', gap:6 }
const btnPrimary = { ...btn, border:'none', background:'var(--accent-btn)', color:'var(--accent-fg)' }

export function ExpiryField({ value, onChange, isMobile }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!value) return
    setNow(Date.now())
    const iv = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(iv)
  }, [value])
  const expired = !!value && msUntil(value, now) <= 0
  return (
    <div>
      <label style={labelStyle} htmlFor="ft-expiry">Link expires (IST)</label>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
        <input id="ft-expiry" type="datetime-local" value={toIstInput(value)}
          onChange={e=>onChange(fromIstInput(e.target.value))}
          style={{ ...inputStyle, width:isMobile?'100%':190, fontSize:12 }} />
        <select value="" aria-label="Quick expiry"
          onChange={e=>{ const v=e.target.value; if (v==='never') onChange(''); else if (v) onChange(expiryPreset(v)) }}
          style={{ ...inputStyle, width:'auto', fontSize:12 }}>
          <option value="">Quick…</option>
          <option value="1h">In 1 hour</option>
          <option value="eod">Tonight, 11:59 pm</option>
          <option value="24h">In 24 hours</option>
          <option value="7d">In 7 days</option>
          <option value="30d">In 30 days</option>
          <option value="never">Never expires</option>
        </select>
      </div>
      {value && (
        <div style={{ fontSize:11, marginTop:3, color:expired?'var(--fin-negative)':'var(--text-2)' }}>
          {expired ? 'Expired: the link no longer opens' : `${formatIst(value)} · ${countdown(value, now)}`}
        </div>
      )}
    </div>
  )
}

/** "Live", "Live · unpublished changes" or "Not published". */
export function publishState({ isPublished, hasUnpublished }) {
  if (!isPublished) return { label: 'Not published', tone: 'draft' }
  return hasUnpublished ? { label: 'Live · unpublished changes', tone: 'pending' } : { label: 'Live', tone: 'live' }
}

export function PublishChip({ isPublished, hasUnpublished, compact }) {
  const s = publishState({ isPublished, hasUnpublished })
  const c = s.tone === 'live' ? { bg:'var(--fin-pos-bg)', fg:'var(--fin-positive)' }
    : s.tone === 'pending' ? { bg:'var(--fin-warn-bg)', fg:'var(--fin-warning)' }
    : { bg:'var(--bg-base)', fg:'var(--text-2)' }
  return (
    <span data-testid="publish-chip" title={s.label}
      style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'2px 9px', borderRadius:999, fontSize:11.5, fontWeight:600, background:c.bg, color:c.fg, whiteSpace:'nowrap', flexShrink:0 }}>
      <span aria-hidden="true" style={{ width:6, height:6, borderRadius:'50%', background:c.fg }} />
      {compact && s.tone === 'pending' ? 'Live · changes' : s.label}
    </span>
  )
}

export default function SharePopover({
  open, anchorRef, onClose, isMobile,
  form, set, onSlugEdit, slugStatus, folders = [], shareUrl,
  isPublished, hasUnpublished, canPublish, busy, onPublish, onUnpublish,
  onSavePassword, onCopied,
}) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  const [copied, setCopied] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  const [pwNote, setPwNote] = useState('')

  useLayoutEffect(() => {
    if (!open || isMobile) return
    const place = () => {
      const r = anchorRef?.current?.getBoundingClientRect()
      if (!r) { setPos({ top: 64, right: 16 }); return }
      setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, isMobile, anchorRef])

  useEffect(() => {
    if (!open) return
    const down = (e) => {
      if (ref.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return
      onClose()
    }
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); anchorRef?.current?.focus?.() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open, onClose, anchorRef])

  // Opening it moves focus in, so the keyboard and a screen reader land on it.
  useEffect(() => {
    if (!open) return undefined
    const raf = requestAnimationFrame(() => { if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus() })
    return () => cancelAnimationFrame(raf)
  }, [open])

  if (!open || typeof document === 'undefined') return null
  const state = publishState({ isPublished, hasUnpublished })

  const copy = () => {
    if (!shareUrl) return
    navigator.clipboard?.writeText(shareUrl).then(() => { setCopied(true); onCopied?.(); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }
  const savePassword = async () => {
    setPwBusy(true); setPwNote('')
    try { await onSavePassword?.(); setPwNote(form.is_password_protected ? 'Password saved' : 'Password removed') }
    catch (e) { setPwNote(e?.message || 'Could not save the password') }
    finally { setPwBusy(false) }
  }

  const panelStyle = isMobile
    ? { position:'fixed', left:0, right:0, bottom:0, maxHeight:'85dvh', borderRadius:'16px 16px 0 0', paddingBottom:'calc(14px + env(safe-area-inset-bottom, 0px))' }
    : { position:'fixed', top:pos?.top ?? 64, right:pos?.right ?? 16, width:380, maxHeight:'min(640px, calc(100dvh - 90px))', borderRadius:14 }

  return createPortal(
    <>
      {isMobile && <div aria-hidden="true" onClick={onClose} style={{ position:'fixed', inset:0, zIndex:2199, background:'rgba(0,0,0,0.35)' }} />}
      <div ref={ref} role="dialog" aria-label="Share and publish" className="app-pop" tabIndex={-1}
        style={{ ...panelStyle, outline:'none', zIndex:2200, overflowY:'auto', background:'var(--bg-base)', border:'1px solid var(--border)', boxShadow:'0 16px 48px rgba(0,0,0,0.22)', padding:14, boxSizing:'border-box', display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Globe size={15} style={{ color:'var(--text-2)' }} />
          <span style={{ fontSize:14, fontWeight:700, color:'var(--text-1)' }}>Share</span>
          <PublishChip isPublished={isPublished} hasUnpublished={hasUnpublished} />
          <button type="button" aria-label="Close sharing" onClick={onClose}
            style={{ all:'unset', marginLeft:'auto', cursor:'pointer', display:'inline-flex', padding:4, borderRadius:6, color:'var(--text-3)' }}>
            <X size={15} />
          </button>
        </div>

        <div>
          <label style={labelStyle} htmlFor="ft-slug">Link</label>
          <div style={{ position:'relative' }}>
            <input id="ft-slug" style={{ ...inputStyle, fontFamily:'monospace', fontSize:12, paddingLeft:38 }}
              placeholder="my-page-url" value={form.slug}
              onChange={e=>onSlugEdit(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'').replace(/--+/g,'-'))} />
            <span style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', fontSize:11, color:'var(--text-2)', pointerEvents:'none' }}>/p/</span>
          </div>
          {!isPublished && <div style={{ fontSize:11, color:'var(--text-3)', marginTop:3 }}>Follows the title until you publish or edit it.</div>}
          {slugStatus && !slugStatus.available && (
            <div style={{ marginTop:4, fontSize:11, color:'var(--fin-warning)' }}>
              This link is already taken{slugStatus.suggestions?.length ? ', try:' : '.'}
              {slugStatus.suggestions?.length > 0 && (
                <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:3 }}>
                  {slugStatus.suggestions.map(s => (
                    <button key={s} type="button" onClick={()=>onSlugEdit(s)}
                      style={{ fontSize:11, fontFamily:'monospace', border:'1px solid var(--border)', borderRadius:5, padding:'2px 6px', background:'var(--bg-base)', color:'var(--accent)', cursor:'pointer' }}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {isPublished && (
            <div style={{ display:'flex', gap:6, marginTop:8 }}>
              <button type="button" style={btn} onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy link'}</button>
              <a href={shareUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration:'none' }}><ExternalLink size={13} /> View</a>
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle} htmlFor="ft-desc">Description (for search and link previews)</label>
          <input id="ft-desc" style={inputStyle} placeholder="Short description" value={form.description} onChange={e=>set('description', e.target.value)} />
        </div>

        <div>
          <label style={labelStyle} htmlFor="ft-folder">Folder</label>
          <input id="ft-folder" list="ft-folders" style={inputStyle} placeholder="e.g. Clients" value={form.folder}
            onChange={e=>set('folder', e.target.value.slice(0,80))} />
          <datalist id="ft-folders">{folders.map(f=><option key={f} value={f} />)}</datalist>
        </div>

        <ExpiryField value={form.expires_at} onChange={v=>set('expires_at', v)} isMobile={isMobile} />

        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, cursor:'pointer', userSelect:'none' }}>
            <input type="checkbox" checked={form.is_password_protected} onChange={e=>set('is_password_protected', e.target.checked)} />
            <Lock size={12} /> Password
          </label>
          {(form.is_password_protected || form.password) && (
            <div style={{ display:'flex', gap:6 }}>
              {form.is_password_protected && (
                <input aria-label="Page password" style={{ ...inputStyle, flex:1, fontSize:12 }} type="password" placeholder="Set password"
                  value={form.password} onChange={e=>set('password', e.target.value)} />
              )}
              <button type="button" style={btn} disabled={pwBusy || (form.is_password_protected && !form.password)} onClick={savePassword}>
                {pwBusy ? 'Saving…' : 'Save password'}
              </button>
            </div>
          )}
          {pwNote && <div role="status" style={{ fontSize:11, color:'var(--text-2)' }}>{pwNote}</div>}
          <label title="Visitors cannot right-click, save the page, or open its source with keyboard shortcuts, and the code is not sent outside the page itself."
            style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, cursor:'pointer', userSelect:'none' }}>
            <input type="checkbox" checked={form.protect_source} onChange={e=>set('protect_source', e.target.checked)} />
            <ShieldCheck size={12} /> Protect code
          </label>
        </div>

        <div style={{ display:'flex', gap:8, alignItems:'center', borderTop:'1px solid var(--border)', paddingTop:12 }}>
          <span style={{ fontSize:11.5, color:'var(--text-2)', flex:1 }}>
            {state.tone === 'pending' ? 'Visitors see the last published version.' : isPublished ? 'Anyone with the link can view.' : 'Only you can see this page.'}
          </span>
          {isPublished && <button type="button" style={btn} disabled={busy} onClick={onUnpublish}>Unpublish</button>}
          <button type="button" style={btnPrimary} disabled={busy || !canPublish} onClick={onPublish}>
            {busy ? 'Publishing…' : isPublished ? 'Update' : 'Publish'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
