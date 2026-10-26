// Helpers over the stored document format (TipTap JSON) that need no editor:
// parsing what is in `content`, plain text for counts and descriptions, and
// headings for a table of contents. Kept free of editor imports so the page
// list and the viewer shell can use them without loading the editor.

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

/** The document stored in `content`, or null when it is not a block document. */
export function parseDoc(value) {
  if (!value) return null
  if (typeof value === 'object') return value?.type === 'doc' ? value : null
  const s = String(value).trim()
  if (!s.startsWith('{')) return null
  try {
    const d = JSON.parse(s)
    return d && d.type === 'doc' ? d : null
  } catch {
    return null
  }
}

export const serializeDoc = (doc) => JSON.stringify(doc || EMPTY_DOC)

// Nodes whose text reads as its own line.
const BLOCKS = new Set([
  'paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'taskItem',
  'callout', 'details', 'detailsSummary', 'detailsContent', 'tableRow', 'image', 'embed', 'horizontalRule',
])

/** Plain text of a document: one line per block, cells separated by tabs. */
export function docText(input) {
  const doc = typeof input === 'string' ? parseDoc(input) : input
  if (!doc) return ''
  const out = []
  const endLine = () => { if (out.length && !out[out.length - 1].endsWith('\n')) out.push('\n') }
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text') { out.push(String(node.text || '')); return }
    if (node.type === 'hardBreak') { out.push('\n'); return }
    if (node.type === 'image' && node.attrs?.alt) out.push(String(node.attrs.alt))
    if (node.type === 'tableRow') {
      endLine()
      out.push((node.content || []).map(c => docText({ type: 'doc', content: c.content || [] }).replace(/\s+/g, ' ')).join('\t'))
      out.push('\n')
      return
    }
    ;(node.content || []).forEach(walk)
    if (BLOCKS.has(node.type)) endLine()
  }
  walk(doc)
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function docWordCount(input) {
  const t = docText(input)
  return t ? t.split(/\s+/).filter(Boolean).length : 0
}

/** A short description from the opening text, for previews and meta tags. */
export function docExcerpt(input, max = 180) {
  const t = docText(input).replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trim()}…`
}

const inlineText = (node) => (node?.content || []).map(n => n.type === 'text' ? n.text || '' : inlineText(n)).join('')

export const headingId = (text) => 'h-' + String(text).toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 50)

/** Top-level headings (levels 1-3), in order, with the ids the viewer gives them. */
export function docHeadings(input) {
  const doc = typeof input === 'string' ? parseDoc(input) : input
  if (!doc) return []
  const out = []
  const seen = new Map()
  for (const n of doc.content || []) {
    if (n.type !== 'heading') continue
    const text = inlineText(n).trim()
    const base = headingId(text)
    const k = seen.get(base) || 0
    seen.set(base, k + 1)
    if (!text) continue
    out.push({ level: Math.min(3, Number(n.attrs?.level) || 1), text, id: k ? `${base}-${k}` : base })
  }
  return out
}
