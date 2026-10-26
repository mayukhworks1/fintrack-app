/**
 * Block documents outside the editor: Markdown -> blocks conversion (and the
 * "Convert to blocks" action, which saves a version first), the embed
 * allowlist, document text helpers, and the public viewer rendering a doc
 * page read-only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { markdownToDoc, docToMarkdown, docText, docWordCount, docHeadings, docExcerpt, resolveEmbed, safeHref, docTemplates, parseDoc } from '../components/blocks'

const { calls, PAGES, PUBLIC } = vi.hoisted(() => ({
  calls: { update: [], create: [] },
  PAGES: [{ id: 'm1', slug: 'notes', title: 'Notes', content_type: 'markdown', is_published: false, view_count: 0, metadata: {} }],
  PUBLIC: { page: null },
}))

vi.mock('../services/api', () => {
  const ok = (v) => vi.fn().mockResolvedValue(v)
  return {
    api: {
      pages: {
        list: ok(PAGES),
        slugCheck: ok({ available: true, suggestions: [] }),
        preview: ok({ token: 't', expires_in: 900 }),
        versions: ok({ items: [] }),
        get: vi.fn(async (id) => ({ ...PAGES.find(p => p.id === id), content: '# Notes\n\n- [ ] call **Asha**\n- [x] send invoice\n\n> quoted' })),
        create: vi.fn(async (body) => { calls.create.push(body); return { id: 'new1', ...body } }),
        update: vi.fn(async (id, body) => { calls.update.push([id, body]); return { ...PAGES.find(p => p.id === id), ...body } }),
        publicGet: vi.fn(async () => PUBLIC.page),
        publicLogView: vi.fn(async () => ({})),
      },
    },
    API_BASE_URL: 'https://api.example',
  }
})
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ status: 'authed', role: 'editor', authRole: 'user', user: { email: 'm@example.com' }, hasPerm: () => false }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

beforeEach(() => {
  calls.update = []
  calls.create = []
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = window.matchMedia || (q => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  if (window.happyDOM?.settings) window.happyDOM.settings.disableIframePageLoading = true
})

describe('markdown -> blocks', () => {
  const MD = [
    '# Plan **Q4**', '', 'Intro with *emphasis*, `code`, ~~old~~, ==key== and a [link](https://example.com).',
    'Second line.', '', '- one', '- two', '  - nested', '', '1. first', '2. second', '',
    '- [ ] todo', '- [x] done', '', '> a quote', '', '> [!WARNING]', '> careful', '',
    '```js', 'const a = 1', '```', '', '---', '', '| A | B |', '|---|---|', '| 1 | **2** |', '',
    '![chart](/api/public/pages/asset/pages/2026/10/x.png)',
  ].join('\n')
  const doc = markdownToDoc(MD)
  const types = doc.content.map(n => n.type)

  it('maps every block the classic renderer knows', () => {
    expect(types).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'callout', 'codeBlock', 'horizontalRule', 'table', 'image'])
    expect(doc.content[0].attrs.level).toBe(1)
    expect(doc.content[7].attrs.language).toBe('js')
    expect(doc.content[4].content.map(i => i.attrs.checked)).toEqual([false, true])
    expect(doc.content[6].attrs).toEqual({ icon: '⚠️', tone: 'yellow' })
    expect(doc.content[9].content[0].content[0].type).toBe('tableHeader')
  })

  it('keeps nesting and inline marks', () => {
    const nested = doc.content[2].content[1].content[1]
    expect(nested.type).toBe('bulletList')
    const marks = doc.content[1].content.flatMap(n => (n.marks || []).map(m => m.type))
    expect(marks).toEqual(expect.arrayContaining(['italic', 'code', 'strike', 'highlight', 'link']))
    expect(doc.content[1].content.some(n => n.type === 'hardBreak')).toBe(true)
  })

  it('round-trips back to equivalent markdown', () => {
    const again = markdownToDoc(docToMarkdown(doc))
    expect(again.content.map(n => n.type)).toEqual(types)
    expect(docText(again)).toBe(docText(doc))
  })

  it('gives text, word counts, headings and an excerpt without the editor', () => {
    expect(docText(doc).split('\n')[0]).toBe('Plan Q4')
    expect(docWordCount(JSON.stringify(doc))).toBeGreaterThan(10)
    expect(docHeadings(doc)).toEqual([{ level: 1, text: 'Plan Q4', id: 'h-plan-q4' }])
    expect(docExcerpt(doc, 30).endsWith('…')).toBe(true)
  })

  it('ships four ready-made document templates that are valid documents', () => {
    const names = docTemplates().map(t => t.name)
    expect(names).toEqual(['Blank', 'Meeting notes', 'Project brief', 'Weekly update', 'Client proposal'])
    for (const t of docTemplates().slice(1)) expect(parseDoc(t.content)?.content.length).toBeGreaterThan(3)
  })
})

describe('embed allowlist', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['youtu.be/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://www.loom.com/share/0123456789abcdef', 'https://www.loom.com/embed/0123456789abcdef'],
    ['https://docs.google.com/document/d/1AbCdEfGhIj/edit', 'https://docs.google.com/document/d/1AbCdEfGhIj/preview'],
    ['https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/edit#gid=0', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/preview'],
  ])('%s is framed as %s', (url, src) => {
    expect(resolveEmbed(url)?.src).toBe(src)
  })

  it('frames Figma through its embed endpoint', () => {
    expect(resolveEmbed('https://www.figma.com/design/AbC123/Site?node-id=1-2').src)
      .toMatch(/^https:\/\/www\.figma\.com\/embed\?embed_host=fintrack&url=https%3A%2F%2Fwww\.figma\.com%2Fdesign%2FAbC123/)
  })

  it.each([
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/embed/dQw4w9WgXcQ',
    'javascript:alert(1)',
    'https://docs.google.com/forms/d/abcdefgh/viewform',
    'data:text/html,<script>alert(1)</script>',
  ])('%s is refused', (url) => {
    expect(resolveEmbed(url)).toBeNull()
  })

  it('only lets safe links through', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref(' JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeHref('https://example.com')).toBe('https://example.com')
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
  })
})

describe('Convert to blocks', () => {
  it('saves the markdown as a version, then switches the page to a block document', async () => {
    const PagesManager = (await import('../pages/PagesManager')).default
    render(<MemoryRouter><PagesManager /></MemoryRouter>)
    fireEvent.click((await screen.findAllByRole('button', { name: /Edit/ }))[0])
    await waitFor(() => expect(document.querySelector('textarea')?.value).toContain('# Notes'))

    fireEvent.click(screen.getByRole('button', { name: /Convert to blocks/ }))

    await waitFor(() => expect(calls.update.length).toBe(1))
    const [id, body] = calls.update[0]
    expect(id).toBe('m1')
    expect(body.content_type).toBe('doc')
    expect(body.version_note).toBe('Before converting to blocks')
    const doc = JSON.parse(body.content)
    expect(doc.content.map(n => n.type)).toEqual(['heading', 'taskList', 'blockquote'])

    // The editor now shows the blocks, and the type picker says Document.
    await waitFor(() => expect(document.querySelector('.ft-blocks h1')?.textContent).toBe('Notes'))
    expect(document.querySelectorAll('.ft-blocks ul[data-type="taskList"] li').length).toBe(2)
    expect(screen.getByDisplayValue('📝 Document')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Convert to blocks/ })).toBeNull()
  })

  it('new pages start as block documents', async () => {
    const PagesManager = (await import('../pages/PagesManager')).default
    render(<MemoryRouter><PagesManager /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /New Page/ }))
    expect(await screen.findByDisplayValue('📝 Document')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Markdown \(classic\)/ })).toBeInTheDocument()
    expect(await screen.findByLabelText('Page title')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.ft-blocks .ProseMirror')).not.toBeNull())
  })
})

describe('public viewer', () => {
  const DOC = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Launch plan' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Read the ' },
        { type: 'text', text: 'brief', marks: [{ type: 'link', attrs: { href: 'https://example.com/brief' } }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'this', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
      ] },
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Book venue' }] }] },
      ] },
      { type: 'details', attrs: { open: false }, content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'Budget' }] },
        { type: 'detailsContent', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two lakh' }] }] },
      ] },
      { type: 'callout', attrs: { icon: '💡', tone: 'blue' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tip' }] }] },
      { type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: 'const total = 1' }] },
      { type: 'embed', attrs: { url: 'https://youtu.be/dQw4w9WgXcQ' } },
      { type: 'embed', attrs: { url: 'https://evil.example/x' } },
      { type: 'image', attrs: { src: '/api/public/pages/asset/pages/a.png', alt: 'chart' } },
      { type: 'image', attrs: { src: 'javascript:alert(1)', alt: 'bad' } },
    ],
  }

  async function open(page) {
    PUBLIC.page = { id: '1', slug: 'launch', title: 'Launch', content_type: 'doc', content: JSON.stringify(DOC), metadata: {}, published_at: '2026-10-01T00:00:00Z', ...page }
    const PageViewer = (await import('../pages/PageViewer')).default
    render(<MemoryRouter initialEntries={['/p/launch']}><Routes><Route path="/p/:slug" element={<PageViewer />} /></Routes></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('.ft-blocks.is-public .ProseMirror')).not.toBeNull())
    return document.querySelector('.ft-blocks.is-public')
  }

  it('renders the document read-only with the editor styles', async () => {
    const root = await open()
    expect(root.querySelector('[contenteditable="true"]')).toBeNull()
    expect(within(root).getByRole('heading', { level: 1 })).toHaveTextContent('Launch plan')
    expect(root.querySelector('h1').id).toBe('h-launch-plan')
    expect(root.querySelector('.ft-callout[data-tone="blue"]')).toHaveTextContent('Tip')
    // Code is highlighted.
    expect(root.querySelector('.ft-code .hljs-keyword')?.textContent).toBe('const')
    // To-dos show their state and cannot be changed.
    const box = root.querySelector('ul[data-type="taskList"] input[type="checkbox"]')
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(box.checked).toBe(true)
    expect(screen.getByText(/min read/)).toBeInTheDocument()
  })

  it('opens and closes toggles', async () => {
    const root = await open()
    const toggle = root.querySelector('.ft-toggle')
    const body = toggle.querySelector('[data-type="detailsContent"]')
    expect(body.hasAttribute('hidden')).toBe(true)
    fireEvent.click(toggle.querySelector('button'))
    expect(body.hasAttribute('hidden')).toBe(false)
    expect(toggle.classList.contains('is-open')).toBe(true)
    fireEvent.click(toggle.querySelector('button'))
    expect(body.hasAttribute('hidden')).toBe(true)
  })

  it('frames only allowlisted embeds, lazily, and drops unsafe links and images', async () => {
    const root = await open()
    const frames = root.querySelectorAll('iframe')
    expect(frames.length).toBe(1)
    expect(frames[0].getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(frames[0].getAttribute('loading')).toBe('lazy')
    expect(frames[0].getAttribute('sandbox')).toContain('allow-scripts')
    expect(root.querySelector('a[href="https://evil.example/x"]')).not.toBeNull()

    const hrefs = [...root.querySelectorAll('a')].map(a => a.getAttribute('href') || '')
    expect(hrefs).toContain('https://example.com/brief')
    expect(hrefs.some(h => /javascript:/i.test(h))).toBe(false)

    const srcs = [...root.querySelectorAll('img')].map(i => i.getAttribute('src') || '')
    expect(srcs).toContain('https://api.example/api/public/pages/asset/pages/a.png')
    expect(srcs.some(s => /javascript:/i.test(s))).toBe(false)
  })

  it('honours protect_source: no context menu, no copy button on code', async () => {
    const root = await open({ metadata: { protect_source: true } })
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    root.querySelector('p').dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(root.querySelector('.ft-code-copy')).toBeNull()
  })

  it('lists headings in a contents panel once there are enough of them', async () => {
    const many = { type: 'doc', content: ['One', 'Two', 'Three'].map(t => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] })) }
    await open({ content: JSON.stringify(many) })
    expect(screen.getByText('Contents')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Three' }).getAttribute('href')).toBe('#h-three')
  })
})
