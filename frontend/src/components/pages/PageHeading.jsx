import { useState } from 'react'
import { ImageIcon, Smile, X } from 'lucide-react'
import IconPicker from '../pagetree/IconPicker'
import { API_BASE_URL } from '../../services/api'

// A page's cover band and icon, above its title. Both are set through the
// page's appearance (icon/cover columns), so they exist once the page does.

// The same presets the database gallery draws (database/GalleryView).
const PRESETS = {
  sunrise: 'linear-gradient(135deg,#fde68a,#f97316)',
  ocean: 'linear-gradient(135deg,#93c5fd,#2563eb)',
  forest: 'linear-gradient(135deg,#86efac,#15803d)',
  dusk: 'linear-gradient(135deg,#c4b5fd,#7c3aed)',
  slate: 'linear-gradient(135deg,#cbd5e1,#475569)',
  rose: 'linear-gradient(135deg,#fbcfe8,#db2777)',
}
export const COVER_PRESETS = Object.keys(PRESETS)

export function coverBackground(cover, apiBase = '') {
  if (!cover) return null
  if (cover.startsWith('preset:')) return PRESETS[cover.slice(7)] || PRESETS.slate
  const url = cover.startsWith('/api/') ? `${apiBase}${cover}` : cover
  if (!/^https:\/\//.test(url) && !url.startsWith('/api/')) return null
  return `url("${url.replace(/["\\\n\r]/g, '')}")`
}

const linkBtn = { all:'unset', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5, padding:'3px 7px', borderRadius:6, fontSize:12, color:'var(--text-3)' }

export default function PageHeading({ icon, cover, title, canEdit, onChange, isMobile }) {
  const [iconOpen, setIconOpen] = useState(false)
  const [coverOpen, setCoverOpen] = useState(false)
  const bg = coverBackground(cover || '', API_BASE_URL)

  return (
    <div className="ft-page-heading">
      {bg && (
        <div role="img" aria-label="Page cover"
          style={{ position:'relative', height:isMobile ? 110 : 170, borderRadius:12, background:bg, backgroundSize:'cover', backgroundPosition:'center', marginBottom: icon ? -30 : 12 }}>
          {canEdit && (
            <div className="ft-cover-actions" style={{ position:'absolute', right:10, bottom:10, display:'flex', gap:6 }}>
              <button type="button" style={{ ...linkBtn, background:'rgba(0,0,0,0.45)', color:'#fff' }} onClick={() => setCoverOpen(o => !o)}>Change cover</button>
              <button type="button" aria-label="Remove cover" style={{ ...linkBtn, background:'rgba(0,0,0,0.45)', color:'#fff' }} onClick={() => onChange({ cover: '' })}><X size={12} /></button>
            </div>
          )}
        </div>
      )}
      {icon && (
        <button type="button" aria-label="Change icon" title={canEdit ? 'Change icon' : undefined} disabled={!canEdit}
          onClick={() => setIconOpen(true)}
          style={{ all:'unset', cursor:canEdit ? 'pointer' : 'default', fontSize:isMobile ? 40 : 54, lineHeight:1.1, position:'relative', display:'inline-block', marginBottom:6, borderRadius:10, padding:'0 2px' }}>
          {icon}
        </button>
      )}
      {canEdit && (!icon || !bg) && (
        <div className="ft-heading-adds" style={{ display:'flex', gap:4, marginBottom:4, marginLeft:-6 }}>
          {!icon && <button type="button" style={linkBtn} onClick={() => setIconOpen(true)}><Smile size={13} /> Add icon</button>}
          {!bg && <button type="button" style={linkBtn} onClick={() => setCoverOpen(o => !o)}><ImageIcon size={13} /> Add cover</button>}
        </div>
      )}
      {coverOpen && canEdit && (
        <div role="group" aria-label="Choose a cover" style={{ display:'flex', gap:6, flexWrap:'wrap', margin:'4px 0 10px' }}>
          {COVER_PRESETS.map(p => (
            <button key={p} type="button" aria-label={`Cover ${p}`} onClick={() => { onChange({ cover: `preset:${p}` }); setCoverOpen(false) }}
              style={{ width:54, height:30, borderRadius:7, cursor:'pointer', border:`2px solid ${cover === `preset:${p}` ? 'var(--accent)' : 'transparent'}`, background:coverBackground(`preset:${p}`) }} />
          ))}
        </div>
      )}
      <IconPicker open={iconOpen} title={title} current={icon} onPick={(e) => { setIconOpen(false); onChange({ icon: e }) }} onClose={() => setIconOpen(false)} />
    </div>
  )
}
