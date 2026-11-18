// Temporary: why the phone tab bar isn't showing in the home-screen app.
// Reports what is actually at the bottom of the screen. Tap to hide.
import { useEffect, useState } from 'react'

function describe(el) {
  if (!el) return 'nothing'
  const id = el.id ? '#' + el.id : ''
  const cls = typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
  return `${el.tagName.toLowerCase()}${id}${cls}`
}

function read() {
  const bar = document.querySelector('.m-tabbar')
  const out = []
  const js = [...document.scripts].map(s => s.src).find(s => /index-/.test(s)) || ''
  out.push(`build ${js.split('/').pop()}`)
  out.push(`inner ${innerWidth}x${innerHeight} html.${document.documentElement.className}`)
  if (!bar) { out.push('tabbar: NOT IN PAGE'); return out }
  const cs = getComputedStyle(bar)
  const r = bar.getBoundingClientRect()
  out.push(`tabbar ${Math.round(r.top)}-${Math.round(r.bottom)} w${Math.round(r.width)} parent ${describe(bar.parentElement)}`)
  out.push(`disp ${cs.display} vis ${cs.visibility} op ${cs.opacity} z ${cs.zIndex} pos ${cs.position}`)
  out.push(`bg ${cs.backgroundColor} tabs ${bar.children.length}`)
  const y = Math.min(innerHeight - 2, Math.round(r.top + 20))
  const hit = document.elementFromPoint(innerWidth / 2, y)
  out.push(`at bottom (${y}): ${describe(hit)}`)
  out.push(`inside bar: ${bar.contains(hit)}`)
  return out
}

export default function TabBarProbe() {
  const [lines, setLines] = useState([])
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const a = setTimeout(() => setLines(read()), 1000)
    const b = setTimeout(() => setLines(read()), 4000)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [])
  if (hidden || !lines.length) return null
  return (
    <button type="button" onClick={() => setHidden(true)} aria-label="Hide tab bar info"
      style={{
        position: 'fixed', left: 8, right: 8, top: 110, zIndex: 9999, textAlign: 'left',
        font: '11px/1.45 ui-monospace, Menlo, monospace', color: '#fff', background: 'rgba(0,0,0,0.85)',
        border: '1px solid #f59e0b', borderRadius: 10, padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}>
      {'Tab bar info (tap to hide)\n' + lines.join('\n')}
    </button>
  )
}
