import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import DragHandle from '@tiptap/extension-drag-handle-react'
import { GripVertical, Plus, Image as ImageIcon, Undo2, Redo2 } from 'lucide-react'
import { createExtensions, insertUploadedImage, IMAGE_TYPES } from './extensions'
import { editorExtensions } from './editorExtensions'
import { toDocJSON } from './schema'
import { sameDoc } from './collab/presence'
import { BubbleToolbar, TableToolbar, BlockMenu } from './toolbar'
import PagePicker, { pageHref } from './PagePicker'
import { onCommentGoTo } from '../comments/commentsModel'
import { api } from '../../services/api'
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
// Typing does not serialise the whole document per keystroke: onChange runs
// once the author pauses (and at once on blur or unmount).
const CHANGE_DELAY_MS = 250

/** Where a comment's anchor is now: its recorded range when the text there
 *  still matches, else the first place the quoted text appears. */
export function findAnchor(doc, anchor) {
  if (!anchor) return null
  const size = doc.content.size
  const quote = String(anchor.quote || '').trim()
  const { from, to } = anchor
  if (Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to <= size && from < to) {
    if (!quote || doc.textBetween(from, to, ' ').trim() === quote) return { from, to }
  }
  if (!quote) return null
  let hit = null
  doc.descendants((node, pos) => {
    if (hit) return false
    if (!node.isTextblock) return true
    const i = node.textContent.indexOf(quote)
    if (i >= 0) {
      // Map the text offset to a position, walking the block's inline nodes.
      let offset = 0
      let start = null
      node.forEach((child, childPos) => {
        if (start != null) return
        const len = child.isText ? child.text.length : 1
        if (i < offset + len) start = pos + 1 + childPos + (i - offset)
        offset += len
      })
      if (start != null) hit = { from: start, to: Math.min(start + quote.length, size) }
    }
    return false
  })
  return hit
}

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
 *   collaborative               the document comes from a Collaboration
 *                               extension in `extensions`, not from `value`
 *   pageId                      the saved page being edited: enables the
 *                               "Sub-page" / "Link to page" entries and
 *                               "Comment" on a selection
 *   readOnly                    shown but not editable (a page in the trash)
 *
 * onChange is called after a short pause in typing (CHANGE_DELAY_MS), and at
 * once when the editor loses focus or unmounts, so the last edit always
 * reaches it.
 */
export default function BlockEditor({ value, onChange, uploadImage, onReady, commands, extensions: extra, collaborative = false, className = '', ariaLabel = 'Document', pageId = null, readOnly = false }) {
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
  const [picker, setPicker] = useState(false)
  const pageIdRef = useRef(pageId)
  pageIdRef.current = pageId
  const changeTimer = useRef(null)
  const dirtyRef = useRef(null)     // the editor with an edit not yet reported
  const flushChange = useCallback(() => {
    clearTimeout(changeTimer.current)
    changeTimer.current = null
    const e = dirtyRef.current
    dirtyRef.current = null
    if (!e || e.isDestroyed) return
    const json = JSON.stringify(e.getJSON())
    lastRef.current = json
    onChangeRef.current?.(json)
  }, [])
  // The document is read from `value` once, when the editor is made.
  const [initialDoc] = useState(() => (collaborative ? undefined : toDocJSON(value)))

  const extensions = useMemo(
    () => createExtensions({ editable: true, extra: [...editorExtensions({ uploadImage, commands }), ...(extra || [])], history: !collaborative }),
    [] // eslint-disable-line react-hooks/exhaustive-deps -- the schema is fixed for the editor's life
  )

  const editor = useEditor({
    extensions,
    content: initialDoc,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'ft-prose', 'aria-label': ariaLabel, spellcheck: 'true' },
    },
    onUpdate: ({ editor: e }) => {
      dirtyRef.current = e
      clearTimeout(changeTimer.current)
      changeTimer.current = setTimeout(flushChange, CHANGE_DELAY_MS)
    },
    onBlur: () => { if (dirtyRef.current) flushChange() },
  })

  // Unmounting (closing the page, a live session taking over) reports the
  // last edit rather than dropping it.
  useEffect(() => () => {
    const e = dirtyRef.current
    dirtyRef.current = null
    clearTimeout(changeTimer.current)
    if (e && !e.isDestroyed) {
      try { const json = JSON.stringify(e.getJSON()); lastRef.current = json; onChangeRef.current?.(json) } catch { /* destroyed meanwhile */ }
    }
  }, [])

  // A new value from outside (a template, a restored version, a conversion)
  // replaces the document; our own echoes are ignored.
  const propRef = useRef(value)
  useEffect(() => {
    const newProp = value !== propRef.current
    propRef.current = value
    if (!editor || editor.isDestroyed || value === lastRef.current) return
    // A replacement wins over an edit still waiting to be reported.
    if (newProp) { clearTimeout(changeTimer.current); dirtyRef.current = null }
    // Live, the document is the shared one and a replacement is an edit that
    // everyone receives. Only a value the parent actually changed counts —
    // never the one the editor mounted with, which the shared copy has
    // already superseded — and only when it changes something.
    if (collaborative && (!newProp || sameDoc(value, editor.getJSON()))) return
    lastRef.current = value
    editor.commands.setContent(toDocJSON(value), { emitUpdate: false })
  }, [value, editor]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (editor && !editor.isDestroyed && editor.isEditable === !!readOnly) editor.setEditable(!readOnly, false)
  }, [editor, readOnly])

  // Page commands ("/" Sub-page and Link to page) for a saved page.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.storage.blocks) return undefined
    const store = editor.storage.blocks
    if (!pageId) { store.pages = null; return undefined }
    const insertLink = (p) => {
      const href = pageHref(p)
      const text = p.title || 'Untitled'
      const content = href ? { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] } : { type: 'text', text }
      editor.chain().focus().insertContent([content, { type: 'text', text: ' ' }]).run()
    }
    store.pages = {
      pickPage: () => setPicker('link'),
      pickArtifact: () => setPicker('artifact'),
      insertArtifact: (p) => { if (p?.slug) editor.chain().focus().insertEmbed(`/p/${p.slug}`).run() },
      createSubPage: async () => {
        try {
          const id = `sub-${pageId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const p = await api.pageLinks.createChild(pageId, { title: 'Untitled', content_type: 'doc', content: '', client_request_id: id })
          if (p?.id && !editor.isDestroyed) insertLink(p)
        } catch (err) {
          editor.emit('blocks:error', err?.message || 'Could not create the sub-page')
        }
      },
      insertLink,
    }
    return () => { if (store.pages) store.pages = null }
  }, [editor, pageId])

  // "Go to" on an anchored comment: select the text it was left on.
  useEffect(() => {
    if (!editor || !pageId) return undefined
    return onCommentGoTo((d) => {
      if (editor.isDestroyed || (d?.pageId && d.pageId !== pageIdRef.current)) return
      const hit = findAnchor(editor.state.doc, d?.anchor)
      if (!hit) return
      editor.chain().focus().setTextSelection(hit).scrollIntoView().run()
    })
  }, [editor, pageId])

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
        <BubbleToolbar editor={editor} linkOpen={linkOpen} setLinkOpen={setLinkOpen} commentPageId={pageId} />
      </BubbleMenu>

      <BubbleMenu editor={editor} pluginKey="ftTable" shouldShow={showTable} getReferencedVirtualElement={tableAnchor}
        options={TABLE_MENU}
        className="ft-pop ft-bubble ft-bubble-table" style={TABLE_STYLE}>
        <TableToolbar editor={editor} />
      </BubbleMenu>

      <EditorContent editor={editor} />

      {picker && (
        <PagePicker editor={editor} excludeId={pageId} onClose={() => setPicker(false)} kind={picker}
          onPick={(p) => {
            setPicker(false)
            const pages = editor.storage.blocks?.pages
            if (picker === 'artifact') pages?.insertArtifact(p); else pages?.insertLink(p)
          }} />
      )}

      {blockMenu && <BlockMenu editor={editor} target={blockMenu} style={blockMenu.style} onClose={closeBlockMenu} />}

      {(uploading > 0 || error) && (
        <div className={`ft-status ${error ? 'is-error' : ''}`} role="status">
          {error ? `Image upload failed: ${error}` : `Uploading image${uploading > 1 ? `s (${uploading})` : ''}…`}
        </div>
      )}
    </div>
  )
}
