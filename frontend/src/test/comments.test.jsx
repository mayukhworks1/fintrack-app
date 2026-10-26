/**
 * Page comments and the notification bell: the panel lists threads, the
 * composer's @mention autocomplete inserts a token, the bell shows the unread
 * count and marks notifications read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const ROOT_ID = '11111111-1111-4111-8111-111111111111'
const ALICE_ID = '22222222-2222-4222-8222-222222222222'

const { db, calls } = vi.hoisted(() => ({ db: { threads: [], notifications: [], unread: 0 }, calls: [] }))

vi.mock('../services/api', () => {
  const rec = (name, fn) => vi.fn(async (...args) => { calls.push([name, ...args]); return fn(...args) })
  return {
    api: {
      comments: {
        list: rec('list', () => ({ ready: true, threads: db.threads, counts: {
          open: db.threads.filter(t => !t.resolved_at).length,
          resolved: db.threads.filter(t => t.resolved_at).length,
        } })),
        create: rec('create', (pageId, data) => ({
          id: 't-new', page_id: pageId, anchor: data.anchor || null, resolved_at: null, created_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
          comments: [{ id: 't-new', thread_id: 't-new', author: { id: ALICE_ID, name: 'Alice Rao' }, body: data.body, created_at: new Date().toISOString(), mine: true }],
        })),
        reply: rec('reply', () => ({})),
        edit: rec('edit', () => ({})),
        remove: rec('remove', () => ({ ok: true })),
        resolve: rec('resolve', (pageId, threadId) => ({ ...db.threads.find(t => t.id === threadId), resolved_at: '2026-10-26T10:00:00Z' })),
        reopen: rec('reopen', () => ({})),
        mentions: rec('mentions', (pageId, q) => [
          { id: ROOT_ID, name: 'Root Admin', email: 'root@x.in' },
          { id: ALICE_ID, name: 'Alice Rao', email: 'alice@x.in', me: true },
        ].filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()))),
      },
      notifications: {
        unreadCount: rec('unreadCount', () => ({ count: db.unread })),
        list: rec('nlist', () => ({ ready: true, items: db.notifications, unread: db.unread })),
        markRead: rec('markRead', () => { db.unread = Math.max(0, db.unread - 1); return { ok: true, unread: db.unread } }),
        markAllRead: rec('markAllRead', () => { db.unread = 0; return { ok: true, unread: 0 } }),
      },
    },
    API_BASE_URL: '',
    getAuthToken: () => '',
  }
})

const NOW = Date.now()
const ago = (min) => new Date(NOW - min * 60000).toISOString()

function thread(id, over = {}) {
  return {
    id, page_id: 'p1', anchor: null, resolved_at: null, created_at: ago(30), last_activity_at: ago(5),
    comments: [
      { id, thread_id: id, author: { id: ALICE_ID, name: 'Alice Rao' }, body: `Check @[Root Admin](${ROOT_ID}) please`, created_at: ago(30), mine: true },
      { id: `${id}-r`, thread_id: id, parent_id: id, author: { id: ROOT_ID, name: 'Root Admin' }, body: 'Done', created_at: ago(5), mine: false },
    ],
    ...over,
  }
}

beforeEach(async () => {
  calls.length = 0
  db.threads = []
  db.notifications = []
  db.unread = 0
  const { _resetCommentsStore } = await import('../components/comments/useComments')
  _resetCommentsStore()
  const { _resetNotificationStore } = await import('../components/notifications/notificationStore')
  _resetNotificationStore()
})

afterEach(() => { vi.useRealTimers() })

describe('comments model', () => {
  it('round-trips mention tokens through the composer draft', async () => {
    const m = await import('../components/comments/commentsModel')
    const draft = m.tokensToDraft(`hi @[Ann Lee](${ROOT_ID}) and @[Ann](${ALICE_ID})`)
    expect(draft.text).toBe('hi @Ann Lee and @Ann')
    expect(m.draftToTokens(draft.text, draft.mentions)).toBe(`hi @[Ann Lee](${ROOT_ID}) and @[Ann](${ALICE_ID})`)
    expect(m.mentionQueryAt('hello @ro', 9)).toEqual({ query: 'ro', start: 6, end: 9 })
    expect(m.mentionQueryAt('mail a@b', 8)).toBeNull()
  })

  it('formats relative times in IST', async () => {
    const { relativeIst, fullIst } = await import('../components/comments/commentsModel')
    const now = Date.parse('2026-10-26T12:00:00Z')
    expect(relativeIst('2026-10-26T11:59:40Z', now)).toBe('just now')
    expect(relativeIst('2026-10-26T11:15:00Z', now)).toBe('45m ago')
    expect(relativeIst('2026-10-25T11:00:00Z', now)).toBe('yesterday')
    // 20:00 UTC on 1 Oct is 1:30 am on 2 Oct in India.
    expect(relativeIst('2026-10-01T20:00:00Z', now)).toBe('2 Oct')
    expect(fullIst('2026-10-01T20:00:00Z')).toMatch(/2 Oct 2026.*1:30.*am IST/i)
  })
})

describe('CommentsPanel', () => {
  async function mount(props = {}) {
    const CommentsPanel = (await import('../components/comments/CommentsPanel')).default
    return render(<CommentsPanel pageId="p1" onClose={() => {}} {...props} />)
  }

  it('renders open threads with replies and mention chips, and filters resolved', async () => {
    db.threads = [
      thread('t1'),
      thread('t2', { resolved_at: ago(1), resolved_by: { name: 'Root Admin' }, anchor: { block_id: 'b1', quote: 'Revenue grew 12%' } }),
    ]
    await mount()
    const open = await screen.findAllByRole('article')
    expect(open).toHaveLength(1)
    expect(within(open[0]).getByText('@Root Admin')).toHaveClass('cmt-mention')
    expect(within(open[0]).getByText('Done')).toBeInTheDocument()
    expect(within(open[0]).getByText('5m ago')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Open (1)' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: 'Resolved (1)' }))
    const [resolved] = screen.getAllByRole('article')
    expect(within(resolved).getByText('“Revenue grew 12%”')).toBeInTheDocument()
    expect(within(resolved).getByText(/Resolved by Root Admin/)).toBeInTheDocument()

    // "Go to" hands the anchor to whoever renders the page (the block editor).
    const seen = []
    const { onCommentGoTo } = await import('../components/comments/commentsModel')
    const off = onCommentGoTo(d => seen.push(d))
    fireEvent.click(within(resolved).getByRole('button', { name: /Go to/ }))
    off()
    expect(seen).toEqual([{ pageId: 'p1', threadId: 't2', anchor: { block_id: 'b1', quote: 'Revenue grew 12%' } }])
  })

  it('resolves a thread', async () => {
    db.threads = [thread('t1')]
    await mount()
    const [card] = await screen.findAllByRole('article')
    fireEvent.click(within(card).getByRole('button', { name: /Resolve/ }))
    await waitFor(() => expect(calls.some(c => c[0] === 'resolve' && c[2] === 't1')).toBe(true))
    await waitFor(() => expect(screen.queryAllByRole('article')).toHaveLength(0))
    expect(screen.getByRole('tab', { name: 'Resolved (1)' })).toBeInTheDocument()
  })

  it('reloads from the server after posting and resolving, picking up others\' replies', async () => {
    db.threads = [thread('t1')]
    await mount()
    await screen.findAllByRole('article')
    const lists = () => calls.filter(c => c[0] === 'list').length
    const before = lists()
    // Meanwhile someone else replied on the server.
    db.threads = [{ ...thread('t1'), comments: [...thread('t1').comments, { id: 't1-x', thread_id: 't1', parent_id: 't1', author: { id: ROOT_ID, name: 'Root Admin' }, body: 'Also this', created_at: ago(1), mine: false }] }]
    fireEvent.change(screen.getByRole('textbox', { name: 'New comment' }), { target: { value: 'Page note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(lists()).toBeGreaterThan(before), { timeout: 2000 })
    expect(await screen.findByText('Also this')).toBeInTheDocument()
    const afterPost = lists()
    fireEvent.click(within(screen.getAllByRole('article')[0]).getByRole('button', { name: /Resolve/ }))
    await waitFor(() => expect(lists()).toBeGreaterThan(afterPost), { timeout: 2000 })
  })

  it('tells people who can be mentioned', async () => {
    await mount()
    expect(await screen.findByText(/mention the page owner and workspace admins/)).toBeInTheDocument()
  })

  it('shows 30 threads at a time', async () => {
    db.threads = Array.from({ length: 45 }, (_, i) => thread(`t${i}`))
    await mount()
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(30))
    fireEvent.click(screen.getByRole('button', { name: /Show more \(15 more\)/ }))
    expect(screen.getAllByRole('article')).toHaveLength(45)
  })

  it('mention autocomplete inserts a token that is sent on submit', async () => {
    await mount()
    await waitFor(() => expect(calls.some(c => c[0] === 'list')).toBe(true))
    const box = screen.getByRole('textbox', { name: 'New comment' })
    fireEvent.change(box, { target: { value: 'Ping @ro', selectionStart: 8 } })
    const option = await screen.findByRole('option', { name: /Root Admin/ })
    expect(screen.queryByRole('option', { name: /Alice/ })).toBeNull()
    fireEvent.mouseDown(option)
    expect(box.value).toBe('Ping @Root Admin ')
    fireEvent.change(box, { target: { value: 'Ping @Root Admin can you check?', selectionStart: 31 } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(calls.find(c => c[0] === 'create')).toBeTruthy())
    const [, pageId, data] = calls.find(c => c[0] === 'create')
    expect(pageId).toBe('p1')
    expect(data.body).toBe(`Ping @[Root Admin](${ROOT_ID}) can you check?`)
    expect(await screen.findByText('@Root Admin')).toHaveClass('cmt-mention')
  })

  it('keyboard picks a mention with Enter', async () => {
    await mount()
    const box = screen.getByRole('textbox', { name: 'New comment' })
    fireEvent.change(box, { target: { value: '@', selectionStart: 1 } })
    await screen.findAllByRole('option')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.value).toBe('@Alice Rao ')
  })

  it('says so when comments are not switched on yet', async () => {
    const { api } = await import('../services/api')
    api.comments.list.mockImplementationOnce(async () => ({ ready: false, threads: [], counts: { open: 0, resolved: 0 } }))
    await mount()
    expect(await screen.findByText(/database update/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'New comment' })).toBeNull()
  })
})

describe('CommentsToggle', () => {
  it('shows the open count and opens the panel, also on request', async () => {
    db.threads = [thread('t1'), thread('t2')]
    const CommentsToggle = (await import('../components/comments/CommentsToggle')).default
    render(<CommentsToggle pageId="p1" />)
    const btn = await screen.findByRole('button', { name: 'Comments (2 open)' })
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull()
    fireEvent.click(btn)
    expect(await screen.findByRole('complementary', { name: 'Comments' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close comments' }))
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull()
    const { openCommentsPanel } = await import('../components/comments/commentsModel')
    act(() => openCommentsPanel('p1', 't2'))
    const panel = await screen.findByRole('complementary', { name: 'Comments' })
    await waitFor(() => expect(panel.querySelector('[data-thread-id="t2"]')).toHaveClass('is-focus'))
  })
})

describe('CommentAnchorButton', () => {
  it('starts a thread anchored to the selection', async () => {
    const CommentAnchorButton = (await import('../components/comments/CommentAnchorButton')).default
    render(<CommentAnchorButton pageId="p1" anchor={{ block_id: 'b7', from: 3, to: 9, quote: 'margin' }} />)
    fireEvent.click(screen.getByRole('button', { name: /Comment/ }))
    const box = screen.getByRole('textbox', { name: 'Comment on selection' })
    fireEvent.change(box, { target: { value: 'Is this right?', selectionStart: 14 } })
    const dialog = screen.getByRole('dialog', { name: 'Comment on selection' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(calls.find(c => c[0] === 'create')).toBeTruthy())
    expect(calls.find(c => c[0] === 'create')[2]).toEqual({
      body: 'Is this right?', anchor: { block_id: 'b7', from: 3, to: 9, quote: 'margin' },
    })
  })
})

describe('NotificationBell', () => {
  function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div> }

  async function mountBell() {
    const NotificationBell = (await import('../components/notifications/NotificationBell')).default
    return render(
      <MemoryRouter initialEntries={['/']}>
        <NotificationBell variant="sidebar" />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>,
    )
  }

  it('shows the unread count, lists notifications and marks one read on open', async () => {
    db.unread = 2
    db.notifications = [
      { id: 'n1', kind: 'mention', page_id: 'p1', page_title: 'Q3 plan', thread_id: 't1', excerpt: 'Ping @Root Admin', actor: { name: 'Alice Rao' }, read: false, created_at: ago(3) },
      { id: 'n2', kind: 'reply', page_id: 'p2', page_title: 'Budget', thread_id: 't9', excerpt: 'ok', actor: { name: 'Bob' }, read: false, created_at: ago(90) },
    ]
    await mountBell()
    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('2')
    fireEvent.click(screen.getByRole('button', { name: 'Notifications (2 unread)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Notifications' })
    const item = await within(dialog).findByText('Ping @Root Admin')
    expect(within(dialog).getByText('mentioned you on')).toBeInTheDocument()
    fireEvent.click(item.closest('button'))
    await waitFor(() => expect(calls.some(c => c[0] === 'markRead' && c[1] === 'n1')).toBe(true))
    expect(screen.getByTestId('where')).toHaveTextContent('/pages?page=p1&comments=1&thread=t1')
    await waitFor(() => expect(screen.getByTestId('notification-badge')).toHaveTextContent('1'))
  })

  it('marks all read', async () => {
    db.unread = 3
    db.notifications = [{ id: 'n1', kind: 'mention', page_id: 'p1', page_title: 'X', actor: { name: 'A' }, read: false, created_at: ago(1) }]
    await mountBell()
    await screen.findByTestId('notification-badge')
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Notifications' })
    await within(dialog).findByText('X')
    fireEvent.click(within(dialog).getByRole('button', { name: /Mark all read/ }))
    await waitFor(() => expect(screen.queryByTestId('notification-badge')).toBeNull())
    expect(calls.some(c => c[0] === 'markAllRead')).toBe(true)
  })

  it('polls every 60s and pauses while the tab is hidden', async () => {
    vi.useFakeTimers()
    const { POLL_MS } = await import('../components/notifications/notificationStore')
    const NotificationBell = (await import('../components/notifications/NotificationBell')).default
    render(<MemoryRouter><NotificationBell variant="icon" /></MemoryRouter>)
    const polls = () => calls.filter(c => c[0] === 'unreadCount').length
    expect(polls()).toBe(1)
    await act(async () => { vi.advanceTimersByTime(POLL_MS) })
    expect(polls()).toBe(2)
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { vi.advanceTimersByTime(POLL_MS * 3) })
    expect(polls()).toBe(2)
    vis.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(polls()).toBe(3)
    vis.mockRestore()
  })
})
