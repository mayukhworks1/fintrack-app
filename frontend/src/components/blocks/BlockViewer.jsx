import { useEffect, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { createExtensions } from './extensions'
import { toDocJSON } from './schema'
import { headingId } from './docText'
import './blocks.css'

/**
 * A block document, read-only, rendered with the editor's own schema and
 * styles: toggles open and close, code is highlighted, embeds load lazily and
 * to-dos cannot be ticked. Nothing here builds HTML from strings — every node
 * goes through the schema's renderers, which only emit known attributes.
 *
 * `variant="public"` takes its colours from the public viewer's theme.
 */
export default function BlockViewer({ content, protect = false, variant = 'app', fullWidth = false, className = '' }) {
  const doc = useMemo(() => toDocJSON(content), [content])
  const extensions = useMemo(() => createExtensions({ editable: false, protect }), [protect])
  const editor = useEditor({
    editable: false,
    extensions,
    content: doc,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    // The read-only document is still a textbox to assistive tech; it needs a name.
    editorProps: { attributes: { class: 'ft-prose', 'aria-label': 'Page content' } },
  }, [extensions])

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.setContent(doc, { emitUpdate: false })
  }, [doc, editor])

  // Heading anchors for the table of contents and #links.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const seen = new Map()
    editor.view.dom.querySelectorAll(':scope > h1, :scope > h2, :scope > h3').forEach(h => {
      const base = headingId(h.textContent || '')
      const n = seen.get(base) || 0
      seen.set(base, n + 1)
      h.id = n ? `${base}-${n}` : base
    })
  }, [doc, editor])

  if (!editor) return null
  return (
    <div className={`ft-blocks is-readonly ${variant === 'public' ? 'is-public' : ''} ${fullWidth ? 'is-full' : ''} ${className}`}>
      <EditorContent editor={editor} />
    </div>
  )
}
