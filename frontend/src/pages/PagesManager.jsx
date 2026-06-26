import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../services/api'

// ---------------------------------------------------------------------------
// Markdown renderer (no external dependency)
// ---------------------------------------------------------------------------
function renderMarkdown(md) {
  if (!md) return ''
  let html = md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
  html = html
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul\/]|<blockquote)(.+)$/gm, (_, line) => `<p>${line}</p>`)
  return html
}

// ---------------------------------------------------------------------------
// CSV → table
// ---------------------------------------------------------------------------
function parseCSV(text) {
  if (!text) return { headers: [], rows: [] }
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim()))
  return { headers, rows }
}

function CSVTable({ text }) {
  const { headers, rows } = parseCSV(text)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ border: '1px solid var(--border)', padding: '6px 10px', background: 'var(--bg-card)', textAlign: 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ border: '1px solid var(--border)', padding: '6px 10px' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Content Preview
// ---------------------------------------------------------------------------
function ContentPreview({ contentType, content }) {
  if (!content) return <div style={{ color: 'var(--text-2)', fontSize: 13, padding: 16 }}>No content to preview.</div>

  if (contentType === 'markdown') {
    return (
      <div
        className="md-preview"
        style={{ padding: '16px 20px', lineHeight: 1.7, fontSize: 14, color: 'var(--text-1)' }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    )
  }
  if (contentType === 'html') {
    return (
      <iframe
        srcDoc={content}
        style={{ width: '100%', height: '100%', minHeight: 300, border: 'none', background: '#fff' }}
        sandbox="allow-scripts allow-same-origin"
        title="HTML Preview"
      />
    )
  }
  if (contentType === 'csv') {
    return <div style={{ padding: 16 }}><CSVTable text={content} /></div>
  }
  return <pre style={{ padding: 16, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{content}</pre>
}

// ---------------------------------------------------------------------------
// Slugify helper (mirrors backend)
// ---------------------------------------------------------------------------
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'page'
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
function Badge({ label, color }) {
  const colors = {
    published: { bg: '#d1fae5', text: '#065f46' },
    draft: { bg: '#f3f4f6', text: '#6b7280' },
    markdown: { bg: '#ede9fe', text: '#5b21b6' },
    html: { bg: '#fef3c7', text: '#92400e' },
    csv: { bg: '#d1fae5', text: '#065f46' },
    text: { bg: '#e0f2fe', text: '#0369a1' },
  }
  const c = colors[color] || { bg: 'var(--bg-card)', text: 'var(--text-2)' }
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      background: c.bg,
      color: c.text,
      textTransform: 'capitalize',
    }}>{label}</span>
  )
}

// ---------------------------------------------------------------------------
// Analytics Drawer
// ---------------------------------------------------------------------------
function AnalyticsDrawer({ page, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!page) return
    setLoading(true)
    api.pages.analytics(page.id, { limit: 100, offset: 0 })
      .then(d => setData(d))
      .catch(() => setData({ items: [], total: 0 }))
      .finally(() => setLoading(false))
  }, [page?.id])

  if (!page) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div
        style={{
          width: '90vw', maxWidth: 760, height: '100%',
          background: 'var(--bg-base)', overflowY: 'auto',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Analytics</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>{page.title}</div>
          </div>
          <button onClick={onClose} style={btnGhost}>✕</button>
        </div>

        <div style={{ padding: 24, flex: 1 }}>
          {loading ? (
            <div style={{ color: 'var(--text-2)', fontSize: 14 }}>Loading…</div>
          ) : !data?.items?.length ? (
            <div style={{ color: 'var(--text-2)', fontSize: 14 }}>No views recorded yet.</div>
          ) : (
            <>
              <div style={{ marginBottom: 16, fontSize: 14, color: 'var(--text-2)' }}>
                {data.total} total view{data.total !== 1 ? 's' : ''}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Time', 'IP', 'Country', 'City', 'Referer', 'User-Agent'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map(v => (
                      <tr key={v.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{new Date(v.viewed_at).toLocaleString()}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{v.viewer_ip || '—'}</td>
                        <td style={{ padding: '8px 10px' }}>{v.country || '—'}</td>
                        <td style={{ padding: '8px 10px' }}>{v.city || '—'}</td>
                        <td style={{ padding: '8px 10px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.referer}>{v.referer || '—'}</td>
                        <td style={{ padding: '8px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.user_agent}>{v.user_agent || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit / Create Drawer
// ---------------------------------------------------------------------------
const CONTENT_TYPES = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
  { value: 'csv', label: 'CSV' },
  { value: 'text', label: 'Plain Text' },
]

function PageDrawer({ page, onClose, onSaved }) {
  const isEdit = !!page?.id
  const [form, setForm] = useState({
    title: page?.title || '',
    content_type: page?.content_type || 'markdown',
    content: page?.content || '',
    slug: page?.slug || '',
    is_password_protected: page?.is_password_protected || false,
    password: '',
    metadata: page?.metadata || {},
    description: page?.metadata?.description || '',
  })
  const [slugManual, setSlugManual] = useState(!!page?.slug)
  const [tab, setTab] = useState('edit') // 'edit' | 'preview'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [publishing, setPublishing] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Auto-slug from title
  useEffect(() => {
    if (!slugManual && form.title) {
      set('slug', slugify(form.title))
    }
  }, [form.title, slugManual])

  const handleSave = async (publish = false) => {
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true); setError('')
    try {
      const payload = {
        title: form.title,
        content_type: form.content_type,
        content: form.content,
        slug: form.slug || undefined,
        is_password_protected: form.is_password_protected,
        password: form.is_password_protected && form.password ? form.password : undefined,
        metadata: { ...form.metadata, description: form.description },
      }
      let saved
      if (isEdit) {
        saved = await api.pages.update(page.id, payload)
      } else {
        saved = await api.pages.create(payload)
      }
      if (publish) {
        setPublishing(true)
        saved = await api.pages.publish(saved.id, true)
        setPublishing(false)
      }
      onSaved(saved)
    } catch (e) {
      setError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const appOrigin = window.location.origin
  const shareUrl = form.slug ? `${appOrigin}/p/${form.slug}` : ''

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div
        style={{
          width: '92vw', maxWidth: 1100, height: '100%',
          background: 'var(--bg-base)', overflowY: 'auto',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{isEdit ? 'Edit Page' : 'New Page'}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {error && <span style={{ color: '#ef4444', fontSize: 12 }}>{error}</span>}
            <button onClick={onClose} style={btnGhost} disabled={saving}>Cancel</button>
            <button onClick={() => handleSave(false)} style={btnSecondary} disabled={saving}>{saving && !publishing ? 'Saving…' : 'Save Draft'}</button>
            <button onClick={() => handleSave(true)} style={btnPrimary} disabled={saving}>{saving && publishing ? 'Publishing…' : isEdit && page?.is_published ? 'Save & Update' : 'Save & Publish'}</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Meta row */}
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 2, minWidth: 200 }}>
              <label style={labelStyle}>Title</label>
              <input
                style={inputStyle}
                placeholder="Page title"
                value={form.title}
                onChange={e => set('title', e.target.value)}
              />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={labelStyle}>Content Type</label>
              <select style={inputStyle} value={form.content_type} onChange={e => set('content_type', e.target.value)}>
                {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 2, minWidth: 180 }}>
              <label style={labelStyle}>Slug</label>
              <input
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
                placeholder="url-slug"
                value={form.slug}
                onChange={e => { setSlugManual(true); set('slug', e.target.value) }}
              />
              {shareUrl && (
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shareUrl}
                </div>
              )}
            </div>
          </div>

          {/* Edit/Preview tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', padding: '0 24px' }}>
            {['edit', 'preview'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: tab === t ? 'var(--accent)' : 'var(--text-2)',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                textTransform: 'capitalize',
              }}>{t}</button>
            ))}
          </div>

          {/* Content area */}
          <div style={{ flex: 1, padding: '16px 24px', overflow: 'auto' }}>
            {tab === 'edit' ? (
              <textarea
                style={{
                  width: '100%', height: '100%', minHeight: 340,
                  fontFamily: ['csv', 'html', 'text'].includes(form.content_type) ? 'monospace' : 'inherit',
                  fontSize: 13, lineHeight: 1.6,
                  background: 'var(--bg-card)', color: 'var(--text-1)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  padding: 12, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                }}
                placeholder={`Paste your ${form.content_type} content here…`}
                value={form.content}
                onChange={e => set('content', e.target.value)}
              />
            ) : (
              <div style={{
                minHeight: 340, border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                background: '#fff', overflow: 'auto',
              }}>
                <ContentPreview contentType={form.content_type} content={form.content} />
              </div>
            )}
          </div>

          {/* Extra options */}
          <div style={{ padding: '12px 24px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 220 }}>
              <label style={labelStyle}>Description (og:description)</label>
              <input
                style={inputStyle}
                placeholder="Short description for link previews"
                value={form.description}
                onChange={e => set('description', e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, paddingBottom: 1 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={form.is_password_protected}
                  onChange={e => set('is_password_protected', e.target.checked)}
                />
                Password protected
              </label>
              {form.is_password_protected && (
                <input
                  style={{ ...inputStyle, width: 160 }}
                  type="password"
                  placeholder="Set password"
                  value={form.password}
                  onChange={e => set('password', e.target.value)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div style={{
        background: 'var(--bg-base)', borderRadius: 'var(--radius)',
        padding: 28, maxWidth: 380, width: '90%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Confirm</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>{message}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnGhost}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btnPrimary, background: '#ef4444' }}>Delete</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function PagesManager() {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drawerPage, setDrawerPage] = useState(null) // null | {} | page obj
  const [analyticsPage, setAnalyticsPage] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [toast, setToast] = useState('')

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const loadPages = useCallback(async () => {
    try {
      const data = await api.pages.list()
      setPages(Array.isArray(data) ? data : [])
    } catch (e) {
      setError('Failed to load pages')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPages() }, [loadPages])

  const handleSaved = (saved) => {
    setPages(prev => {
      const idx = prev.findIndex(p => p.id === saved.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = saved
        return next
      }
      return [saved, ...prev]
    })
    setDrawerPage(null)
    showToast('Page saved')
  }

  const handlePublishToggle = async (page) => {
    try {
      const updated = await api.pages.publish(page.id, !page.is_published)
      setPages(prev => prev.map(p => p.id === updated.id ? updated : p))
      showToast(updated.is_published ? 'Published' : 'Unpublished')
    } catch {
      showToast('Failed to update publish status')
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    try {
      await api.pages.delete(confirmDelete.id)
      setPages(prev => prev.filter(p => p.id !== confirmDelete.id))
      showToast('Page deleted')
    } catch {
      showToast('Failed to delete page')
    } finally {
      setConfirmDelete(null)
    }
  }

  const copyLink = (slug) => {
    const url = `${window.location.origin}/p/${slug}`
    navigator.clipboard.writeText(url).then(() => showToast('Link copied!'))
  }

  const openEditDrawer = async (page) => {
    // Fetch full page data (with content) before opening drawer
    try {
      const full = await api.pages.get(page.id)
      setDrawerPage(full)
    } catch {
      setDrawerPage(page)
    }
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Published Pages</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-2)' }}>
            Create and share content pages with a public URL.
          </p>
        </div>
        <button style={btnPrimary} onClick={() => setDrawerPage({})}>+ New Page</button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13, color: '#991b1b', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: 'var(--text-2)', fontSize: 14, padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : !pages.length ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          border: '2px dashed var(--border)', borderRadius: 'var(--radius)',
          color: 'var(--text-2)', fontSize: 14,
        }}>
          No pages yet. Click <strong>+ New Page</strong> to create one.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                {['Title / URL', 'Type', 'Status', 'Views', 'Created', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pages.map((page, idx) => (
                <tr key={page.id} style={{ borderBottom: idx < pages.length - 1 ? '1px solid var(--border)' : 'none', background: 'var(--bg-base)' }}>
                  <td style={{ padding: '12px 14px', maxWidth: 280 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {page.title || <span style={{ color: 'var(--text-2)' }}>Untitled</span>}
                      {page.is_password_protected && <span style={{ marginLeft: 6, fontSize: 11 }}>🔒</span>}
                    </div>
                    {page.is_published ? (
                      <a
                        href={`/p/${page.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'monospace', textDecoration: 'none' }}
                      >
                        /p/{page.slug}
                      </a>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'monospace' }}>/p/{page.slug}</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                    <Badge label={page.content_type} color={page.content_type} />
                  </td>
                  <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                    <Badge label={page.is_published ? 'Published' : 'Draft'} color={page.is_published ? 'published' : 'draft'} />
                  </td>
                  <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                    <button
                      onClick={() => setAnalyticsPage(page)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}
                    >
                      {page.view_count ?? 0}
                    </button>
                  </td>
                  <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>
                    {page.created_at ? new Date(page.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button style={btnTiny} onClick={() => openEditDrawer(page)} title="Edit">Edit</button>
                      <button
                        style={{ ...btnTiny, background: page.is_published ? '#fef3c7' : '#d1fae5', color: page.is_published ? '#92400e' : '#065f46' }}
                        onClick={() => handlePublishToggle(page)}
                        title={page.is_published ? 'Unpublish' : 'Publish'}
                      >
                        {page.is_published ? 'Unpublish' : 'Publish'}
                      </button>
                      <button style={btnTiny} onClick={() => copyLink(page.slug)} title="Copy link">Copy Link</button>
                      <button
                        style={{ ...btnTiny, background: '#fef2f2', color: '#991b1b' }}
                        onClick={() => setConfirmDelete(page)}
                        title="Delete"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawers / Dialogs */}
      {drawerPage !== null && (
        <PageDrawer
          page={drawerPage?.id ? drawerPage : null}
          onClose={() => setDrawerPage(null)}
          onSaved={handleSaved}
        />
      )}

      {analyticsPage && (
        <AnalyticsDrawer
          page={analyticsPage}
          onClose={() => setAnalyticsPage(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.title}"? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: '#1e293b', color: '#f8fafc',
          padding: '10px 18px', borderRadius: 'var(--radius)',
          fontSize: 13, fontWeight: 500,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          animation: 'fadeIn 0.2s ease',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------
const inputStyle = {
  display: 'block',
  width: '100%',
  padding: '7px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg-card)',
  color: 'var(--text-1)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-2)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const btnBase = {
  border: 'none',
  borderRadius: 'var(--radius)',
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'opacity 0.15s',
}

const btnPrimary = {
  ...btnBase,
  background: 'var(--accent)',
  color: '#fff',
}

const btnSecondary = {
  ...btnBase,
  background: 'var(--bg-card)',
  color: 'var(--text-1)',
  border: '1px solid var(--border)',
}

const btnGhost = {
  ...btnBase,
  background: 'transparent',
  color: 'var(--text-2)',
  padding: '7px 12px',
}

const btnTiny = {
  ...btnBase,
  padding: '4px 10px',
  fontSize: 12,
  background: 'var(--bg-card)',
  color: 'var(--text-1)',
  border: '1px solid var(--border)',
}
