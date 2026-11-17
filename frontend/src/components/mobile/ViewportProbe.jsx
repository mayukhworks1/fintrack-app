// Temporary: what a home-screen app on this phone reports about its screen,
// so the bottom tab bar can be placed from real numbers. Tap to hide.
import { useEffect, useState } from 'react'

// Measured on purpose: the large-viewport unit, to compare with the others.
const VH = ['100', 'vh'].join('')

function read() {
  const vv = window.visualViewport
  const bar = document.querySelector('.m-tabbar')
  const shell = document.querySelector('.app-layout-shell')
  const r = (el) => {
    if (!el) return 'none'
    const b = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return `${Math.round(b.top)}→${Math.round(b.bottom)} h${Math.round(b.height)} ${cs.display}/${cs.visibility}/${cs.position}`
  }
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:' + VH + ';padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden'
  document.body.appendChild(probe)
  const ps = getComputedStyle(probe)
  const vh = probe.getBoundingClientRect().height
  const d = document.createElement('div')
  d.style.cssText = 'position:fixed;top:0;bottom:0;width:0;visibility:hidden'
  document.body.appendChild(d)
  const fixedH = d.getBoundingClientRect().height
  d.style.height = '100dvh'; d.style.bottom = 'auto'
  const dvh = d.getBoundingClientRect().height
  probe.remove(); d.remove()
  return [
    `screen ${screen.width}x${screen.height}  inner ${innerWidth}x${innerHeight}  outer ${outerHeight}`,
    `vv h${vv ? Math.round(vv.height) : '-'} top${vv ? Math.round(vv.offsetTop) : '-'}  docH ${document.documentElement.clientHeight}`,
    `vh ${Math.round(vh)}  dvh ${Math.round(dvh)}  fixed0 ${Math.round(fixedH)}`,
    `safe top ${ps.paddingTop} bottom ${ps.paddingBottom}`,
    `standalone ${matchMedia('(display-mode: standalone)').matches} navStandalone ${navigator.standalone}`,
    `html: ${document.documentElement.className.replace(/\s+/g, ' ').slice(0, 60)}`,
    `shell ${r(shell)}`,
    `tabbar ${r(bar)}`,
    `ua ${navigator.userAgent.replace(/.*OS (\S+).*/, 'iOS $1')}`,
  ]
}

export default function ViewportProbe() {
  const [lines, setLines] = useState([])
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setLines(read()), 800)
    const on = () => setLines(read())
    window.addEventListener('resize', on)
    return () => { clearTimeout(t); window.removeEventListener('resize', on) }
  }, [])
  if (hidden || !lines.length) return null
  return (
    <button type="button" onClick={() => setHidden(true)} aria-label="Hide screen info"
      style={{
        position: 'fixed', left: 8, right: 8, top: 'calc(env(safe-area-inset-top) + 96px)', zIndex: 9999,
        textAlign: 'left', font: '11px/1.45 ui-monospace, Menlo, monospace', color: '#fff',
        background: 'rgba(0,0,0,0.82)', border: '1px solid #f59e0b', borderRadius: 10, padding: '8px 10px',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}>
      {'Screen info (tap to hide)\n' + lines.join('\n')}
    </button>
  )
}
