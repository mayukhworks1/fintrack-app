import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { GROUP_ORDER } from './commands'

/** The "/" command list. Arrow keys / Enter / Tab drive it from the editor;
 *  a tap or click runs an item directly. */
const SlashMenu = forwardRef(function SlashMenu({ items, command, query }, ref) {
  const [index, setIndex] = useState(0)
  const listRef = useRef(null)

  // Grouped while browsing; a flat ranked list once the author types a query.
  const sections = useMemo(() => {
    if (query) return [{ group: 'Results', items }]
    const by = new Map()
    for (const it of items) {
      if (!by.has(it.group)) by.set(it.group, [])
      by.get(it.group).push(it)
    }
    const order = [...GROUP_ORDER, ...[...by.keys()].filter(g => !GROUP_ORDER.includes(g))]
    return order.filter(g => by.has(g)).map(g => ({ group: g, items: by.get(g) }))
  }, [items, query])
  const flat = useMemo(() => sections.flatMap(s => s.items), [sections])

  useEffect(() => setIndex(0), [items])
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [index])

  const pick = (i) => { const it = flat[i]; if (it) command(it) }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!flat.length) return false
      if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) { setIndex(i => (i + 1) % flat.length); return true }
      if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) { setIndex(i => (i - 1 + flat.length) % flat.length); return true }
      if (event.key === 'Enter' || event.key === 'Tab') { pick(index); return true }
      return false
    },
  }), [flat, index]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!flat.length) {
    return <div className="ft-slash-empty">No matching blocks</div>
  }

  let n = -1
  return (
    <div className="ft-slash-list" ref={listRef} role="listbox" aria-label="Insert block">
      {sections.map(s => (
        <div key={s.group} role="group" aria-label={s.group}>
          <div className="ft-slash-group">{s.group}</div>
          {s.items.map(it => {
            n += 1
            const i = n
            const Icon = it.icon
            return (
              <button key={it.id} type="button" role="option" aria-selected={i === index} data-active={i === index}
                className="ft-slash-item" data-command={it.id}
                onMouseDown={e => e.preventDefault()}
                onMouseMove={() => { if (index !== i) setIndex(i) }}
                onClick={() => pick(i)}>
                <span className="ft-slash-icon">{Icon ? <Icon size={18} strokeWidth={1.75} /> : null}</span>
                <span className="ft-slash-text">
                  <span className="ft-slash-title">{it.title}</span>
                  <span className="ft-slash-desc">{it.description}</span>
                </span>
                {it.shortcut && <kbd className="ft-slash-kbd">{it.shortcut}</kbd>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
})

export default SlashMenu
