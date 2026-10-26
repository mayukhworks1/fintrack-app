import { useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { resolveEmbed, safeHref, EMBED_SANDBOX, EMBED_PROVIDERS } from '../embeds'

const frameStyle = (e) => (e.height ? { height: e.height } : { aspectRatio: e.ratio || '16 / 9' })

function EmbedView({ node, updateAttributes, deleteNode, editor, selected }) {
  const url = node.attrs.url || ''
  const embed = resolveEmbed(url)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const editable = editor.isEditable

  if (!url) {
    if (!editable) return <NodeViewWrapper />
    const submit = (e) => {
      e.preventDefault()
      const v = draft.trim()
      if (!v) return
      if (!resolveEmbed(v)) { setError(`That link can't be embedded. Supported: ${EMBED_PROVIDERS.join(', ')}.`); return }
      updateAttributes({ url: v })
    }
    return (
      <NodeViewWrapper className="ft-embed ft-embed-empty" data-type="embed" contentEditable={false}>
        <form onSubmit={submit} className="ft-embed-form">
          <input autoFocus type="url" inputMode="url" value={draft} placeholder="Paste a YouTube, Loom, Figma or Google Docs link…"
            aria-label="Link to embed"
            onChange={e => { setDraft(e.target.value); setError('') }}
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); deleteNode() } }} />
          <button type="submit">Embed</button>
          <button type="button" className="ft-embed-cancel" onClick={() => deleteNode()} aria-label="Remove embed">✕</button>
        </form>
        {error && <div className="ft-embed-error" role="alert">{error}</div>}
      </NodeViewWrapper>
    )
  }

  if (!embed) {
    const href = safeHref(url)
    return (
      <NodeViewWrapper className="ft-embed ft-embed-link" data-type="embed" contentEditable={false}>
        {href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{url}</a> : <span>{url}</span>}
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className={`ft-embed${selected ? ' is-selected' : ''}`} data-type="embed" data-provider={embed.provider} contentEditable={false}>
      <div className="ft-embed-frame" style={frameStyle(embed)}>
        <iframe src={embed.src} title={`${embed.label} embed`} loading="lazy" sandbox={EMBED_SANDBOX}
          allow="fullscreen; picture-in-picture; encrypted-media; clipboard-write" allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin" />
        {/* While editing, a click should select the block rather than fall
            into the frame, or the block could never be dragged or deleted. */}
        {editable && !selected && <div className="ft-embed-shield" data-drag-handle="" />}
      </div>
      <div className="ft-embed-caption">
        <span>{embed.label}</span>
        <a href={safeHref(url) || undefined} target="_blank" rel="noopener noreferrer nofollow">Open ↗</a>
      </div>
    </NodeViewWrapper>
  )
}

/** A framed YouTube / Loom / Figma / Google document, from an allowlisted link. */
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: el => el.getAttribute('data-url') || '',
        renderHTML: a => ({ 'data-url': a.url || '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="embed"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const e = resolveEmbed(node.attrs.url)
    const attrs = mergeAttributes(HTMLAttributes, { 'data-type': 'embed', class: 'ft-embed' })
    if (!e) {
      const href = safeHref(node.attrs.url)
      return ['div', attrs, href ? ['a', { href, target: '_blank', rel: 'noopener noreferrer nofollow' }, node.attrs.url] : ['span', {}, node.attrs.url || '']]
    }
    return ['div', attrs, ['iframe', { src: e.src, loading: 'lazy', sandbox: EMBED_SANDBOX, allowfullscreen: 'true', title: `${e.label} embed` }]]
  },

  addCommands() {
    return {
      insertEmbed: (url = '') => ({ commands }) => commands.insertContent({ type: this.name, attrs: { url } }),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView)
  },
})
