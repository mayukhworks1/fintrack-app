// Floating pieces of the sheet editor: the right-click / toolbar menus and the
// formula autocomplete. Both render into <body> so the page drawer's overflow
// and stacking never clip them.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { FUNCTION_HELP } from '../../utils/sheet'
import { splitSignature } from './editorModel'

const portal = node => (typeof document === 'undefined' ? node : createPortal(node, document.body))

function placeWithin(el, x, y) {
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(8, Math.min(x, vw - r.width - 8))
  const top = Math.max(8, Math.min(y, vh - r.height - 8))
  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

/**
 * A keyboard-driven menu. `items` are { label, icon, shortcut, onSelect,
 * disabled, checked } or 'sep'. Arrow keys move, Enter or Space picks,
 * Escape and Tab close; a click outside closes it too.
 */
export function SheetMenu({ x, y, items, label, onClose, focusFirst = true }) {
  const ref = useRef(null)
  const enabled = items.map((it, i) => (it !== 'sep' && !it.disabled ? i : -1)).filter(i => i >= 0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    placeWithin(el, x, y)
    const first = focusFirst && el.querySelector('[role^="menuitem"]:not([disabled])')
    ;(first || el).focus({ preventScroll: true })
  }, [x, y]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const away = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const blur = () => onClose()
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', blur)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', blur)
    }
  }, [onClose])

  const pick = (it) => {
    if (!it || it === 'sep' || it.disabled) return
    onClose()
    it.onSelect()
  }

  const onKeyDown = (e) => {
    const nodes = [...ref.current.querySelectorAll('[role^="menuitem"]')]
    const at = nodes.indexOf(document.activeElement)
    const pos = enabled.indexOf(Number(nodes[at]?.dataset.i))
    const go = i => nodes.find(n => Number(n.dataset.i) === enabled[(i + enabled.length) % enabled.length])?.focus()
    if (e.key === 'ArrowDown') { e.preventDefault(); go(pos + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(pos < 0 ? -1 : pos - 1) }
    else if (e.key === 'Home') { e.preventDefault(); go(0) }
    else if (e.key === 'End') { e.preventDefault(); go(-1) }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onClose() }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(items[Number(nodes[at]?.dataset.i)])
    }
  }

  return portal(
    <div ref={ref} role="menu" aria-label={label} className="ft-sheet-menu" style={{ left: x, top: y }} tabIndex={-1}
      onKeyDown={onKeyDown} onContextMenu={e => e.preventDefault()}>
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="ft-sheet-msep" role="separator" />
        const Icon = it.icon
        const checkable = it.checked !== undefined
        return (
          <button key={i} type="button" data-i={i} tabIndex={-1}
            role={checkable ? 'menuitemradio' : 'menuitem'} aria-checked={checkable ? !!it.checked : undefined}
            disabled={it.disabled} className="ft-sheet-mi" onClick={() => pick(it)}>
            <span className="ft-sheet-mi-icon" aria-hidden="true">
              {checkable ? (it.checked ? <Check size={14} /> : null) : Icon ? <Icon size={14} /> : null}
            </span>
            <span>{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Function suggestions under the cell being edited (↑/↓ to move, Enter or Tab
 * to pick), or, inside a function's brackets, its signature with the current
 * argument in bold.
 */
export function FormulaPopup({ anchor, suggest, index, hint, onPick, onHover }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    setPos(p => (p && p.x === r.left && p.y === r.bottom ? p : { x: r.left, y: r.bottom }))
  })

  useLayoutEffect(() => {
    if (ref.current && pos) placeWithin(ref.current, pos.x, pos.y + 2)
  }, [pos, suggest, hint])

  if (!anchor || !pos || (!suggest && !hint)) return null
  if (suggest) {
    const current = suggest.matches[Math.min(index, suggest.matches.length - 1)]
    const help = FUNCTION_HELP[current]
    return portal(
      <div ref={ref} className="ft-sheet-ac" style={{ left: pos.x, top: pos.y + 2 }} onMouseDown={e => e.preventDefault()}>
        <div role="listbox" aria-label="Functions" id="ft-sheet-ac-list">
          {suggest.matches.map((name, i) => (
            <div key={name} id={`ft-sheet-ac-${name}`} role="option" aria-selected={name === current}
              className="ft-sheet-ac-item" onMouseEnter={() => onHover(i)} onClick={() => onPick(name)}>
              <b>{name}</b>
              <span className="ft-sheet-ac-sig">{FUNCTION_HELP[name]?.sig.slice(name.length)}</span>
            </div>
          ))}
        </div>
        {help && <div className="ft-sheet-ac-desc">{help.desc}</div>}
      </div>
    )
  }
  const help = FUNCTION_HELP[hint.name]
  const { name, args } = splitSignature(help.sig)
  const at = Math.min(hint.arg, args.length - 1)
  return portal(
    <div ref={ref} className="ft-sheet-ac is-hint" style={{ left: pos.x, top: pos.y + 2 }} role="tooltip">
      <div className="ft-sheet-ac-item">
        <span>
          <b>{name}</b>(
          {args.map((a, i) => (
            <span key={i}>{i > 0 && ', '}{i === at ? <b className="ft-sheet-ac-arg">{a}</b> : a}</span>
          ))})
        </span>
      </div>
      <div className="ft-sheet-ac-desc">{help.desc}</div>
    </div>
  )
}
