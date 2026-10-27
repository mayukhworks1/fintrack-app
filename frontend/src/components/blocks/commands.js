// The block commands offered by the "/" menu and the "Turn into" menu.
// Later phases add entries here (page links, databases, artifacts) by
// appending to the list passed to the editor; each entry is self-contained.
import {
  Pilcrow, Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, ChevronRight,
  Quote, Lightbulb, Minus, SquareCode, Image as ImageIcon, Youtube, Table, FilePlus2, Link2, Puzzle,
} from 'lucide-react'

const clear = (editor, range) => editor.chain().focus().deleteRange(range)

export const BLOCK_COMMANDS = [
  { id: 'text', group: 'Basic blocks', title: 'Text', description: 'Plain text', icon: Pilcrow, keywords: ['paragraph', 'p', 'plain'],
    run: (e, r) => clear(e, r).setParagraph().run() },
  { id: 'h1', group: 'Basic blocks', title: 'Heading 1', description: 'Big section heading', icon: Heading1, keywords: ['h1', 'title', '#'], shortcut: '#',
    run: (e, r) => clear(e, r).setNode('heading', { level: 1 }).run() },
  { id: 'h2', group: 'Basic blocks', title: 'Heading 2', description: 'Medium section heading', icon: Heading2, keywords: ['h2', 'subtitle', '##'], shortcut: '##',
    run: (e, r) => clear(e, r).setNode('heading', { level: 2 }).run() },
  { id: 'h3', group: 'Basic blocks', title: 'Heading 3', description: 'Small section heading', icon: Heading3, keywords: ['h3', '###'], shortcut: '###',
    run: (e, r) => clear(e, r).setNode('heading', { level: 3 }).run() },
  { id: 'bullet', group: 'Basic blocks', title: 'Bulleted list', description: 'A simple bulleted list', icon: List, keywords: ['ul', 'unordered', 'bullets', '-'], shortcut: '-',
    run: (e, r) => clear(e, r).toggleBulletList().run() },
  { id: 'numbered', group: 'Basic blocks', title: 'Numbered list', description: 'A list with numbering', icon: ListOrdered, keywords: ['ol', 'ordered', '1.'], shortcut: '1.',
    run: (e, r) => clear(e, r).toggleOrderedList().run() },
  { id: 'todo', group: 'Basic blocks', title: 'To-do list', description: 'Track tasks with checkboxes', icon: ListTodo, keywords: ['task', 'checkbox', 'check', 'todo', '[]'], shortcut: '[]',
    run: (e, r) => clear(e, r).toggleTaskList().run() },
  { id: 'toggle', group: 'Basic blocks', title: 'Toggle', description: 'Content that can be shown or hidden', icon: ChevronRight, keywords: ['collapse', 'details', 'fold', 'accordion'],
    run: (e, r) => {
      clear(e, r).insertContent({ type: 'details', attrs: { open: true }, content: [{ type: 'detailsSummary' }, { type: 'detailsContent', content: [{ type: 'paragraph' }] }] }).run()
      // Start typing in the toggle's summary line, not inside its body.
      const { $from } = e.state.selection
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'details') { e.chain().setTextSelection($from.before(d) + 2).run(); break }
      }
    } },
  { id: 'quote', group: 'Basic blocks', title: 'Quote', description: 'Capture a quotation', icon: Quote, keywords: ['blockquote', '>'], shortcut: '>',
    run: (e, r) => clear(e, r).toggleBlockquote().run() },
  { id: 'callout', group: 'Basic blocks', title: 'Callout', description: 'Make a note stand out', icon: Lightbulb, keywords: ['note', 'info', 'warning', 'tip', 'box'],
    run: (e, r) => clear(e, r).setCallout({ icon: '💡', tone: 'default' }).run() },
  { id: 'divider', group: 'Basic blocks', title: 'Divider', description: 'Separate sections', icon: Minus, keywords: ['hr', 'rule', 'line', 'separator', '---'], shortcut: '---',
    run: (e, r) => clear(e, r).setHorizontalRule().run() },
  { id: 'code', group: 'Basic blocks', title: 'Code', description: 'Code with syntax highlighting', icon: SquareCode, keywords: ['codeblock', 'snippet', 'pre', '```'], shortcut: '```',
    run: (e, r) => clear(e, r).setCodeBlock().run() },

  { id: 'image', group: 'Media', title: 'Image', description: 'Upload an image', icon: ImageIcon, keywords: ['picture', 'photo', 'upload', 'img'],
    run: (e, r) => { clear(e, r).run(); e.storage.blocks?.pickImage?.() } },
  { id: 'embed', group: 'Media', title: 'Embed', description: 'YouTube, Loom, Figma, Google Docs or Sheets', icon: Youtube, keywords: ['video', 'youtube', 'loom', 'figma', 'google', 'docs', 'sheets', 'slides', 'iframe'],
    run: (e, r) => clear(e, r).insertEmbed('').run() },

  // Page entries work through editor.storage.blocks.pages, which the editor
  // sets up only for a saved page (see BlockEditor's pageId).
  { id: 'subpage', group: 'Pages', title: 'Sub-page', description: 'A new page inside this one, linked here', icon: FilePlus2, keywords: ['page', 'child', 'subpage', 'new page'],
    available: e => !!e.storage.blocks?.pages,
    run: (e, r) => { clear(e, r).run(); e.storage.blocks.pages.createSubPage() } },
  { id: 'linkpage', group: 'Pages', title: 'Link to page', description: 'Link to another page', icon: Link2, keywords: ['page', 'mention', 'link', 'reference'],
    available: e => !!e.storage.blocks?.pages,
    run: (e, r) => { clear(e, r).run(); e.storage.blocks.pages.pickPage() } },
  { id: 'artifact', group: 'Pages', title: 'Artifact', description: 'A calculator, tracker or form from your pages', icon: Puzzle, keywords: ['app', 'calculator', 'tool', 'widget', 'form', 'tracker', 'mini-app'],
    available: e => !!e.storage.blocks?.pages,
    run: (e, r) => { clear(e, r).run(); e.storage.blocks.pages.pickArtifact() } },

  { id: 'table', group: 'Advanced', title: 'Table', description: 'Rows and columns', icon: Table, keywords: ['grid', 'cells', 'spreadsheet'],
    run: (e, r) => clear(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
]

export const GROUP_ORDER = ['Basic blocks', 'Pages', 'Media', 'Advanced']

/** Commands whose title or keywords match the query, best matches first. */
export function filterCommands(commands, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return commands
  const scored = []
  for (const c of commands) {
    const title = c.title.toLowerCase()
    let score = -1
    if (title.startsWith(q)) score = 3
    else if (title.split(/\s+/).some(w => w.startsWith(q))) score = 2
    else if ((c.keywords || []).some(k => k.toLowerCase().startsWith(q))) score = 1
    else if (title.replace(/[^a-z0-9]/g, '').includes(q.replace(/[^a-z0-9]/g, '')) && q.replace(/[^a-z0-9]/g, '')) score = 0
    if (score >= 0) scored.push([score, c])
  }
  return scored.sort((a, b) => b[0] - a[0]).map(([, c]) => c)
}

// "Turn into" targets for the selection toolbar and the block menu.
export const TURN_INTO = [
  { id: 'text', label: 'Text', run: e => e.chain().focus().clearNodes().run() },
  { id: 'h1', label: 'Heading 1', run: e => e.chain().focus().clearNodes().setNode('heading', { level: 1 }).run(), active: e => e.isActive('heading', { level: 1 }) },
  { id: 'h2', label: 'Heading 2', run: e => e.chain().focus().clearNodes().setNode('heading', { level: 2 }).run(), active: e => e.isActive('heading', { level: 2 }) },
  { id: 'h3', label: 'Heading 3', run: e => e.chain().focus().clearNodes().setNode('heading', { level: 3 }).run(), active: e => e.isActive('heading', { level: 3 }) },
  { id: 'bullet', label: 'Bulleted list', run: e => e.chain().focus().clearNodes().toggleBulletList().run(), active: e => e.isActive('bulletList') },
  { id: 'numbered', label: 'Numbered list', run: e => e.chain().focus().clearNodes().toggleOrderedList().run(), active: e => e.isActive('orderedList') },
  { id: 'todo', label: 'To-do list', run: e => e.chain().focus().clearNodes().toggleTaskList().run(), active: e => e.isActive('taskList') },
  { id: 'quote', label: 'Quote', run: e => e.chain().focus().clearNodes().toggleBlockquote().run(), active: e => e.isActive('blockquote') },
  { id: 'callout', label: 'Callout', run: e => e.chain().focus().clearNodes().setCallout().run(), active: e => e.isActive('callout') },
  { id: 'code', label: 'Code', run: e => e.chain().focus().clearNodes().setCodeBlock().run(), active: e => e.isActive('codeBlock') },
]
