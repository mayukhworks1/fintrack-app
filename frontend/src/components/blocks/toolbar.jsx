import { useEffect, useRef, useState } from 'react'
import { useEditorState } from '@tiptap/react'
import {
  Bold, Italic, Underline, Strikethrough, Code2, Link2, Unlink, Baseline, ChevronDown, Check,
  Trash2, CopyPlus, ArrowUp, ArrowDown, Plus, Minus, Table as TableIcon,
} from 'lucide-react'
import { COLORS } from './palette'
import { TURN_INTO } from './commands'
import { safeHref } from './embeds'
import CommentAnchorButton from '../comments/CommentAnchorButton'

const stop = (e) => e.preventDefault()

function Btn({ label, active, onClick, children, className = '' }) {
  return (
    <button type="button" className={`ft-tb-btn ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label}
      aria-pressed={active === undefined ? undefined : !!active} onMouseDown={stop} onClick={onClick}>
      {children}
    </button>
  )
}

function useOutside(open, ref, close) {
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (!ref.current?.contains(e.target)) close() }
    document.addEventListener('pointerdown', h, true)
    return () => document.removeEventListener('pointerdown', h, true)
  }, [open, ref, close])
}

/** Link field shared by the toolbar and Cmd/Ctrl+K. */
export function LinkField({ editor, onDone }) {
  const current = editor.getAttributes('link').href || ''
  const [v, setV] = useState(current)
  const [bad, setBad] = useState(false)
  const apply = (e) => {
    e?.preventDefault()
    let url = v.trim()
    if (!url) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onDone(); return }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('/') && !url.startsWith('#')) url = `https://${url}`
    if (!safeHref(url)) { setBad(true); return }
    const { empty } = editor.state.selection
    if (empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({ type: 'text', text: v.trim(), marks: [{ type: 'link', attrs: { href: url } }] }).run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
    onDone()
  }
  return (
    <form className="ft-link-form" onSubmit={apply}>
      <input autoFocus value={v} placeholder="Paste or type a link…" aria-label="Link URL" aria-invalid={bad}
        onChange={e => { setV(e.target.value); setBad(false) }}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onDone(); editor.commands.focus() } }} />
      <button type="submit" className="ft-tb-btn ft-tb-text">Apply</button>
      {current && (
        <button type="button" className="ft-tb-btn" aria-label="Remove link" title="Remove link" onMouseDown={stop}
          onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onDone() }}><Unlink size={15} /></button>
      )}
    </form>
  )
}

function TurnInto({ editor }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useOutside(open, ref, () => setOpen(false))
  const current = TURN_INTO.find(t => t.active?.(editor))?.label || 'Text'
  return (
    <div className="ft-tb-menuwrap" ref={ref}>
      <button type="button" className="ft-tb-btn ft-tb-text" aria-haspopup="menu" aria-expanded={open} onMouseDown={stop} onClick={() => setOpen(o => !o)}>
        {current} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="ft-pop ft-menu" role="menu" aria-label="Turn into">
          <div className="ft-menu-label">Turn into</div>
          {TURN_INTO.map(t => (
            <button key={t.id} type="button" role="menuitem" className="ft-menu-item" onMouseDown={stop}
              onClick={() => { t.run(editor); setOpen(false) }}>
              <span>{t.label}</span>{t.label === current && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ColorMenu({ editor }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useOutside(open, ref, () => setOpen(false))
  const text = editor.getAttributes('textColor').color
  const bg = editor.getAttributes('highlight').color || (editor.isActive('highlight') ? 'yellow' : null)
  return (
    <div className="ft-tb-menuwrap" ref={ref}>
      <button type="button" className="ft-tb-btn" aria-label="Text colour" title="Text colour" aria-haspopup="menu" aria-expanded={open}
        onMouseDown={stop} onClick={() => setOpen(o => !o)}>
        <span className="ft-color-a" data-color={text || undefined} data-bg={bg || undefined}><Baseline size={16} /></span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="ft-pop ft-menu ft-color-menu" role="menu" aria-label="Colour">
          <div className="ft-menu-label">Text colour</div>
          <div className="ft-swatches">
            <button type="button" className="ft-swatch" aria-label="Default text colour" aria-pressed={!text} onMouseDown={stop}
              onClick={() => { editor.chain().focus().unsetTextColor().run(); setOpen(false) }}><span>A</span></button>
            {COLORS.map(c => (
              <button key={c.key} type="button" className="ft-swatch" data-color={c.key} aria-label={`${c.label} text`} title={c.label}
                aria-pressed={text === c.key} onMouseDown={stop}
                onClick={() => { editor.chain().focus().setTextColor(c.key).run(); setOpen(false) }}><span>A</span></button>
            ))}
          </div>
          <div className="ft-menu-label">Background</div>
          <div className="ft-swatches">
            <button type="button" className="ft-swatch ft-swatch-bg" aria-label="No background" aria-pressed={!bg} onMouseDown={stop}
              onClick={() => { editor.chain().focus().unsetHighlight().run(); setOpen(false) }}><span>A</span></button>
            {COLORS.map(c => (
              <button key={c.key} type="button" className="ft-swatch ft-swatch-bg" data-bg={c.key} aria-label={`${c.label} background`} title={c.label}
                aria-pressed={bg === c.key} onMouseDown={stop}
                onClick={() => { editor.chain().focus().setHighlight({ color: c.key }).run(); setOpen(false) }}><span>A</span></button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Floating toolbar over a text selection. */
export function BubbleToolbar({ editor, linkOpen, setLinkOpen, commentPageId }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'),
      strike: e.isActive('strike'), code: e.isActive('code'), link: e.isActive('link'),
      sel: `${e.state.selection.from}:${e.state.selection.to}`,
    }),
  })
  if (linkOpen) return <LinkField editor={editor} onDone={() => setLinkOpen(false)} />
  return (
    <div className="ft-tb-row">
      <TurnInto editor={editor} />
      <span className="ft-tb-sep" />
      <Btn label="Bold (Ctrl+B)" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></Btn>
      <Btn label="Italic (Ctrl+I)" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></Btn>
      <Btn label="Underline (Ctrl+U)" active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={15} /></Btn>
      <Btn label="Strikethrough" active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></Btn>
      <Btn label="Inline code" active={s.code} onClick={() => editor.chain().focus().toggleCode().run()}><Code2 size={15} /></Btn>
      <Btn label="Link (Ctrl+K)" active={s.link} onClick={() => setLinkOpen(true)}><Link2 size={15} /></Btn>
      <span className="ft-tb-sep" />
      <ColorMenu editor={editor} />
      {commentPageId && (
        <>
          <span className="ft-tb-sep" />
          <CommentAnchorButton pageId={commentPageId} className="ft-tb-btn ft-tb-text ft-tb-comment" label="Comment" align="right"
            anchor={() => {
              const { from, to } = editor.state.selection
              return { from, to, quote: editor.state.doc.textBetween(from, to, ' ').slice(0, 280) }
            }} />
        </>
      )}
    </div>
  )
}

/** Row/column controls while the cursor is in a table. */
export function TableToolbar({ editor }) {
  const run = (fn) => () => fn(editor.chain().focus()).run()
  return (
    <div className="ft-tb-row ft-table-tb" role="toolbar" aria-label="Table">
      <span className="ft-tb-icon" aria-hidden="true"><TableIcon size={14} /></span>
      <Btn label="Add row above" onClick={run(c => c.addRowBefore())}><Plus size={13} /><span className="ft-tb-mini">Row ↑</span></Btn>
      <Btn label="Add row below" onClick={run(c => c.addRowAfter())}><Plus size={13} /><span className="ft-tb-mini">Row ↓</span></Btn>
      <Btn label="Add column left" onClick={run(c => c.addColumnBefore())}><Plus size={13} /><span className="ft-tb-mini">Col ←</span></Btn>
      <Btn label="Add column right" onClick={run(c => c.addColumnAfter())}><Plus size={13} /><span className="ft-tb-mini">Col →</span></Btn>
      <span className="ft-tb-sep" />
      <Btn label="Delete row" onClick={run(c => c.deleteRow())}><Minus size={13} /><span className="ft-tb-mini">Row</span></Btn>
      <Btn label="Delete column" onClick={run(c => c.deleteColumn())}><Minus size={13} /><span className="ft-tb-mini">Col</span></Btn>
      <Btn label="Toggle header row" onClick={run(c => c.toggleHeaderRow())}><span className="ft-tb-mini">Header</span></Btn>
      <span className="ft-tb-sep" />
      <Btn label="Delete table" className="is-danger" onClick={run(c => c.deleteTable())}><Trash2 size={14} /></Btn>
    </div>
  )
}

/** Options for one block, opened from its drag handle. */
export function BlockMenu({ editor, target, onClose, style }) {
  const ref = useRef(null)
  useOutside(true, ref, onClose)
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  if (!target) return null
  const { pos } = target
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return null
  const end = pos + node.nodeSize
  const $pos = editor.state.doc.resolve(pos)
  const index = $pos.index()
  const parent = $pos.parent
  const done = (fn) => () => { fn(); onClose() }
  const moveBy = (dir) => {
    const sibling = dir < 0 ? (index > 0 ? parent.child(index - 1) : null) : (index < parent.childCount - 1 ? parent.child(index + 1) : null)
    if (!sibling) return
    const tr = editor.state.tr
    if (dir < 0) {
      tr.delete(pos, end).insert(pos - sibling.nodeSize, node)
    } else {
      tr.delete(pos, end).insert(pos + sibling.nodeSize, node)
    }
    editor.view.dispatch(tr.scrollIntoView())
  }
  const canTurn = node.isTextblock || ['bulletList', 'orderedList', 'taskList', 'blockquote', 'callout'].includes(node.type.name)
  return (
    <div className="ft-pop ft-menu ft-block-menu" role="menu" aria-label="Block options" ref={ref} style={style}>
      <button type="button" role="menuitem" className="ft-menu-item" onMouseDown={stop}
        onClick={done(() => editor.chain().focus().deleteRange({ from: pos, to: end }).run())}><Trash2 size={15} /><span>Delete</span></button>
      <button type="button" role="menuitem" className="ft-menu-item" onMouseDown={stop}
        onClick={done(() => editor.chain().focus().insertContentAt(end, node.toJSON()).run())}><CopyPlus size={15} /><span>Duplicate</span></button>
      <button type="button" role="menuitem" className="ft-menu-item" disabled={index === 0} onMouseDown={stop}
        onClick={done(() => moveBy(-1))}><ArrowUp size={15} /><span>Move up</span></button>
      <button type="button" role="menuitem" className="ft-menu-item" disabled={index >= parent.childCount - 1} onMouseDown={stop}
        onClick={done(() => moveBy(1))}><ArrowDown size={15} /><span>Move down</span></button>
      {canTurn && <>
        <div className="ft-menu-label">Turn into</div>
        {TURN_INTO.map(t => (
          <button key={t.id} type="button" role="menuitem" className="ft-menu-item ft-menu-sub" onMouseDown={stop}
            onClick={done(() => {
              const inside = Math.min(pos + 1, editor.state.doc.content.size)
              editor.chain().setTextSelection(inside).run()
              t.run(editor)
            })}><span>{t.label}</span></button>
        ))}
      </>}
    </div>
  )
}
