// Markdown <-> block document conversion, with no editor dependency.
//
// markdownToDoc follows what the classic Markdown pages already render (see
// renderMarkdown in PagesManager / PageViewer): headings, lists and to-dos,
// quotes, fenced code, rules, pipe tables, images, and the inline marks
// **bold**, *italic*, ~~strike~~, `code`, ==highlight== and [links](url). It
// also understands nesting by indentation and GitHub-style "> [!NOTE]"
// callouts. docToMarkdown is the reverse, used when a document is handed to
// something that speaks Markdown (the page generator, a type switch back).

const text = (t, marks) => (marks && marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t })
const para = (content) => (content && content.length ? { type: 'paragraph', content } : { type: 'paragraph' })

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------
const INLINE = [
  { kind: 'code', re: /`([^`\n]+)`/ },
  { kind: 'image', re: /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/ },
  { kind: 'link', re: /\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/ },
  { kind: 'bi', re: /\*\*\*(?=\S)([\s\S]+?)\*\*\*/ },
  { kind: 'bold', re: /\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__/ },
  { kind: 'italic', re: /\*(?=[^\s*])([\s\S]+?)\*|(?<![A-Za-z0-9_])_(?=[^\s_])([\s\S]+?)_(?![A-Za-z0-9_])/ },
  { kind: 'strike', re: /~~(?=\S)([\s\S]+?)~~/ },
  { kind: 'highlight', re: /==(?=\S)([\s\S]+?)==/ },
  { kind: 'url', re: /\bhttps?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"]/ },
]

const withMark = (marks, m) => [...marks.filter(x => x.type !== m.type), m]

/** Inline nodes for a run of text. Images come back as { type: 'image' } tokens
 *  for the caller to lift out, since images are blocks in the document. */
export function parseInline(src, marks = []) {
  const out = []
  let s = String(src || '')
  while (s) {
    let best = null
    for (const p of INLINE) {
      if (p.kind !== 'code' && p.kind !== 'url' && marks.some(m => m.type === 'code')) continue
      const m = p.re.exec(s)
      if (m && (best === null || m.index < best.m.index)) best = { p, m }
    }
    if (!best) { out.push(text(s, marks)); break }
    const { p, m } = best
    if (m.index > 0) out.push(text(s.slice(0, m.index), marks))
    const inner = m[1] ?? m[2] ?? ''
    switch (p.kind) {
      case 'code': out.push(text(m[1], withMark(marks, { type: 'code' }))); break
      case 'image': out.push({ type: 'image', attrs: { src: m[2], alt: m[1] || null } }); break
      case 'link': out.push(...parseInline(m[1], withMark(marks, { type: 'link', attrs: { href: m[2] } }))); break
      case 'url': out.push(text(m[0], withMark(marks, { type: 'link', attrs: { href: m[0] } }))); break
      case 'bi': out.push(...parseInline(inner, withMark(withMark(marks, { type: 'bold' }), { type: 'italic' }))); break
      case 'bold': out.push(...parseInline(inner, withMark(marks, { type: 'bold' }))); break
      case 'italic': out.push(...parseInline(inner, withMark(marks, { type: 'italic' }))); break
      case 'strike': out.push(...parseInline(inner, withMark(marks, { type: 'strike' }))); break
      case 'highlight': out.push(...parseInline(inner, withMark(marks, { type: 'highlight' }))); break
      default: out.push(text(m[0], marks))
    }
    s = s.slice(m.index + m[0].length)
  }
  return out.filter(n => n.type !== 'text' || n.text)
}

/** Lines of a paragraph -> blocks: paragraphs joined by hard breaks, with any
 *  images lifted out as blocks of their own in reading order. */
function inlineBlocks(lines) {
  const nodes = []
  lines.forEach((l, i) => {
    if (i > 0) nodes.push({ type: 'hardBreak' })
    nodes.push(...parseInline(l))
  })
  const blocks = []
  let run = []
  const flush = () => {
    while (run.length && run[run.length - 1].type === 'hardBreak') run.pop()
    while (run.length && run[0].type === 'hardBreak') run.shift()
    if (run.length) blocks.push(para(run))
    run = []
  }
  for (const n of nodes) {
    if (n.type === 'image') { flush(); blocks.push(n) } else run.push(n)
  }
  flush()
  return blocks
}

const inlineOnly = (s) => parseInline(s).filter(n => n.type !== 'image')

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------
const RE = {
  fence: /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/,
  heading: /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/,
  quote: /^\s{0,3}>\s?/,
  list: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/,
  task: /^\[([ xX])\]\s+(.*)$/,
  tableSep: /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
}

const CALLOUTS = {
  NOTE: { icon: 'ℹ️', tone: 'blue' }, TIP: { icon: '💡', tone: 'green' }, IMPORTANT: { icon: '❗', tone: 'purple' },
  WARNING: { icon: '⚠️', tone: 'yellow' }, CAUTION: { icon: '🚫', tone: 'red' },
}

// Callout colour -> GitHub alert kind, for writing callouts back out.
const CALLOUT_KIND = { blue: 'NOTE', green: 'TIP', purple: 'IMPORTANT', yellow: 'WARNING', red: 'CAUTION' }

const indentOf = (s) => s.replace(/\t/g, '    ').match(/^ */)[0].length

function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
}

function isTableStart(lines, i) {
  return lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && RE.tableSep.test(lines[i + 1])
}

function startsBlock(lines, i) {
  const l = lines[i]
  return RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || RE.list.test(l) || isTableStart(lines, i)
}

function cellContent(c) {
  const blocks = inlineBlocks([c])
  return blocks.length ? blocks : [para()]
}

function parseList(lines, start) {
  const base = indentOf(lines[start])
  const first = lines[start].match(RE.list)
  const ordered = /\d/.test(first[2])
  const isTask = !ordered && RE.task.test(first[3])
  const kind = isTask ? 'task' : ordered ? 'ordered' : 'bullet'
  const items = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      // A blank line ends the list unless the list carries on after it.
      let j = i + 1
      while (j < lines.length && !lines[j].trim()) j++
      if (j < lines.length && RE.list.test(lines[j]) && indentOf(lines[j]) >= base) { i = j; continue }
      break
    }
    const m = line.match(RE.list)
    const ind = indentOf(line)
    if (m && ind <= base + 1) {
      const itemOrdered = /\d/.test(m[2])
      const itemTask = !itemOrdered && RE.task.test(m[3])
      const itemKind = itemTask ? 'task' : itemOrdered ? 'ordered' : 'bullet'
      if (itemKind !== kind || ind < base) break
      const t = itemTask ? m[3].match(RE.task) : null
      items.push({ checked: t ? t[1].toLowerCase() === 'x' : false, lines: [t ? t[2] : m[3]], children: [] })
      i++
      continue
    }
    if (ind < base || !items.length) break
    if (m) {
      const [node, next] = parseList(lines, i)
      items[items.length - 1].children.push(node)
      i = next
      continue
    }
    if (ind > base) { items[items.length - 1].lines.push(line.trim()); i++; continue }
    break
  }
  const toItem = (it) => {
    const blocks = inlineBlocks(it.lines)
    const head = blocks[0]?.type === 'paragraph' ? [blocks.shift()] : [para()]
    return { type: kind === 'task' ? 'taskItem' : 'listItem', ...(kind === 'task' ? { attrs: { checked: it.checked } } : {}), content: [...head, ...blocks, ...it.children] }
  }
  const node = { type: kind === 'task' ? 'taskList' : kind === 'ordered' ? 'orderedList' : 'bulletList', content: items.map(toItem) }
  if (kind === 'ordered') {
    const n = parseInt(first[2], 10)
    if (n !== 1) node.attrs = { start: n }
  }
  return [node, i]
}

function parseBlocks(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    const fence = line.match(RE.fence)
    if (fence) {
      const body = []
      i++
      while (i < lines.length && !(lines[i].trim().startsWith(fence[1]) && RE.fence.test(lines[i]))) body.push(lines[i++])
      i++
      const code = body.join('\n')
      out.push({ type: 'codeBlock', attrs: { language: fence[2] || null }, ...(code ? { content: [text(code)] } : {}) })
      continue
    }

    const h = line.match(RE.heading)
    if (h) {
      const level = Math.min(3, h[1].length)
      const blocks = inlineBlocks([h[2]])
      const inl = blocks[0]?.type === 'paragraph' ? blocks.shift().content : []
      out.push({ type: 'heading', attrs: { level }, ...(inl.length ? { content: inl } : {}) })
      out.push(...blocks)
      i++
      continue
    }

    if (RE.hr.test(line)) { out.push({ type: 'horizontalRule' }); i++; continue }

    if (RE.quote.test(line)) {
      const inner = []
      while (i < lines.length && RE.quote.test(lines[i])) inner.push(lines[i++].replace(RE.quote, ''))
      const callout = inner[0]?.trim().match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i)
      if (callout) {
        const spec = CALLOUTS[callout[1].toUpperCase()]
        const rest = [callout[2], ...inner.slice(1)].filter((l, k) => k > 0 || l.trim())
        const content = parseBlocks(rest)
        out.push({ type: 'callout', attrs: { icon: spec.icon, tone: spec.tone }, content: content.length ? content : [para()] })
      } else {
        const content = parseBlocks(inner)
        out.push({ type: 'blockquote', content: content.length ? content : [para()] })
      }
      continue
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(lines[i])
      const rows = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]))
      const cols = Math.max(head.length, ...rows.map(r => r.length))
      const pad = (r) => [...r, ...Array(Math.max(0, cols - r.length)).fill('')].slice(0, cols)
      out.push({
        type: 'table',
        content: [
          { type: 'tableRow', content: pad(head).map(c => ({ type: 'tableHeader', content: cellContent(c) })) },
          ...rows.map(r => ({ type: 'tableRow', content: pad(r).map(c => ({ type: 'tableCell', content: cellContent(c) })) })),
        ],
      })
      continue
    }

    if (RE.list.test(line)) {
      const [node, next] = parseList(lines, i)
      out.push(node)
      i = next
      continue
    }

    const buf = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) buf.push(lines[i++].trim())
    out.push(...inlineBlocks(buf))
  }
  return out
}

/** A Markdown string as a block document (TipTap JSON). */
export function markdownToDoc(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n')
  const content = parseBlocks(lines)
  return { type: 'doc', content: content.length ? content : [para()] }
}

/** Plain text as a document: one paragraph per blank-line-separated block. */
export function plainTextToDoc(t) {
  const blocks = String(t || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).filter(b => b.trim())
  const content = blocks.map(b => para(b.split('\n').flatMap((l, i) => (i ? [{ type: 'hardBreak' }] : []).concat(l ? [text(l)] : []))))
  return { type: 'doc', content: content.length ? content : [para()] }
}

// ---------------------------------------------------------------------------
// Document -> Markdown
// ---------------------------------------------------------------------------
function inlineMd(nodes = []) {
  return nodes.map(n => {
    if (n.type === 'hardBreak') return '\n'
    if (n.type !== 'text') return inlineMd(n.content)
    const marks = n.marks || []
    const has = (t) => marks.some(m => m.type === t)
    let s = n.text || ''
    if (has('code')) s = `\`${s}\``
    if (has('highlight')) s = `==${s}==`
    if (has('strike')) s = `~~${s}~~`
    if (has('italic')) s = `*${s}*`
    if (has('bold')) s = `**${s}**`
    const link = marks.find(m => m.type === 'link')
    if (link?.attrs?.href) s = `[${s}](${link.attrs.href})`
    return s
  }).join('')
}

const prefixLines = (s, p, first = p) => s.split('\n').map((l, i) => (i === 0 ? first : p) + l).join('\n')

function blocksMd(nodes = []) {
  return nodes.map(blockMd).filter(s => s !== null).join('\n\n')
}

function listMd(node) {
  const start = node.attrs?.start || 1
  return (node.content || []).map((item, i) => {
    const marker = node.type === 'orderedList' ? `${start + i}. `
      : node.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : '- '
    const [head, ...rest] = item.content || []
    const lead = head?.type === 'paragraph' ? inlineMd(head.content).replace(/\n/g, ' ') : blockMd(head) || ''
    const nested = rest.map(c => prefixLines(blockMd(c) || '', ' '.repeat(marker.length))).join('\n')
    return marker + lead + (nested ? `\n${nested}` : '')
  }).join('\n')
}

function cellMd(cell) {
  return (cell.content || []).map(c => c.type === 'paragraph' ? inlineMd(c.content) : blockMd(c) || '')
    .join(' ').replace(/\n/g, ' ').replace(/\|/g, '\\|').trim()
}

function blockMd(node) {
  if (!node) return null
  switch (node.type) {
    case 'paragraph': return inlineMd(node.content)
    case 'heading': return `${'#'.repeat(node.attrs?.level || 1)} ${inlineMd(node.content).replace(/\n/g, ' ')}`
    case 'bulletList': case 'orderedList': case 'taskList': return listMd(node)
    case 'blockquote': return prefixLines(blocksMd(node.content), '> ')
    case 'callout': return prefixLines(`[!${CALLOUT_KIND[node.attrs?.tone] || 'NOTE'}]\n${blocksMd(node.content)}`, '> ')
    case 'codeBlock': return `\`\`\`${node.attrs?.language || ''}\n${(node.content || []).map(t => t.text || '').join('')}\n\`\`\``
    case 'horizontalRule': return '---'
    case 'image': return node.attrs?.src ? `![${node.attrs.alt || ''}](${node.attrs.src})` : null
    case 'embed': return node.attrs?.url ? `[${node.attrs.url}](${node.attrs.url})` : null
    case 'details': {
      const summary = (node.content || []).find(c => c.type === 'detailsSummary')
      const body = (node.content || []).find(c => c.type === 'detailsContent')
      return [`**▸ ${inlineMd(summary?.content)}**`, blocksMd(body?.content)].filter(Boolean).join('\n\n')
    }
    case 'table': {
      const rows = (node.content || []).map(r => (r.content || []).map(cellMd))
      if (!rows.length) return null
      const cols = Math.max(...rows.map(r => r.length))
      const line = (r) => `| ${[...r, ...Array(cols - r.length).fill('')].join(' | ')} |`
      return [line(rows[0]), `|${Array(cols).fill('---').join('|')}|`, ...rows.slice(1).map(line)].join('\n')
    }
    default: return node.content ? blocksMd(node.content) : null
  }
}

/** A block document as Markdown. Colours and underline have no Markdown form
 *  and are dropped; toggles become a bold summary line over their content. */
export function docToMarkdown(doc) {
  if (!doc || doc.type !== 'doc') return ''
  return blocksMd(doc.content).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
