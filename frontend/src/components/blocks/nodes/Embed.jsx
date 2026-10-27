import { useEffect, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { resolveEmbed, resolvePageEmbed, safeHref, EMBED_SANDBOX, EMBED_PROVIDERS } from '../embeds'
import { api } from '../../../services/api'
import ArtifactFrame from '../../artifacts/ArtifactFrame'

const frameStyle = (e) => (e.height ? { height: e.height } : { aspectRatio: e.ratio || '16 / 9' })

const RENDERED = new Set(['artifact', 'html'])

/**
 * An artifact (or web page) from this workspace, by its public link. It is
 * looked up first, so a link that is unpublished, locked or gone says so in
 * words instead of framing an error. The frame then sizes itself to the
 * artifact's content.
 */
function ArtifactEmbed({ slug, path, editable, selected }) {
  const [state, setState] = useState({ status: 'checking' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setState({ status: 'checking' })
    Promise.resolve().then(() => api.pages.publicGet(slug))
      .then(data => {
        if (!alive) return
        if (data?.expired) setState({ status: 'expired' })
        else if (data?.requires_password) setState({ status: 'locked', title: data.title })
        else if (!data?.id || data.detail || data.error) setState({ status: 'missing' })
        else if (!RENDERED.has(data.content_type)) setState({ status: 'other', title: data.title })
        else setState({ status: 'ready', title: data.title || 'Artifact', token: data.render_token })
      })
      .catch(() => { if (alive) setState({ status: 'offline' }) })
    return () => { alive = false }
  }, [slug, attempt])

  const open = <a href={path} target="_blank" rel="noopener noreferrer">Open full screen ↗</a>
  const notices = {
    expired: ['This artifact’s link has expired.', null],
    locked: ['This artifact is password-protected, so it opens on its own page.', null],
    missing: [editable ? 'This artifact isn’t published yet. Publish it from its page and it will show here.' : 'This artifact isn’t available right now.', null],
    other: ['This link is to a page, not an artifact.', null],
    offline: ['This artifact couldn’t load. Check your connection.', <button key="retry" type="button" onClick={() => setAttempt(n => n + 1)}>Try again</button>],
  }

  if (state.status === 'checking') {
    return (
      <div className="ft-embed-artifact" aria-busy="true" aria-label="Loading artifact" style={{ height: 320 }}>
        <div aria-hidden="true" className="ft-embed-skel">
          <div className="skeleton" style={{ height: 20, width: '40%' }} />
          <div className="skeleton" style={{ height: 12, width: '65%' }} />
          <div className="skeleton" style={{ height: 160, borderRadius: 10 }} />
        </div>
      </div>
    )
  }
  if (state.status !== 'ready') {
    const [text, action] = notices[state.status] || notices.missing
    return (
      <div className="ft-embed-artifact ft-embed-notice" role="note">
        <span>{text}</span>
        <span className="ft-embed-notice-actions">{action}{state.status !== 'missing' || editable ? open : null}</span>
      </div>
    )
  }
  return (
    <>
      <div className="ft-embed-artifact">
        <ArtifactFrame slug={slug} token={state.token} title={`${state.title} (artifact)`}
          autoHeight height={420} minHeight={200} maxHeight={900} openHref={path} />
        {/* As with other embeds: while editing, a click selects the block. */}
        {editable && !selected && <div className="ft-embed-shield" data-drag-handle="" />}
      </div>
      <div className="ft-embed-caption">
        <span>{state.title}</span>
        {open}
      </div>
    </>
  )
}

function EmbedView({ node, updateAttributes, deleteNode, editor, selected }) {
  const url = node.attrs.url || ''
  const page = resolvePageEmbed(url)
  const embed = page ? null : resolveEmbed(url)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const editable = editor.isEditable

  if (!url) {
    if (!editable) return <NodeViewWrapper />
    const submit = (e) => {
      e.preventDefault()
      const v = draft.trim()
      if (!v) return
      const own = resolvePageEmbed(v)
      if (!own && !resolveEmbed(v)) { setError(`That link can't be embedded. Supported: ${EMBED_PROVIDERS.join(', ')}.`); return }
      updateAttributes({ url: own ? own.path : v })
    }
    return (
      <NodeViewWrapper className="ft-embed ft-embed-empty" data-type="embed" contentEditable={false}>
        <form onSubmit={submit} className="ft-embed-form">
          <input autoFocus type="url" inputMode="url" value={draft} placeholder="Paste a YouTube, Loom, Figma, Google Docs or artifact link…"
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

  if (page) {
    return (
      <NodeViewWrapper className={`ft-embed${selected ? ' is-selected' : ''}`} data-type="embed" data-provider="page" contentEditable={false}>
        <ArtifactEmbed slug={page.slug} path={page.path} editable={editable} selected={selected} />
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
