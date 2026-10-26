/**
 * The block editor: the "/" menu inserts blocks (by keyboard and by tap),
 * Markdown shortcuts become blocks as they are typed, and the value the editor
 * reports is the TipTap JSON stored in a page's content.
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import BlockEditor from '../components/blocks/BlockEditor'

vi.mock('../services/api', () => ({ api: { pages: {} }, API_BASE_URL: 'https://api.example' }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = window.matchMedia || (q => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})
afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-slash-menu]').forEach(n => n.remove())
})

async function setup(value = '') {
  let editor = null
  const onChange = vi.fn()
  render(<BlockEditor value={value} onChange={onChange} onReady={e => { editor = e }} />)
  await waitFor(() => expect(editor).not.toBeNull())
  editor.commands.focus('end')
  const last = () => JSON.parse(onChange.mock.calls.at(-1)[0])
  return { editor, onChange, last }
}

// Types text the way the browser does: each character goes through the
// view's text-input handlers first (that is where input rules live), and is
// inserted only if none of them took it.
function type(editor, text) {
  const { view } = editor
  for (const ch of text) {
    act(() => {
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', f => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
    })
  }
}

function key(editor, k) {
  act(() => { editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
}

const topTypes = (doc) => doc.content.map(n => n.type)

describe('slash menu', () => {
  it('opens on "/", filters as you type, and inserts the chosen block with Enter', async () => {
    const { editor, last } = await setup()
    type(editor, '/')
    const menu = await waitFor(() => {
      const m = document.querySelector('[data-slash-menu]')
      expect(m).not.toBeNull()
      return m
    })
    // Grouped while browsing.
    expect(menu.textContent).toContain('Basic blocks')
    expect(menu.textContent).toContain('Media')
    expect(menu.querySelectorAll('[role="option"]').length).toBeGreaterThan(10)

    type(editor, 'head')
    await waitFor(() => expect(document.querySelectorAll('[data-slash-menu] [role="option"]').length).toBe(3))
    key(editor, 'ArrowDown')
    await waitFor(() => expect(document.querySelector('[data-slash-menu] [aria-selected="true"]').dataset.command).toBe('h2'))
    key(editor, 'Enter')

    await waitFor(() => expect(document.querySelector('[data-slash-menu]')).toBeNull())
    const doc = last()
    expect(doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    // The "/head" query is removed, not left in the heading.
    expect(doc.content[0].content).toBeUndefined()
  })

  it('inserts a block when an item is tapped', async () => {
    const { editor, last } = await setup()
    type(editor, '/to')
    const item = await waitFor(() => {
      const el = document.querySelector('[data-slash-menu] [data-command="todo"]')
      expect(el).not.toBeNull()
      return el
    })
    fireEvent.click(item)
    await waitFor(() => expect(topTypes(last())).toContain('taskList'))
  })

  it.each([
    ['callout', 'callout'],
    ['toggle', 'details'],
    ['table', 'table'],
    ['divider', 'horizontalRule'],
    ['code', 'codeBlock'],
    ['embed', 'embed'],
  ])('"/%s" inserts a %s block', async (query, nodeType) => {
    const { editor, last } = await setup()
    type(editor, `/${query}`)
    await waitFor(() => expect(document.querySelector('[data-slash-menu] [aria-selected="true"]')).not.toBeNull())
    key(editor, 'Enter')
    await waitFor(() => expect(topTypes(last())).toContain(nodeType))
  })

  it('stays open while the page holding the document re-renders on every keystroke', async () => {
    // PagesManager keeps the content in state, so the editor re-renders as the
    // author types; that must not reset the editor's plugins and close the menu.
    let editor = null
    function Host() {
      const [v, setV] = useState('')
      return <BlockEditor value={v} onChange={setV} onReady={e => { editor = e }} />
    }
    render(<Host />)
    await waitFor(() => expect(editor?.storage.blocks).toBeTruthy())
    editor.commands.focus('end')
    type(editor, '/')
    await waitFor(() => expect(document.querySelector('[data-slash-menu]')).not.toBeNull())
    type(editor, 'quo')
    await waitFor(() => expect(document.querySelector('[data-slash-menu] [aria-selected="true"]')?.dataset.command).toBe('quote'))
    key(editor, 'Enter')
    await waitFor(() => expect(editor.getJSON().content[0].type).toBe('blockquote'))
  })

  it('puts the cursor in a new toggle\'s summary line', async () => {
    const { editor, last } = await setup()
    type(editor, '/toggle')
    await waitFor(() => expect(document.querySelector('[data-slash-menu] [aria-selected="true"]')?.dataset.command).toBe('toggle'))
    key(editor, 'Enter')
    type(editor, 'Appendix')
    await waitFor(() => {
      const details = last().content.find(n => n.type === 'details')
      expect(details.content[0]).toMatchObject({ type: 'detailsSummary', content: [{ text: 'Appendix' }] })
    })
  })

  it('says so when nothing matches, and Escape closes it', async () => {
    const { editor } = await setup()
    type(editor, '/zzzz')
    await waitFor(() => expect(document.querySelector('[data-slash-menu]')?.textContent).toContain('No matching blocks'))
    key(editor, 'Escape')
    await waitFor(() => expect(document.querySelector('[data-slash-menu]')).toBeNull())
    expect(editor.getText()).toBe('/zzzz')
  })

  it('does not open in the middle of a word, so URLs and dates stay text', async () => {
    const { editor } = await setup()
    type(editor, 'and/or 1/2')
    await new Promise(r => setTimeout(r, 30))
    expect(document.querySelector('[data-slash-menu]')).toBeNull()
  })
})

describe('markdown shortcuts', () => {
  it.each([
    ['# ', 'heading', { level: 1 }],
    ['## ', 'heading', { level: 2 }],
    ['### ', 'heading', { level: 3 }],
    ['- ', 'bulletList'],
    ['* ', 'bulletList'],
    ['1. ', 'orderedList'],
    ['[ ] ', 'taskList'],
    ['> ', 'blockquote'],
    ['``` ', 'codeBlock'],
    ['---', 'horizontalRule'],
  ])('"%s" becomes a %s', async (typed, nodeType, attrs) => {
    const { editor, last } = await setup()
    type(editor, typed)
    await waitFor(() => expect(topTypes(last())).toContain(nodeType))
    if (attrs) expect(last().content.find(n => n.type === nodeType).attrs).toMatchObject(attrs)
  })

  it('applies inline marks: **bold**, *italic*, `code`, ~~strike~~, ==highlight==', async () => {
    const { editor, last } = await setup()
    type(editor, '**bold** *it* `c` ~~s~~ ==h== ')
    await waitFor(() => {
      const marks = (last().content[0].content || []).flatMap(n => (n.marks || []).map(m => m.type))
      expect(marks).toEqual(expect.arrayContaining(['bold', 'italic', 'code', 'strike', 'highlight']))
    })
  })
})

describe('value', () => {
  it('opens stored JSON and replaces it when the value changes from outside', async () => {
    const doc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hello' }] }] }
    let editor = null
    const { rerender } = render(<BlockEditor value={JSON.stringify(doc)} onChange={() => {}} onReady={e => { editor = e }} />)
    await waitFor(() => expect(editor).not.toBeNull())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello')
    const next = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Swapped' }] }] }
    rerender(<BlockEditor value={JSON.stringify(next)} onChange={() => {}} onReady={e => { editor = e }} />)
    await waitFor(() => expect(editor.getText()).toBe('Swapped'))
  })

  it('opens Markdown text as blocks rather than failing', async () => {
    const { editor } = await setup('# Title\n\n- one\n- two')
    // The editor keeps an empty line after the last block to type into.
    expect(editor.getJSON().content.map(n => n.type).slice(0, 2)).toEqual(['heading', 'bulletList'])
  })

  it('shows the placeholder hint on an empty line', async () => {
    await setup()
    expect(document.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')).toBe("Type '/' for commands")
  })
})
