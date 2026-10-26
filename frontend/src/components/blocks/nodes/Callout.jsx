import { useEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { CALLOUT_ICONS, CALLOUT_TONES, calloutIcon, toneKey } from '../palette'

function CalloutView({ node, updateAttributes, editor }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const icon = calloutIcon(node.attrs.icon)
  const tone = toneKey(node.attrs.tone)
  const editable = editor.isEditable

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])

  return (
    <NodeViewWrapper className="ft-callout" data-type="callout" data-tone={tone}>
      <div className="ft-callout-icon" contentEditable={false} ref={ref}>
        {editable ? (
          <button type="button" aria-label="Change callout icon and colour" aria-expanded={open}
            onMouseDown={e => e.preventDefault()} onClick={() => setOpen(o => !o)}>{icon}</button>
        ) : <span aria-hidden="true">{icon}</span>}
        {open && (
          <div className="ft-pop ft-callout-picker" role="dialog" aria-label="Callout style">
            <div className="ft-callout-picker-label">Icon</div>
            <div className="ft-callout-icons">
              {CALLOUT_ICONS.map(i => (
                <button key={i} type="button" aria-label={`Icon ${i}`} aria-pressed={i === icon}
                  onMouseDown={e => e.preventDefault()} onClick={() => updateAttributes({ icon: i })}>{i}</button>
              ))}
            </div>
            <div className="ft-callout-picker-label">Colour</div>
            <div className="ft-callout-tones">
              {CALLOUT_TONES.map(t => (
                <button key={t.key} type="button" title={t.label} aria-label={`${t.label} background`} aria-pressed={t.key === tone}
                  className="ft-tone-swatch" data-tone={t.key}
                  onMouseDown={e => e.preventDefault()} onClick={() => { updateAttributes({ tone: t.key }); setOpen(false) }} />
              ))}
            </div>
          </div>
        )}
      </div>
      <NodeViewContent className="ft-callout-body" />
    </NodeViewWrapper>
  )
}

/** A tinted box with an icon, holding any blocks. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      icon: {
        default: '💡',
        parseHTML: el => calloutIcon(el.getAttribute('data-icon')),
        renderHTML: a => ({ 'data-icon': calloutIcon(a.icon) }),
      },
      tone: {
        default: 'default',
        parseHTML: el => toneKey(el.getAttribute('data-tone')),
        renderHTML: a => ({ 'data-tone': toneKey(a.tone) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout', class: 'ft-callout' }), 0]
  },

  addCommands() {
    return {
      setCallout: (attrs = {}) => ({ commands }) => commands.wrapIn(this.name, attrs),
      toggleCallout: (attrs = {}) => ({ commands }) => commands.toggleWrap(this.name, attrs),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },
})
