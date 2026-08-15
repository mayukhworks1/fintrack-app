// Extracted from StatusBoard.jsx — StatusModals.
import { useToast } from '../../context/ToastContext'
import { api } from '../../services/api'
import { Activity, AlertCircle, BookmarkPlus, Check, CheckCheck, CheckSquare, Clock, Copy, ExternalLink, Eye, Filter, Globe, Link2, Loader2, Monitor, Pencil, Plus, RefreshCw, Search, Share2, Shield, Smartphone, Sparkles, Square, ToggleLeft, ToggleRight, Trash, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useDialog } from '../../hooks/useDialog'
import { ComboBox, StatusAttachmentField } from './StatusFields'
import { ALL_COLUMNS, EXPIRY_OPTS, MAX_SHARED_VIEW_RECORDS, THEME_PRESETS, fmtDate, isExpired, parseAttachments, statusStyle, summarizeShareScope } from './utils'

export function StatusModal({ initial, onClose, onSave, saving, allRecords, statusOptions, onAddStatusOption, options }) {
  // Derived from the prop, not from isEdit below — the hook call runs first and
  // reading isEdit here would hit its temporal dead zone.
  const dialog = useDialog({ label: initial ? 'Edit status update' : 'New status update' })
  const isEdit = !!initial
  const [form, setForm] = useState({
    client:                  initial?.fields?.['Client'] || '',
    project:                 initial?.fields?.['Project'] || '',
    status:                  initial?.fields?.['Status'] || '',
    short_status:            initial?.fields?.['Short Status'] || '',
    current_status_detailed: initial?.fields?.['Current Status (Detailed)'] || '',
    attachments:             parseAttachments(initial?.fields?.['Attachments']),
  })
  const [newStatusOption, setNewStatusOption] = useState('')
  const [addingStatusOption, setAddingStatusOption] = useState(false)
  const allClients  = (options?.clients?.length ? options.clients : [...new Set(allRecords.map(r => r.fields?.['Client']).filter(Boolean))].sort())
  const allProjects = (options?.projects?.length ? options.projects : [...new Set(allRecords.map(r => r.fields?.['Project']).filter(Boolean))].sort())
  const projectsByClient = options?.projects_by_client || {}
  const projectOptions = form.client && projectsByClient[form.client]?.length
    ? projectsByClient[form.client]
    : allProjects
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  async function addStatusOptionInline() {
    const trimmed = newStatusOption.trim()
    if (!trimmed || !onAddStatusOption) return
    setAddingStatusOption(true)
    try {
      await onAddStatusOption(trimmed)
      set('status', trimmed)
      setNewStatusOption('')
    } finally {
      setAddingStatusOption(false)
    }
  }
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(8px)' }}>
      <div {...dialog.panelProps} className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '92vh', overflow: 'auto' }}>

        <div className="flex items-center justify-between px-5 pt-5 pb-3 sticky top-0 z-10"
          style={{ background: 'var(--card-bg)', borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
            {isEdit ? 'Edit Status Update' : 'New Status Update'}
          </h2>
          <button aria-label="Close" onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        <form onSubmit={e => { e.preventDefault(); if (form.client && form.project) onSave(form) }}
          className="px-5 py-4 space-y-4">

          {/* Client + Project — styled comboboxes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Client <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <ComboBox
                value={form.client}
                onChange={v => { setForm(f => ({ ...f, client: v, project: '' })) }}
                options={allClients}
                placeholder="Select or type a client…"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Project <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <ComboBox
                value={form.project}
                onChange={v => set('project', v)}
                options={projectOptions}
                placeholder="Select or type a project…"
                required
              />
            </div>
          </div>

          {/* Status selector */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Status</label>
              {onAddStatusOption && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    className="input-field text-xs py-1 px-2"
                    style={{ width: 140 }}
                    placeholder="Add status option"
                    value={newStatusOption}
                    onChange={e => setNewStatusOption(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStatusOptionInline() } }}
                  />
                  <button type="button" onClick={addStatusOptionInline} disabled={addingStatusOption || !newStatusOption.trim()}
                    className="btn-ghost text-xs px-2 py-1 flex items-center gap-1">
                    {addingStatusOption ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                    Add
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {statusOptions.map(opt => {
                const sc = statusStyle(opt)
                const active = form.status === opt
                return (
                  <button key={opt} type="button"
                    onClick={() => set('status', active ? '' : opt)}
                    className="py-2 px-1 rounded-xl text-[11px] font-semibold text-center transition-all leading-tight"
                    style={{
                      background: active ? sc.bg : 'var(--bg-input)',
                      color:      active ? sc.color : 'var(--text-3)',
                      border:     `1.5px solid ${active ? sc.border : 'var(--border)'}`,
                      boxShadow:  active ? `0 0 0 2px ${sc.bg}` : 'none',
                    }}>
                    <span className="flex items-center justify-center gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? sc.dot : 'var(--text-3)' }} />
                    </span>
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Short status */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Headline <span className="font-normal" style={{ color: 'var(--text-3)' }}>· one-line summary</span>
            </label>
            <input type="text" className="input-field w-full text-sm"
              placeholder="e.g. UAT in progress — awaiting client sign-off"
              value={form.short_status} onChange={e => set('short_status', e.target.value)} maxLength={500} />
          </div>

          {/* Detailed status */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Full Detail <span className="font-normal" style={{ color: 'var(--text-3)' }}>· blockers, next steps, notes</span>
            </label>
            <textarea className="input-field w-full text-sm resize-none" rows={5}
              placeholder="Full narrative — blockers, dependencies, billing notes…"
              maxLength={10000}
              value={form.current_status_detailed}
              onChange={e => set('current_status_detailed', e.target.value)} />
            {form.current_status_detailed?.length > 9000 && (
              <p className="text-xs mt-1" style={{ color: form.current_status_detailed.length >= 10000 ? 'var(--error)' : 'var(--warning, #f59e0b)' }}>
                {form.current_status_detailed.length}/10000 characters
              </p>
            )}
          </div>

          <StatusAttachmentField
            value={form.attachments}
            onChange={(attachments) => set('attachments', attachments)}
            recordId={initial?.id || ''}
          />

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost text-sm px-4 py-2" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
              disabled={saving || !form.client || !form.project}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {isEdit ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Update Modal
// ─────────────────────────────────────────────────────────────────────────────

export function AIUpdateModal({ selectedRecords, onClose, onShare }) {
  const dialog = useDialog({ label: 'AI status update' })
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState(null)
  const [context, setContext] = useState('')
  const [copied,  setCopied]  = useState(false)

  async function generate() {
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await api.status.aiUpdate(selectedRecords.map(r => r.id), context)
      setResult(res)
    } catch (e) { setError(e.message || 'AI generation failed') }
    finally { setLoading(false) }
  }
  function copyText() {
    navigator.clipboard.writeText(result?.text || '')
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)' }}>
      <div {...dialog.panelProps} className="w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)' }}>
              <Sparkles size={15} style={{ color: '#8b5cf6' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>AI Status Update</h2>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{selectedRecords.length} project{selectedRecords.length !== 1 ? 's' : ''} selected</p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {selectedRecords.map(r => {
              const f = r.fields || {}
              const sc = statusStyle(f['Status'] || '')
              return (
                <span key={r.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                  {f['Status'] && <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />}
                  <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{f['Client']}</span>
                  <span style={{ color: 'var(--text-3)' }}>·</span>
                  {f['Project']}
                </span>
              )
            })}
          </div>
          {!result && (
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Additional context <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea className="input-field w-full text-sm resize-none" rows={2}
                placeholder="e.g. Focus on billing, ignore items not yet started…"
                value={context} onChange={e => setContext(e.target.value)} />
            </div>
          )}
          {!result && !loading && (
            <button onClick={generate} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm"
              style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff', boxShadow: '0 2px 8px rgba(99,102,241,0.35)' }}>
              <Sparkles size={14} /> Generate Status Update
            </button>
          )}
          {loading && (
            <div className="flex flex-col items-center py-12 gap-3">
              <div className="flex gap-1.5">
                {[0,1,2].map(i => <span key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#8b5cf6', animationDelay: `${i*0.15}s` }} />)}
              </div>
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>Generating…</p>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
              <AlertCircle size={14} style={{ color: '#ef4444', marginTop: 1 }} />
              <div>
                <p className="text-sm font-medium" style={{ color: '#ef4444' }}>Generation failed</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{error}</p>
                <button onClick={generate} className="text-xs font-semibold mt-2" style={{ color: '#ef4444' }}>Retry</button>
              </div>
            </div>
          )}
          {result && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>via {result.model || 'AI'}</p>
                <div className="flex gap-1.5">
                  <button onClick={generate} className="btn-ghost text-xs px-2 py-1 flex items-center gap-1"><RefreshCw size={10} /> Redo</button>
                  <button onClick={copyText} className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg"
                    style={{ background: copied ? 'rgba(16,185,129,0.12)' : 'var(--bg-input)', color: copied ? '#10b981' : 'var(--text-2)', border: '1px solid var(--border)' }}>
                    {copied ? <CheckCheck size={11} /> : <Copy size={11} />} {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="rounded-xl p-4 text-[13px] leading-relaxed whitespace-pre-wrap"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)', maxHeight: '40vh', overflow: 'auto' }}>
                {result.text}
              </div>
            </div>
          )}
        </div>

        {result && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Done</button>
            <button onClick={() => { onClose(); onShare() }} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
              <Share2 size={13} /> Share These Projects
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Share Modal
// ─────────────────────────────────────────────────────────────────────────────

export function ShareModal({ selectedRecords, viewConfig = null, title: defaultTitle = '', isViewShare = false, onClose }) {
  const dialog = useDialog({ label: 'Share' })
  const [step,      setStep]      = useState('form')
  const [title,     setTitle]     = useState(defaultTitle)
  const [expiry,    setExpiry]    = useState(0)
  const [accessMode, setAccessMode] = useState('read')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState(null)
  const [shareData, setShareData] = useState(null)
  const [copied,    setCopied]    = useState(false)
  const shareUrl = shareData ? `${window.location.origin}/view/${shareData.token}` : ''

  async function createShare() {
    setSaving(true); setError(null)
    try {
      if (isViewShare) {
        // Dynamic live link — always fetches all matching records from Teable,
        // so new projects added after the link is created appear automatically.
        const payload = {
          title: title.trim() || null,
          record_ids: ['__dynamic__'],   // sentinel: "fetch live on every access"
          expires_hours: expiry || null,
          access_mode: 'read',
          resource_type: 'status',
        }
        if (viewConfig) {
          const { advancedConditions: _stripped, ...safeConfig } = viewConfig
          payload.view_config = safeConfig
        }
        const data = await api.sharedViews.create(payload)
        setShareData(data); setStep('created')
      } else {
        // Snapshot link — shares the currently selected records only.
        if (selectedRecords.length === 0) throw new Error('No records selected to share.')
        if (selectedRecords.length > MAX_SHARED_VIEW_RECORDS) {
          throw new Error(`Public sharing is limited to ${MAX_SHARED_VIEW_RECORDS} records. Narrow the current view first.`)
        }
        const payload = {
          title: title.trim() || null,
          record_ids: selectedRecords.map(r => r.id),
          expires_hours: expiry || null,
          access_mode: accessMode,
          resource_type: 'status',
        }
        const data = await api.sharedViews.create(payload)
        setShareData(data); setStep('created')
      }
    } catch (e) { setError(e.message || 'Failed to create share link') }
    finally { setSaving(false) }
  }
  function copyUrl() { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2500) }
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)' }}>
      <div {...dialog.panelProps} className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)' }}>
              <Share2 size={15} style={{ color: '#0ea5e9' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{step === 'form' ? (isViewShare ? 'Share Current View' : 'Share Selected Projects') : 'Link Ready!'}</h2>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{selectedRecords.length} project{selectedRecords.length !== 1 ? 's' : ''} · no login needed</p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {step === 'form' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {selectedRecords.slice(0, 8).map(r => (
                  <span key={r.id} className="text-[11px] px-2 py-0.5 rounded-lg font-medium"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {r.fields?.['Client']} · {r.fields?.['Project']}
                  </span>
                ))}
                {selectedRecords.length > 8 && <span className="text-[11px] px-2 py-0.5 rounded-lg" style={{ color: 'var(--text-3)' }}>+{selectedRecords.length - 8} more</span>}
              </div>
              <div>
                <label className="block text-xs font-semibold mb-0.5" style={{ color: 'var(--text-2)' }}>Page title</label>
                <p className="text-[10px] mb-1.5" style={{ color: 'var(--text-3)' }}>Shown to the viewer as the page heading</p>
                <input type="text" className="input-field w-full text-sm" placeholder="e.g. May 2026 Status Update"
                  value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Expires</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {EXPIRY_OPTS.map(opt => (
                    <button key={opt.value} onClick={() => setExpiry(opt.value)}
                      className="py-1.5 rounded-xl text-xs font-semibold transition-all"
                      style={{ background: expiry === opt.value ? 'var(--accent)' : 'var(--bg-input)', color: expiry === opt.value ? '#fff' : 'var(--text-2)', border: `1px solid ${expiry === opt.value ? 'var(--accent)' : 'var(--border)'}` }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {!isViewShare && (
                <div>
                  <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Access</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'read', label: 'Read only', hint: 'Recipients can view, filter, and switch layouts.' },
                      { id: 'edit', label: 'Can edit', hint: 'Recipients can update status, headline, and details.' },
                    ].map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setAccessMode(opt.id)}
                        className="rounded-xl px-3 py-2 text-left transition-all"
                        style={{
                          background: accessMode === opt.id ? 'var(--accent-dim)' : 'var(--bg-input)',
                          border: `1px solid ${accessMode === opt.id ? 'var(--accent-soft)' : 'var(--border)'}`,
                        }}
                      >
                        <p className="text-xs font-semibold" style={{ color: accessMode === opt.id ? 'var(--accent)' : 'var(--text-2)' }}>{opt.label}</p>
                        <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{opt.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {error && <p className="text-xs p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>{error}</p>}
              <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)' }}>
                <Shield size={13} style={{ color: '#0ea5e9', marginTop: 1, flexShrink: 0 }} />
                <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                  {isViewShare
                    ? 'Live link — always fetches the latest data from Teable. New projects added after sharing appear automatically. IP, location & device tracked on every open.'
                    : 'IP, location, device & browser tracked on every open. Disable or delete anytime.'}
                </p>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                Need to update an existing public URL? Use <strong>Links</strong> and edit that link’s scope there.
              </p>
              {isViewShare && (
                <div className="space-y-1">
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    Current filters, layout, theme, density, dashboard preferences, and card expansion state will travel with this link.
                  </p>
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
                <button onClick={createShare} disabled={saving || (!isViewShare && (selectedRecords.length === 0 || selectedRecords.length > MAX_SHARED_VIEW_RECORDS))} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} Generate Link
                </button>
              </div>
            </>
          )}
          {step === 'created' && shareData && (
            <>
              <div className="flex flex-col items-center py-2 gap-3">
                <div className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(16,185,129,0.12)', border: '2px solid rgba(16,185,129,0.3)' }}>
                  <CheckCheck size={24} style={{ color: '#10b981' }} />
                </div>
                <div className="text-center">
                  <p className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Link ready!</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Share this URL — no login required.</p>
                  {isViewShare && (
                    <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live · new projects appear automatically
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <Link2 size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                <p className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-1)' }}>{shareUrl}</p>
                <button onClick={copyUrl} className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg"
                  style={{ background: copied ? 'rgba(16,185,129,0.12)' : 'var(--card-bg)', color: copied ? '#10b981' : 'var(--accent)', border: '1px solid var(--border)' }}>
                  {copied ? <CheckCheck size={11} /> : <Copy size={11} />} {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              {shareData.expires_at && (
                <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                  <Clock size={11} /> Expires {fmtDate(shareData.expires_at)}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <a href={shareUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--accent)' }}>
                  <ExternalLink size={11} /> Preview
                </a>
                <button onClick={onClose} className="btn-primary text-sm px-4 py-2">Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Manage Shares Modal — fully redesigned
// ─────────────────────────────────────────────────────────────────────────────

export function ScopeEditorModal({ view, currentConfig, visibleRecords, onClose, onSave }) {
  const dialog = useDialog({ label: 'Edit share scope', onClose })
  const [mode, setMode] = useState(view?.is_dynamic ? 'live' : 'snapshot')
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  if (!view) return null

  const visibleCount = visibleRecords.length
  const snapshotTooLarge = visibleCount > MAX_SHARED_VIEW_RECORDS
  const { advancedConditions: _ignored, ...safeConfig } = currentConfig || {}
  const currentScope = summarizeShareScope(view)
  const newScope = mode === 'live'
    ? summarizeShareScope({ is_dynamic: true, view_config: safeConfig })
    : `Snapshot · ${visibleCount} project${visibleCount === 1 ? '' : 's'}`

  async function handleSave() {
    if (!currentConfig) {
      showToast('Current view is unavailable.', 'error')
      return
    }
    if (visibleCount <= 0) {
      showToast('No visible projects in the current view to save.', 'error')
      return
    }
    if (mode === 'snapshot' && snapshotTooLarge) {
      showToast(`Snapshot links are limited to ${MAX_SHARED_VIEW_RECORDS} projects. Narrow the current view first.`, 'error')
      return
    }

    setSaving(true)
    try {
      const patch = mode === 'live'
        ? { record_ids: ['__dynamic__'], view_config: safeConfig }
        : { record_ids: visibleRecords.map(r => r.id), view_config: safeConfig }
      await onSave(patch)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)' }}>
      <div {...dialog.panelProps} className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Edit Link Scope</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>You are updating one existing public URL, not creating a new one.</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-2)' }}>{view.title || 'Untitled link'}</p>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{window.location.origin}/view/{view.token}</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Current scope</p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{currentScope}</p>
            </div>
            <div className="rounded-xl p-3" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Current visible view</p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{visibleCount} visible project{visibleCount === 1 ? '' : 's'}</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Replace with</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {[
                { id: 'live', label: 'Live current view', hint: 'Same URL, always re-fetches matching Teable data from this view.' },
                { id: 'snapshot', label: 'Snapshot current view', hint: `Same URL, fixed to the ${visibleCount} projects visible right now.` },
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className="rounded-xl px-3 py-2 text-left transition-all"
                  style={{
                    background: mode === opt.id ? 'var(--accent-dim)' : 'var(--bg-input)',
                    border: `1px solid ${mode === opt.id ? 'var(--accent-soft)' : 'var(--border)'}`,
                    opacity: opt.id === 'snapshot' && snapshotTooLarge ? 0.55 : 1,
                  }}
                >
                  <p className="text-xs font-semibold" style={{ color: mode === opt.id ? 'var(--accent)' : 'var(--text-2)' }}>{opt.label}</p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{opt.hint}</p>
                </button>
              ))}
            </div>
            {snapshotTooLarge && (
              <p className="text-[11px] mt-2" style={{ color: '#ef4444' }}>
                Snapshot update is limited to {MAX_SHARED_VIEW_RECORDS} projects. Narrow the current view or use a live scope.
              </p>
            )}
          </div>

          <div className="rounded-xl p-3" style={{ background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>New scope summary</p>
            <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{newScope}</p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
            <button onClick={handleSave} disabled={saving || visibleCount <= 0 || (mode === 'snapshot' && snapshotTooLarge)} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Update Link
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ManageSharesModal({ onClose, currentConfig = null, visibleCount = 0, visibleRecords = [] }) {
  const dialog = useDialog({ label: 'Manage share links' })
  const { showToast } = useToast()
  const [views,         setViews]         = useState([])
  const [loading,       setLoading]       = useState(true)
  const [selectedToken, setSelectedToken] = useState(null)   // viewer activity panel
  const [accesses,      setAccesses]      = useState([])
  const [loadingAcc,    setLoadingAcc]    = useState(false)
  const [savingTokens,  setSavingTokens]  = useState(() => new Set())  // PATCH in flight
  const [savedTokens,   setSavedTokens]   = useState(() => new Set())  // brief "Saved ✓"
  const [copiedToken,   setCopiedToken]   = useState(null)
  const [editingTitle,  setEditingTitle]  = useState(null)   // token whose title is in edit mode
  const [titleDraft,    setTitleDraft]    = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [scopeEditor,   setScopeEditor]   = useState(null)
  const [accessFilters, setAccessFilters] = useState({ q: '', event: '' })
  const [selectedAccessIds, setSelectedAccessIds] = useState([])
  const [deletingAccesses, setDeletingAccesses] = useState(false)

  useEffect(() => { loadViews() }, [])
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  async function loadViews() {
    setLoading(true)
    try { const r = await api.sharedViews.list('status'); setViews(r.views || []) } catch {}
    finally { setLoading(false) }
  }

  // Generic optimistic PATCH with rollback + "Saved ✓" flash
  async function patchView(token, patch, onRollback) {
    setSavingTokens(s => new Set(s).add(token))
    try {
      await api.sharedViews.update(token, patch)
      setSavedTokens(s => new Set(s).add(token))
      setTimeout(() => setSavedTokens(s => { const n = new Set(s); n.delete(token); return n }), 2200)
    } catch (e) {
      onRollback?.()
      showToast(e.message || 'Failed to save', 'error')
    } finally {
      setSavingTokens(s => { const n = new Set(s); n.delete(token); return n })
    }
  }

  async function toggleActive(view) {
    const next = !view.is_active
    setViews(vs => vs.map(v => v.token === view.token ? { ...v, is_active: next } : v))
    await patchView(
      view.token,
      { is_active: next },
      () => setViews(vs => vs.map(v => v.token === view.token ? { ...v, is_active: view.is_active } : v)),
    )
  }

  async function changeAccessMode(view, next) {
    if (view.access_mode === next || savingTokens.has(view.token)) return
    const prev = view.access_mode
    setViews(vs => vs.map(v => v.token === view.token ? { ...v, access_mode: next } : v))
    await patchView(
      view.token,
      { access_mode: next },
      () => setViews(vs => vs.map(v => v.token === view.token ? { ...v, access_mode: prev } : v)),
    )
  }

  async function saveScopeUpdate(view, patch) {
    const prev = { ...view }
    const nextView = {
      ...view,
      ...patch,
      is_dynamic: Array.isArray(patch.record_ids) && patch.record_ids.length === 1 && patch.record_ids[0] === '__dynamic__',
    }
    setViews(vs => vs.map(v => v.token === view.token ? nextView : v))
    await patchView(
      view.token,
      patch,
      () => setViews(vs => vs.map(v => v.token === view.token ? prev : v)),
    )
    showToast('Link scope updated', 'success')
  }

  async function saveTitle(view) {
    const newTitle = titleDraft.trim()
    setEditingTitle(null)
    if (newTitle === (view.title || '')) return
    const prev = view.title
    setViews(vs => vs.map(v => v.token === view.token ? { ...v, title: newTitle || null } : v))
    await patchView(
      view.token,
      { title: newTitle || '' },
      () => setViews(vs => vs.map(v => v.token === view.token ? { ...v, title: prev } : v)),
    )
  }

  async function deleteView(token) {
    const prev = views
    setViews(vs => vs.filter(v => v.token !== token))
    if (selectedToken === token) setSelectedToken(null)
    try { await api.sharedViews.delete(token); showToast('Link deleted', 'success') }
    catch (e) { setViews(prev); showToast(e.message || 'Failed', 'error') }
  }

  async function loadAccesses(token) {
    if (selectedToken === token) { setSelectedToken(null); return }
    setSelectedToken(token); setLoadingAcc(true)
    setAccessFilters({ q: '', event: '' })
    setSelectedAccessIds([])
    try { const r = await api.sharedViews.accesses(token); setAccesses(r.accesses || []) } catch {}
    finally { setLoadingAcc(false) }
  }

  function copyUrl(token) {
    navigator.clipboard.writeText(`${window.location.origin}/view/${token}`)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(t => t === token ? null : t), 2500)
  }

  const filteredAccesses = useMemo(() => {
    const q = (accessFilters.q || '').trim().toLowerCase()
    const event = accessFilters.event || ''
    return accesses.filter(a => {
      if (event && String(a.event_type || 'view') !== event) return false
      if (!q) return true
      const hay = [
        a.ip, a.city, a.region, a.country, a.device_label, a.os, a.browser,
        a.device_type, a.record_id, a.geo_source, a.isp, a.timezone,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [accesses, accessFilters])

  const allFilteredSelected = filteredAccesses.length > 0 && filteredAccesses.every(a => selectedAccessIds.includes(a.id))

  function toggleAccessRow(id) {
    setSelectedAccessIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleSelectAllFiltered() {
    const ids = filteredAccesses.map(a => a.id).filter(Boolean)
    if (!ids.length) return
    setSelectedAccessIds(prev => {
      const allSelected = ids.every(id => prev.includes(id))
      return allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]
    })
  }

  async function deleteSelectedAccessRows() {
    const ids = selectedAccessIds.filter(Boolean)
    if (!ids.length || !selectedToken) return
    setDeletingAccesses(true)
    try {
      await api.sharedViews.deleteAccesses(selectedToken, ids)
      setAccesses(prev => prev.filter(a => !ids.includes(a.id)))
      setSelectedAccessIds([])
      showToast(`Deleted ${ids.length} activity record${ids.length !== 1 ? 's' : ''}`, 'success')
    } catch (e) {
      showToast(e.message || 'Failed to delete activity', 'error')
    } finally {
      setDeletingAccesses(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)' }}>
      <div {...dialog.panelProps} className="w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)' }}>
              <Link2 size={15} style={{ color: '#0ea5e9' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Manage Share Links</h2>
              {!loading && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{views.length} link{views.length !== 1 ? 's' : ''}</p>}
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {loading && <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} /></div>}
          {!loading && views.length === 0 && (
            <div className="text-center py-12">
              <Link2 size={24} className="mx-auto mb-3 opacity-30" style={{ color: 'var(--text-3)' }} />
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No share links yet.</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Select records and click Share to create one.</p>
            </div>
          )}

          {views.map(v => {
            const expired     = isExpired(v.expires_at)
            const inactive    = !v.is_active
            const isSaving    = savingTokens.has(v.token)
            const justSaved   = savedTokens.has(v.token)
            const url         = `${window.location.origin}/view/${v.token}`
            const statusColor = inactive ? '#ef4444' : expired ? '#f59e0b' : '#10b981'

            return (
              <div key={v.token} className="rounded-2xl overflow-hidden"
                style={{ border: '1px solid var(--border)', background: 'var(--card-bg)', opacity: (expired || inactive) ? 0.82 : 1 }}>

                {/* Top accent bar — red=disabled, amber=expired, green=active */}
                <div className="h-1 w-full" style={{ background: statusColor }} />

                <div className="p-4 space-y-3">
                  {/* ── Row 1: Title + badges ── */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {editingTitle === v.token ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            className="input-field flex-1 text-sm font-semibold py-1"
                            value={titleDraft}
                            onChange={e => setTitleDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveTitle(v); if (e.key === 'Escape') setEditingTitle(null) }}
                            onBlur={() => saveTitle(v)}
                            placeholder="Add a page title…"
                            maxLength={200}
                          />
                          <button onClick={() => saveTitle(v)}
                            className="p-1.5 rounded-lg flex-shrink-0"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                            <Check size={13} />
                          </button>
                          <button onClick={() => setEditingTitle(null)}
                            className="p-1.5 rounded-lg flex-shrink-0"
                            style={{ color: 'var(--text-3)' }}>
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="group flex items-center gap-1.5 text-left w-full"
                          onClick={() => { setEditingTitle(v.token); setTitleDraft(v.title || '') }}
                          title="Click to edit page title">
                          <span className="text-sm font-semibold" style={{ color: v.title ? 'var(--text-1)' : 'var(--text-3)' }}>
                            {v.title || 'Untitled — click to add title'}
                          </span>
                          <Pencil size={10} className="flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--text-3)' }} />
                        </button>
                      )}
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                        This title is visible to the viewer as the page heading
                      </p>
                      {v.is_dynamic && (
                        <p className="text-[10px] mt-1" style={{ color: '#10b981' }}>
                          Live link: records are re-fetched on every open using the saved view filters.
                        </p>
                      )}
                      <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                        {summarizeShareScope(v)}
                      </p>
                    </div>

                    {/* Right badges */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {v.is_dynamic && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          LIVE
                        </span>
                      )}
                      {inactive && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>DISABLED</span>
                      )}
                      {expired && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>EXPIRED</span>
                      )}
                      <span className="flex items-center gap-1 text-[11px] font-semibold"
                        style={{ color: v.access_count > 0 ? '#10b981' : 'var(--text-3)' }}>
                        <Eye size={11} /> {v.access_count}
                      </span>
                      {v.last_accessed_at && (
                        <span className="text-[10px] hidden sm:block" style={{ color: '#10b981' }}>
                          Last seen {fmtDate(v.last_accessed_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Row 2: Full URL ── */}
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                    <Link2 size={11} className="flex-shrink-0" style={{ color: 'var(--text-3)' }} />
                    <span className="flex-1 text-[11px] font-mono truncate" style={{ color: 'var(--text-2)' }}>{url}</span>
                    <button onClick={() => copyUrl(v.token)}
                      className="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-all"
                      style={{
                        background: copiedToken === v.token ? 'rgba(16,185,129,0.12)' : 'var(--card-bg)',
                        color: copiedToken === v.token ? '#10b981' : 'var(--accent)',
                        border: '1px solid var(--border)',
                      }}>
                      {copiedToken === v.token ? <><CheckCheck size={9} /> Copied!</> : <><Copy size={9} /> Copy</>}
                    </button>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="flex-shrink-0 p-1.5 rounded-lg transition-colors btn-icon"
                      style={{ color: 'var(--text-3)' }} title="Open in new tab">
                      <ExternalLink size={11} />
                    </a>
                  </div>

                  {/* ── Row 3: Access mode + controls ── */}
                  <div className="flex items-center justify-between gap-3 flex-wrap">

                    {/* Access mode selector */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Access</span>
                      <div className="flex items-center gap-0.5 rounded-xl p-0.5"
                        style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                        {[
                          { id: 'read',  Icon: Eye,    label: 'View only' },
                          { id: 'edit',  Icon: Pencil, label: 'Can edit' },
                        ].map(({ id, Icon, label }) => {
                          const active = v.access_mode === id
                          return (
                            <button key={id}
                              onClick={() => changeAccessMode(v, id)}
                              disabled={isSaving}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                              style={{
                                background: active
                                  ? (id === 'edit' ? 'rgba(59,130,246,0.14)' : 'var(--card-bg)')
                                  : 'transparent',
                                color: active
                                  ? (id === 'edit' ? '#2563eb' : 'var(--text-1)')
                                  : 'var(--text-3)',
                                boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                              }}>
                              {isSaving && active
                                ? <Loader2 size={10} className="animate-spin" />
                                : <Icon size={10} />
                              }
                              {label}
                            </button>
                          )
                        })}
                      </div>
                      {/* "Saved ✓" flash */}
                      {justSaved && (
                        <span className="flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: '#10b981' }}>
                          <Check size={10} /> Saved
                        </span>
                      )}
                    </div>

                    {/* Right actions */}
                    <div className="flex items-center gap-1">
                      {v.expires_at && (
                        <span className="text-[10px] mr-1 hidden sm:block" style={{ color: expired ? '#f59e0b' : 'var(--text-3)' }}>
                          <Clock size={9} className="inline mr-0.5" />
                          {expired ? 'Expired' : 'Expires'} {fmtDate(v.expires_at)}
                        </span>
                      )}
                      {/* Viewer activity toggle */}
                      <button onClick={() => loadAccesses(v.token)}
                        className="btn-icon p-1.5"
                        title="Viewer activity"
                        style={{ color: selectedToken === v.token ? 'var(--accent)' : 'var(--text-3)' }}>
                        <Activity size={13} />
                      </button>
                      {/* Open explicit scope editor */}
                      <button
                        onClick={() => setScopeEditor(v)}
                        disabled={isSaving || !currentConfig}
                        className="btn-icon p-1.5"
                        title="Edit which projects this link should include"
                        style={{ color: currentConfig ? 'var(--accent)' : 'var(--text-3)', opacity: currentConfig ? 1 : 0.45 }}>
                        <RefreshCw size={13} />
                      </button>
                      {/* Enable / disable */}
                      <button onClick={() => toggleActive(v)}
                        className="btn-icon p-1.5"
                        title={v.is_active ? 'Disable this link' : 'Enable this link'}
                        style={{ color: v.is_active ? '#10b981' : 'var(--text-3)' }}>
                        {v.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                      </button>
                      {/* Delete */}
                      <button onClick={() => setConfirmDelete(v.token)}
                        className="btn-icon p-1.5"
                        title="Delete link"
                        style={{ color: 'rgba(239,68,68,0.55)' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.55)'}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Viewer activity panel ── */}
                {selectedToken === v.token && (
                  <div className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
                    <div className="px-4 py-2.5 flex items-center justify-between"
                      style={{ borderBottom: accesses.length > 0 ? '1px solid var(--border)' : 'none' }}>
                      <span className="text-[11px] font-bold flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
                        <Activity size={11} /> Viewer Activity
                        {!loadingAcc && <span className="font-normal" style={{ color: 'var(--text-3)' }}>— {accesses.length} access{accesses.length !== 1 ? 'es' : ''}</span>}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>IP · Device · Location</span>
                    </div>
                    {loadingAcc
                      ? <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-3)' }} /></div>
                      : accesses.length === 0
                        ? <p className="text-xs text-center py-5" style={{ color: 'var(--text-3)' }}>No accesses recorded yet</p>
                        : (
                          <>
                            <div className="px-4 py-2.5 space-y-2" style={{ borderBottom: '1px solid var(--border)' }}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>
                                  Events — {filteredAccesses.length}/{accesses.length} entries
                                </div>
                                <div className="flex items-center gap-2">
                                  <button onClick={toggleSelectAllFiltered} className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg"
                                    style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                                    {allFilteredSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                                    {allFilteredSelected ? 'Unselect all' : 'Select all'}
                                  </button>
                                  <button onClick={deleteSelectedAccessRows} disabled={!selectedAccessIds.length || deletingAccesses}
                                    className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg"
                                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#ef4444', opacity: (!selectedAccessIds.length || deletingAccesses) ? 0.5 : 1 }}>
                                    {deletingAccesses ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                    Delete selected
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-col sm:flex-row gap-2">
                                <div className="relative flex-1">
                                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                                  <input
                                    value={accessFilters.q}
                                    onChange={e => setAccessFilters(prev => ({ ...prev, q: e.target.value }))}
                                    placeholder="Filter by IP, location, device, browser…"
                                    className="w-full rounded-lg pl-7 pr-2 py-1.5 text-[11px]"
                                    style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                                  />
                                </div>
                                <div className="relative">
                                  <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                                  <select
                                    value={accessFilters.event}
                                    onChange={e => setAccessFilters(prev => ({ ...prev, event: e.target.value }))}
                                    className="rounded-lg pl-7 pr-7 py-1.5 text-[11px]"
                                    style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
                                    <option value="">All events</option>
                                    <option value="view">View</option>
                                    <option value="edit">Edit</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                            <div className="max-h-52 overflow-y-auto divide-y" style={{ borderColor: 'var(--border)' }}>
                            {filteredAccesses.map((a, i) => (
                              <div key={a.id || i} className="px-4 py-2.5 flex items-start gap-3">
                                <button onClick={() => toggleAccessRow(a.id)} className="mt-0.5 flex-shrink-0" style={{ color: selectedAccessIds.includes(a.id) ? 'var(--accent)' : 'var(--text-3)' }}>
                                  {selectedAccessIds.includes(a.id) ? <CheckSquare size={13} /> : <Square size={13} />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                      style={{ background: a.event_type === 'edit' ? 'rgba(59,130,246,0.08)' : 'rgba(16,185,129,0.08)', color: a.event_type === 'edit' ? '#2563eb' : '#059669' }}>
                                      {String(a.event_type || 'view').toUpperCase()}
                                    </span>
                                    <span className="text-[11px] font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{a.ip || '—'}</span>
                                    {(a.city || a.region || a.country) && (
                                      <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                                        {[a.city, a.region, a.country].filter(Boolean).join(', ')}
                                      </span>
                                    )}
                                    {a.geo_source && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                        style={{ background: a.geo_source === 'browser' ? 'rgba(16,185,129,0.08)' : 'rgba(148,163,184,0.1)', color: a.geo_source === 'browser' ? '#059669' : 'var(--text-3)' }}>
                                        {a.geo_source === 'browser' ? 'GPS' : 'IP geo'}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {a.device_label && <span className="text-[10px] font-medium" style={{ color: 'var(--text-2)' }}>{a.device_label}</span>}
                                    {a.os && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Monitor size={8} /> {a.os}</span>}
                                    {a.browser && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Globe size={8} /> {a.browser}</span>}
                                    {a.device_type && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Smartphone size={8} /> {a.device_type}</span>}
                                    {a.isp && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{a.isp}</span>}
                                    {a.timezone && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{a.timezone}</span>}
                                  </div>
                                </div>
                                <span className="text-[10px] flex-shrink-0 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{fmtDate(a.accessed_at)}</span>
                              </div>
                            ))}
                          </div>
                          </>
                        )
                    }
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {scopeEditor && (
          <ScopeEditorModal
            view={scopeEditor}
            currentConfig={currentConfig}
            visibleRecords={visibleRecords}
            onClose={() => setScopeEditor(null)}
            onSave={patch => saveScopeUpdate(scopeEditor, patch)}
          />
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          message="Delete this share link? Anyone with the URL will immediately lose access."
          confirmLabel="Delete link"
          onConfirm={() => deleteView(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved Views Menu
// ─────────────────────────────────────────────────────────────────────────────

export function SavedViewsMenu({ currentConfig, onLoad, onClose }) {
  const [views, setViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fintrack-status-views') || '[]') } catch { return [] }
  })
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  function saveCurrentView() {
    if (!name.trim()) return
    const v = { id: Date.now().toString(), name: name.trim(), config: currentConfig }
    const updated = [...views, v]
    setViews(updated)
    localStorage.setItem('fintrack-status-views', JSON.stringify(updated))
    setName(''); setSaving(false)
  }
  function deleteView(id) {
    const updated = views.filter(v => v.id !== id)
    setViews(updated)
    localStorage.setItem('fintrack-status-views', JSON.stringify(updated))
  }
  return (
    <div className="absolute right-0 top-full mt-1 z-30 w-72 rounded-2xl shadow-xl overflow-hidden"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
      <div className="px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
        Saved Views
      </div>
      {views.length === 0 && (
        <p className="text-xs text-center py-4" style={{ color: 'var(--text-3)' }}>No saved views yet</p>
      )}
      {views.map(v => (
        <div key={v.id} className="flex items-center justify-between px-4 py-2.5 group hover:bg-opacity-50 transition-colors"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => { onLoad(v.config); onClose() }}
            className="text-sm font-medium text-left flex-1" style={{ color: 'var(--text-1)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase"
                style={{ background: 'var(--bg-input)', color: 'var(--text-3)' }}>
                {v.config?.type || 'card'}
              </span>
              {v.name}
            </div>
            {(v.config?.filterClient || v.config?.filterStatus) && (
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                {[v.config?.filterClient, v.config?.filterStatus].filter(Boolean).join(' · ')}
              </p>
            )}
          </button>
          <button onClick={() => deleteView(v.id)}
            className="btn-icon p-1 ml-2 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity"
            style={{ color: '#ef4444' }}
            title="Delete saved view">
            <Trash size={12} />
          </button>
        </div>
      ))}
      {/* Save current */}
      <div className="p-3 space-y-2">
        {saving ? (
          <div className="flex gap-2">
            <input autoFocus className="input-field flex-1 text-sm py-1.5" placeholder="View name…"
              value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveCurrentView(); if (e.key === 'Escape') setSaving(false) }} />
            <button onClick={saveCurrentView} disabled={!name.trim()} className="btn-primary text-xs px-3 py-1.5">Save</button>
            <button onClick={() => setSaving(false)} className="btn-ghost text-xs px-2 py-1.5"><X size={12} /></button>
          </div>
        ) : (
          <button onClick={() => setSaving(true)}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-xl transition-colors"
            style={{ background: 'var(--bg-input)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
            <BookmarkPlus size={12} /> Save current view
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Column Selector (for List view)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Confirm Modal — replaces window.confirm everywhere
// ─────────────────────────────────────────────────────────────────────────────

export function ConfirmModal({ message, confirmLabel = 'Delete', onConfirm, onClose }) {
  const dialog = useDialog({ label: confirmLabel || 'Confirm' })
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}>
      <div {...dialog.panelProps} className="w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <Trash size={16} style={{ color: '#ef4444' }} />
          </div>
          <p className="text-sm leading-relaxed pt-1.5" style={{ color: 'var(--text-1)' }}>{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
          <button
            onClick={() => { onConfirm(); onClose() }}
            className="text-sm px-4 py-2 rounded-xl font-semibold transition-all"
            style={{ background: '#ef4444', color: '#fff', border: '1px solid rgba(239,68,68,0.3)' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ColumnSelector({ columns, onChange, onClose }) {
  return (
    <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-2xl shadow-xl overflow-hidden"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
      <div className="px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
        Visible Columns
      </div>
      {ALL_COLUMNS.map(col => {
        const active = columns.includes(col)
        const required = col === 'Client' || col === 'Project'
        return (
          <button key={col} onClick={() => { if (required) return; onChange(active ? columns.filter(c => c !== col) : [...columns, col]) }}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors"
            style={{ color: 'var(--text-1)', borderBottom: '1px solid var(--border)', opacity: required ? 0.5 : 1, cursor: required ? 'default' : 'pointer' }}>
            {col}
            <div className="w-4 h-4 rounded flex items-center justify-center"
              style={{ background: active ? 'var(--accent)' : 'transparent', border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}` }}>
              {active && <Check size={10} color="#fff" strokeWidth={3} />}
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function AppearancePanel({
  themeId,
  density,
  showDashboard,
  showClientAccents,
  statusOptions,
  canManageStatuses,
  onThemeChange,
  onDensityChange,
  onToggleDashboard,
  onToggleClientAccents,
  onAddStatusOption,
  onClose,
}) {
  const [newStatus, setNewStatus] = useState('')
  const [adding, setAdding] = useState(false)

  async function handleAddStatus() {
    const trimmed = newStatus.trim()
    if (!trimmed || !onAddStatusOption) return
    setAdding(true)
    try {
      await onAddStatusOption(trimmed)
      setNewStatus('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="absolute right-0 top-full mt-1 z-30 w-[min(92vw,26rem)] rounded-2xl shadow-xl overflow-hidden"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Customize Board</p>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Appearance, density, and status options</p>
        </div>
        <button aria-label="Close" onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}>
          <X size={14} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Accent theme</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.values(THEME_PRESETS).map(theme => (
              <button
                key={theme.id}
                type="button"
                onClick={() => onThemeChange(theme.id)}
                className="rounded-xl px-3 py-2 text-left transition-all"
                style={{
                  background: themeId === theme.id ? theme.accentDim : 'var(--bg-input)',
                  border: `1px solid ${themeId === theme.id ? theme.accentSoft : 'var(--border)'}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: theme.accent }} />
                  <span className="text-xs font-semibold" style={{ color: themeId === theme.id ? theme.accent : 'var(--text-2)' }}>{theme.label}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Density</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'comfortable', label: 'Comfortable', hint: 'More whitespace and larger cards.' },
              { id: 'compact', label: 'Compact', hint: 'Denser cards and tighter list rows.' },
            ].map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onDensityChange(opt.id)}
                className="rounded-xl px-3 py-2 text-left transition-all"
                style={{
                  background: density === opt.id ? 'var(--accent-dim)' : 'var(--bg-input)',
                  border: `1px solid ${density === opt.id ? 'var(--accent-soft)' : 'var(--border)'}`,
                }}
              >
                <p className="text-xs font-semibold" style={{ color: density === opt.id ? 'var(--accent)' : 'var(--text-2)' }}>{opt.label}</p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{opt.hint}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {[
            {
              key: 'dashboard',
              label: 'Show status dashboard',
              hint: 'Keep the top status strip visible for quick filtering.',
              active: showDashboard,
              toggle: onToggleDashboard,
            },
            {
              key: 'accents',
              label: 'Highlight client accents',
              hint: 'Show stronger client color bars and chips across cards.',
              active: showClientAccents,
              toggle: onToggleClientAccents,
            },
          ].map(item => (
            <button
              key={item.key}
              type="button"
              onClick={item.toggle}
              className="w-full flex items-start justify-between gap-3 rounded-xl px-3 py-3"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
            >
              <div className="text-left">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{item.label}</p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{item.hint}</p>
              </div>
              <span className="flex-shrink-0" style={{ color: item.active ? 'var(--accent)' : 'var(--text-3)' }}>
                {item.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
              </span>
            </button>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Status options</p>
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{statusOptions.length} total</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {statusOptions.map(opt => {
              const sc = statusStyle(opt)
              return (
                <span key={opt} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium"
                  style={{ background: sc.bg, border: `1px solid ${sc.border}`, color: sc.color }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                  {opt}
                </span>
              )
            })}
          </div>
          {canManageStatuses && (
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                className="input-field flex-1 text-sm"
                placeholder="Add a new status option"
                value={newStatus}
                onChange={e => setNewStatus(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddStatus() } }}
              />
              <button onClick={handleAddStatus} disabled={adding || !newStatus.trim()}
                className="btn-primary text-sm px-3 py-2 flex items-center justify-center gap-1.5">
                {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Add status
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
