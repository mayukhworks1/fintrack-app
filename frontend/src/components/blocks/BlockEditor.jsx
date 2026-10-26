import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import DragHandle from '@tiptap/extension-drag-handle-react'
import { GripVertical, Plus, Image as ImageIcon, Undo2, Redo2 } from 'lucide-react'
import { createExtensions, insertUploadedImage, IMAGE_TYPES } from './extensions'
import { toDocJSON } from './schema'
import { BubbleToolbar, TableToolbar, BlockMenu } from './toolbar'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import './blocks.css'

// Stable identities: the drag handle re-registers its plugin (which resets
// every plugin view, closing an open "/" menu) whenever this object changes.
const HANDLE_POSITION = { placement: 'left-start', strategy: 'absolute' }
const BUBBLE_DESKTOP = { placement: 'top', offset: 8, flip: true, shift: { padding: 8 } }
const BUBBLE_TOUCH = { placement: 'bottom', offset: 8, flip: true, shift: { padding: 8 } }
const TABLE_MENU = { placement: 'top-start', offset: 6, flip: false, shift: { padding: 8 } }
const BUBBLE_STYLE = { zIndex: 2500 }
const TABLE_STYLE = { zIndex: 2400 }

/**
 * Notion-style block editor over TipTap. `value` and `onChange` carry the
 * document as a TipTap JSON string — the same thing stored in a page's
 * `content` — so autosave, versions and templates treat it like any text.
 *
 * Props
 *   value, onChange(json)       the document
 *   uploadImage(file) -> url    stores an image (uploads, paste, drop)
 *   onReady(editor)             the TipTap editor, e.g. to focus it from a title
 *   commands / extensions       extra "/" entries and extensions (later phases)
 */
export default function BlockEditor({ value, onChange, uploadImage, onReady, commands, extensions: extra, className = '', ariaLabel = 'Document' }) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastRef = useRef(value)
  const fileRef = useRef(null)
  const wrapRef = useRef(null)
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  const linkOpenRef = useRef(false)
  linkOpenRef.current = linkOpen
  const hoverRef = useRef(null)
  const [blockMenu, setBlockMenu] = useState(null)
  const touch = useMediaQuery('(hover: none), (pointer: coarse), (max-width: 767px)')

  const extensions = useMemo(
    () => createExtensions({ editable: true, uploadImage, commands, extra: extra || [] }),
    [] // eslint-disable-line react-hooks/exhaustive-deps -- the schema is fixed for the editor's life
  )

  const editor = useEditor({
    extensions,
    content: toDocJSON(value),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'ft-prose', 'aria-label': ariaLabel, spellcheck: 'true' },
    },
    onUpdate: ({ editor: e }) => {
      const json = JSON.stringify(e.getJSON())
      lastRef.current = json
      onChangeRef.current?.(json)
    },
  })

  // A new value from outside (a template, a restored version, a conversion)
  // replaces the document; our own echoes are ignored.
  useEffect(() => {
    if (!editor || editor.isDestroyed || value === lastRef.current) return
    lastRef.current = value
    editor.commands.setContent(toDocJSON(value), { emitUpdate: false })
  }, [value, editor])

  useEffect(() => {
    // useEditor may hand over a short-lived instance that it destroys and
    // replaces right after mounting; wait for the live one.
    if (!editor || editor.isDestroyed || !editor.storage.blocks) return
    const store = editor.storage.blocks
    store.pickImage = () => fileRef.current?.click()
    store.openLink = () => {
      setLinkOpen(true)
      requestAnimationFrame(() => { if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('ft-link', true)) })
    }
    const onUp = (n) => setUploading(n)
    const onErr = (m) => { setError(m); setTimeout(() => setError(''), 4000) }
    editor.on('blocks:upload', onUp)
    editor.on('blocks:error', onErr)
    onReady?.(editor)
    return () => { editor.off('blocks:upload', onUp); editor.off('blocks:error', onErr) }
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!linkOpen && editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('ft-link', false))
  }, [linkOpen, editor])

  const onPick = (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    files.forEach(f => insertUploadedImage(editor, f, uploadImage))
  }

  const showBubble = useCallback(({ editor: e, state }) => {
    if (!e.isEditable) return false
    if (linkOpenRef.current) return true
    const sel = state.selection
    if (sel.empty || sel instanceof NodeSelection || sel instanceof CellSelection) return false
    if (e.isActive('codeBlock')) return false
    return state.doc.textBetween(sel.from, sel.to, ' ').trim().length > 0
  }, [])

  const showTable = useCallback(({ editor: e, state }) => (
    e.isEditable && !linkOpenRef.current && e.isActive('table') && (state.selection.empty || state.selection instanceof CellSelection)
  ), [])

  const tableAnchor = useCallback(() => {
    if (!editor) return null
    const { $from } = editor.state.selection
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'table') {
        let dom = editor.view.nodeDOM($from.before(d))
        if (dom && !(dom instanceof HTMLElement)) dom = dom.parentElement
        if (dom) return { getBoundingClientRect: () => dom.getBoundingClientRect(), contextElement: dom }
      }
    }
    return null
  }, [editor])

  // "+" beside a block (or in the phone toolbar): open the "/" menu on a new
  // line below, or in place when the block is already an empty line.
  const insertBlock = useCallback((target) => {
    if (!editor) return
    const t = target || (() => {
      const { $from } = editor.state.selection
      if ($from.depth < 1) return null
      return { node: $from.node(1), pos: $from.before(1) }
    })()
    const chain = editor.chain().focus()
    if (t?.node && t.node.type.name === 'paragraph' && t.node.content.size === 0) {
      chain.setTextSelection(t.pos + 1).insertContent('/').run()
      return
    }
    const at = t?.node ? t.pos + t.node.nodeSize : editor.state.doc.content.size
    chain.insertContentAt(at, { type: 'paragraph' }).setTextSelection(at + 1).insertContent('/').run()
  }, [editor])

  const onNodeChange = useCallback(({ node, pos }) => { hoverRef.current = node ? { node, pos } : null }, [])

  const openBlockMenu = (e) => {
    const t = hoverRef.current
    if (!t || !editor) return
    const r = e.currentTarget.getBoundingClientRect()
    const wr = wrapRef.current.getBoundingClientRect()
    editor.commands.lockDragHandle?.()
    setBlockMenu({ pos: t.pos, style: { position: 'absolute', left: Math.max(0, r.left - wr.left), top: r.bottom - wr.top + 4 } })
  }
  const closeBlockMenu = useCallback(() => {
    setBlockMenu(null)
    editor?.commands.unlockDragHandle?.()
  }, [editor])

  if (!editor) return null

  return (
    <div className={`ft-blocks ft-editor ${className}`} ref={wrapRef}>
      <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden onChange={onPick} aria-hidden="true" tabIndex={-1} />

      {touch && (
        <div className="ft-mobile-bar" role="toolbar" aria-label="Insert">
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => insertBlock()}><Plus size={16} /> Block</button>
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => fileRef.current?.click()}><ImageIcon size={16} /> Image</button>
          <span className="ft-mobile-spacer" />
          <button type="button" aria-label="Undo" onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></button>
          <button type="button" aria-label="Redo" onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></button>
        </div>
      )}

      <DragHandle editor={editor} className="ft-drag" onNodeChange={onNodeChange} computePositionConfig={HANDLE_POSITION}>
        <div className="ft-handle">
          <button type="button" className="ft-handle-btn" aria-label="Insert block below" title="Click to add a block below"
            onMouseDown={e => e.preventDefault()} onClick={() => insertBlock(hoverRef.current)}><Plus size={16} /></button>
          <button type="button" className="ft-handle-btn ft-handle-grip" aria-label="Drag to move, click for options" title="Drag to move · click for options"
            onClick={openBlockMenu}><GripVertical size={16} /></button>
        </div>
      </DragHandle>

      <BubbleMenu editor={editor} pluginKey="ftBubble" shouldShow={showBubble} updateDelay={80}
        options={touch ? BUBBLE_TOUCH : BUBBLE_DESKTOP}
        className="ft-pop ft-bubble" style={BUBBLE_STYLE}>
        <BubbleToolbar editor={editor} linkOpen={linkOpen} setLinkOpen={setLinkOpen} />
      </BubbleMenu>

      <BubbleMenu editor={editor} pluginKey="ftTable" shouldShow={showTable} getReferencedVirtualElement={tableAnchor}
        options={TABLE_MENU}
        className="ft-pop ft-bubble ft-bubble-table" style={TABLE_STYLE}>
        <TableToolbar editor={editor} />
      </BubbleMenu>

      <EditorContent editor={editor} />

      {blockMenu && <BlockMenu editor={editor} target={blockMenu} style={blockMenu.style} onClose={closeBlockMenu} />}

      {(uploading > 0 || error) && (
        <div className={`ft-status ${error ? 'is-error' : ''}`} role="status">
          {error ? `Image upload failed: ${error}` : `Uploading image${uploading > 1 ? `s (${uploading})` : ''}…`}
        </div>
      )}
    </div>
  )
}
