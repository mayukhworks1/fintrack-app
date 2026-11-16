// The password part of a page's Share popover that needs the server: "Show
// password", the auto-approve email domains, and the page's access requests
// (people who asked for the password from the page's password screen).
import { useEffect, useState } from 'react'
import { Eye, EyeOff, Inbox } from 'lucide-react'
import { api } from '../../services/api'
import AccessRequestsPanel from '../share/AccessRequestsPanel'
import { CopyButton } from '../share/SharePasswordFields'

const labelStyle = { display:'block', fontSize:10, fontWeight:600, color:'var(--text-2)', marginBottom:3, textTransform:'uppercase', letterSpacing:'0.05em' }
const inputStyle = { display:'block', width:'100%', padding:'7px 10px', border:'1px solid var(--border)', borderRadius:'10px', background:'var(--card-bg)', color:'var(--text-1)', fontSize:13, outline:'none', boxSizing:'border-box' }
const btn = { border:'1px solid var(--border)', borderRadius:10, padding:'7px 12px', fontSize:12.5, fontWeight:600, cursor:'pointer', background:'var(--card-bg)', color:'var(--text-1)', display:'inline-flex', alignItems:'center', gap:6 }

export default function PageAccessSection({ pageId, openRequests = false, onPending }) {
  const [info, setInfo] = useState(null)
  const [shown, setShown] = useState(null)       // the revealed password
  const [pwMsg, setPwMsg] = useState('')
  const [domains, setDomains] = useState('')
  const [domMsg, setDomMsg] = useState('')
  const [showRequests, setShowRequests] = useState(openRequests)

  useEffect(() => {
    let live = true
    setShown(null); setPwMsg('')
    api.pages.access(pageId).then(res => {
      if (!live) return
      setInfo(res)
      setDomains((res?.auto_approve_domains || []).join(', '))
      onPending?.(res?.pending || 0)
    }).catch(() => {})
    return () => { live = false }
  }, [pageId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!info?.is_password_protected) return null

  const reveal = async () => {
    if (shown != null) { setShown(null); return }
    setPwMsg('')
    try { const res = await api.pages.revealPassword(pageId); setShown(res?.password || '') }
    catch (e) { setPwMsg(e?.message || 'Could not show the password') }
  }
  const saveDomains = async () => {
    setDomMsg('')
    try {
      const res = await api.pages.updateAccess(pageId, { auto_approve_domains: domains.split(/[\s,;]+/).filter(Boolean) })
      setDomains((res?.auto_approve_domains || []).join(', '))
      setDomMsg(res?.auto_approve_domains?.length ? 'Saved. Requests from these domains get the password at once.' : 'Saved. Every request waits for you.')
    } catch (e) { setDomMsg(e?.message || 'Could not save the domains') }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, paddingLeft:2 }} data-page-access="">
      <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
        <button type="button" style={btn} onClick={reveal} aria-pressed={shown != null}>
          {shown != null ? <EyeOff size={13} /> : <Eye size={13} />}{shown != null ? 'Hide password' : 'Show password'}
        </button>
        {shown != null && (
          <>
            <code style={{ flex:1, minWidth:0, fontSize:13, fontFamily:'monospace', padding:'6px 8px', borderRadius:8, background:'var(--card-bg)', border:'1px solid var(--border)', color:'var(--text-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{shown}</code>
            <CopyButton value={shown} />
          </>
        )}
      </div>
      {(pwMsg || info.password_stored === false) && (
        <div role="note" style={{ fontSize:11.5, lineHeight:1.5, color:'var(--text-2)', background:'color-mix(in srgb, var(--fin-warning) 8%, transparent)', borderRadius:8, padding:'6px 8px' }}>
          {pwMsg || 'This password was set before FinTrack kept a copy it can show or email. Set it again above so approved requests get it by email; until then, approve and share it yourself.'}
        </div>
      )}
      <div>
        <label style={labelStyle} htmlFor="ft-auto-domains">Auto-approve requests from (optional)</label>
        <div style={{ display:'flex', gap:6 }}>
          <input id="ft-auto-domains" style={{ ...inputStyle, flex:1, fontSize:12 }} placeholder="e.g. theworks.in, client.com"
            value={domains} onChange={e => setDomains(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveDomains() } }}
            aria-describedby="ft-auto-domains-hint" />
          <button type="button" style={btn} onClick={saveDomains}>Save</button>
        </div>
        <div id="ft-auto-domains-hint" role="status" style={{ fontSize:11, color:'var(--text-3)', marginTop:3 }}>
          {domMsg || 'Exact email domains only. Leave empty to approve every request yourself.'}
        </div>
      </div>
      <button type="button" onClick={() => setShowRequests(v => !v)} aria-expanded={showRequests}
        style={{ ...btn, justifyContent:'space-between', width:'100%' }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}><Inbox size={13} /> Access requests</span>
        {info.pending > 0 && <span style={{ fontSize:11, fontWeight:700, padding:'1px 7px', borderRadius:999, background:'var(--fin-warn-bg)', color:'var(--fin-warning)' }}>{info.pending} waiting</span>}
      </button>
      {showRequests && (
        <AccessRequestsPanel pageId={pageId} compact
          onPendingChange={(n) => { setInfo(i => ({ ...i, pending: n })); onPending?.(n) }} />
      )}
    </div>
  )
}
