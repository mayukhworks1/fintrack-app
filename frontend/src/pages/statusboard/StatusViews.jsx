// Extracted from StatusBoard.jsx — StatusViews.
import { AttachmentList, DocPreviewModal, fileTypeInfo } from '../../components/DocPreviewModal'
import { useToast } from '../../context/ToastContext'
import { Check, Clock, Eye, GripVertical, Loader2, Paperclip, Pencil, Plus, Trash, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clientColor, fmtDate, fmtShortDate, hexToRgba, parseAttachments, statusStyle } from './utils'

export function StatusDashboard({ records, statusOptions, filterStatus, onFilterStatus }) {
  const total = records.length
  const counts = statusOptions.reduce((acc, s) => {
    acc[s] = records.filter(r => (r.fields?.['Status'] || 'Not started') === s).length
    return acc
  }, {})

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex gap-2 min-w-max">
      {/* Total */}
      <button
        onClick={() => onFilterStatus('')}
        className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-left shrink-0"
        style={{
          background: !filterStatus ? 'linear-gradient(135deg, rgba(125,149,255,0.24), rgba(125,149,255,0.12))' : 'rgba(255,255,255,0.03)',
          border: !filterStatus ? '1.5px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)',
          color: !filterStatus ? '#fff' : 'var(--text-2)',
          boxShadow: !filterStatus ? '0 14px 30px rgba(77,116,255,0.18)' : 'none',
        }}
      >
        <span className="text-lg font-bold tabular-nums leading-none" style={{ color: !filterStatus ? '#fff' : 'var(--text-1)' }}>{total}</span>
        <span className="text-xs font-semibold">All Projects</span>
      </button>

      {statusOptions.map(s => {
        const sc = statusStyle(s)
        const cnt = counts[s] || 0
        const active = filterStatus === s
        return (
          <button
            key={s}
            onClick={() => onFilterStatus(active ? '' : s)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-left shrink-0"
            style={{
              background: active ? sc.bg : 'rgba(255,255,255,0.03)',
              border: active ? `1.5px solid ${sc.border}` : '1px solid rgba(255,255,255,0.08)',
              boxShadow: active ? `0 12px 24px ${sc.bg}` : 'none',
            }}
          >
            <span className="text-lg font-bold tabular-nums leading-none" style={{ color: sc.color }}>{cnt}</span>
            <div>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                <span className="text-xs font-semibold" style={{ color: active ? sc.color : 'var(--text-2)' }}>{s}</span>
              </div>
            </div>
          </button>
        )
      })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail Panel — slide-in from right
// ─────────────────────────────────────────────────────────────────────────────

export function DetailPanel({ record, onClose, onEdit, onDelete, isEditor }) {
  const navigate = useNavigate()
  const [previewDocs, setPreviewDocs] = useState(null)
  const f = record?.fields || {}
  const client  = f['Client']  || ''
  const project = f['Project'] || ''
  const status  = f['Status']  || ''
  const short   = f['Short Status'] || ''
  const detail  = f['Current Status (Detailed)'] || ''
  const attachments = parseAttachments(f['Attachments'])
  const modified = f['lastModifiedTime'] || record?.createdTime || ''
  const clrHex  = clientColor(client)
  const sc      = statusStyle(status)
  const toast   = useToast()
  const openInvoices = () => {
    const params = new URLSearchParams()
    if (project) params.set('project', project)
    navigate(`/invoices?${params.toString()}`)
  }

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  if (!record) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden rounded-[28px] shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-5"
          style={{ background: `linear-gradient(135deg, ${hexToRgba(clrHex, 0.14)}, var(--card-bg))`, borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold mb-3"
                style={{ background: hexToRgba(clrHex, 0.12), border: `1px solid ${hexToRgba(clrHex, 0.24)}`, color: clrHex }}>
                <span className="w-2 h-2 rounded-full" style={{ background: clrHex }} />
                {client || 'Unknown client'}
              </div>
              <h2 className="text-2xl font-bold leading-tight" style={{ color: 'var(--text-1)' }}>{project || 'Untitled project'}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {modified && (
                  <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                    <Clock size={12} />
                    Last updated {fmtDate(modified)}
                  </p>
                )}
                {attachments.length > 0 && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                    style={{ background: 'rgba(14,165,233,0.10)', border: '1px solid rgba(14,165,233,0.22)', color: '#0ea5e9' }}
                  >
                    <Paperclip size={11} />
                    {attachments.length} attachment{attachments.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {isEditor && (
                <>
                  <button onClick={onEdit} className="btn-icon p-2" title="Edit" style={{ color: 'var(--text-3)' }}>
                    <Pencil size={15} />
                  </button>
                  <button onClick={onDelete} className="btn-icon p-2" title="Delete"
                    style={{ color: 'rgba(239,68,68,0.7)' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.7)'}>
                    <Trash size={15} />
                  </button>
                </>
              )}
              <button onClick={onClose} className="btn-icon p-2" style={{ color: 'var(--text-3)' }}>
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">

          {/* ── Status ─────────────────────────────────────────────────── */}
          {status && (
            <div className="rounded-2xl p-4" style={{ background: sc.bg, border: `1px solid ${sc.border}` }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: sc.color }}>Current Status</p>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-bold"
                style={{ background: 'var(--card-bg)', color: sc.color, border: `1px solid ${sc.border}` }}>
                <span className="w-2 h-2 rounded-full" style={{ background: sc.dot }} />
                {status}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[0.9fr,1.1fr] gap-5">
            <div className="space-y-5">
              <div className="rounded-2xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>Status Headline</p>
                <p className="text-sm font-semibold leading-relaxed" style={{ color: 'var(--text-1)' }}>{short || 'No headline added yet.'}</p>
              </div>

              <div className="rounded-2xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>Portfolio Context</p>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-3)' }}>Client</p>
                    <p style={{ color: 'var(--text-1)' }}>{client || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-3)' }}>Project</p>
                    <p style={{ color: 'var(--text-1)' }}>{project || '—'}</p>
                  </div>
                  <div className="pt-1">
                    <button onClick={openInvoices} className="btn-ghost text-xs" style={{ padding: '0.4rem 0.7rem' }}>
                      View invoices
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>Detailed Update</p>
              <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>
                {detail?.trim() || short?.trim() || 'No detailed update added yet.'}
              </div>
            </div>
          </div>

          {/* Attachments — still previewable below, but surfaced in the header above */}
          {attachments.length > 0 && (
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
                Attachments <span className="font-normal normal-case" style={{ color: 'var(--text-3)' }}>· click to preview</span>
              </p>
              <AttachmentList
                attachments={attachments}
                onPreview={(i) => setPreviewDocs({ docs: attachments, index: i })}
              />
            </div>
          )}

          <DocPreviewModal state={previewDocs} onClose={() => setPreviewDocs(null)} />
        </div>
      </div>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Card — Card view
// ─────────────────────────────────────────────────────────────────────────────

export function StatusCard({ record, isEditor, onEdit, onDelete, onDetail, selected, onSelect, expanded, onToggle, deleting, compact = false, showClientAccents = true }) {
  const f        = record.fields || {}
  const client   = f['Client']  || '?'
  const project  = f['Project'] || '?'
  const short    = f['Short Status'] || ''
  const detail   = f['Current Status (Detailed)'] || ''
  const status   = f['Status'] || ''
  const modified = f['lastModifiedTime'] || record?.createdTime || ''
  const attachments = parseAttachments(f['Attachments'])
  const clrHex   = clientColor(client)
  const sc       = statusStyle(status)
  const p        = compact ? '0.75rem' : '1rem'

  return (
    <div
      className="rounded-xl overflow-hidden transition-shadow duration-150 group"
      style={{
        background: 'var(--card-bg)',
        border: `1.5px solid ${selected ? clrHex : 'var(--border)'}`,
        boxShadow: selected ? `0 0 0 3px ${hexToRgba(clrHex, 0.15)}` : '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      {/* Client accent bar */}
      {showClientAccents && <div style={{ height: 3, background: clrHex }} />}

      <div style={{ padding: p }}>
        {/* Row 1: checkbox + client chip + project + actions */}
        <div className="flex items-start gap-2 mb-2.5">
          {isEditor && (
            <button
              onClick={e => { e.stopPropagation(); onSelect(record.id) }}
              className="flex-shrink-0 mt-0.5 rounded transition-all"
              style={{
                width: 15, height: 15, minWidth: 15,
                background: selected ? clrHex : 'transparent',
                border: `2px solid ${selected ? clrHex : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {selected && <Check size={8} color="#fff" strokeWidth={3.5} />}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full mb-1"
              style={{
                background: showClientAccents ? hexToRgba(clrHex, 0.1) : 'var(--bg-input)',
                color: showClientAccents ? clrHex : 'var(--text-2)',
                border: `1px solid ${showClientAccents ? hexToRgba(clrHex, 0.2) : 'var(--border)'}`,
              }}>
              {client}
            </span>
            <p className="text-[13px] font-bold leading-snug truncate" style={{ color: 'var(--text-1)' }}>{project}</p>
          </div>
          {/* Actions — hidden until hover */}
          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={e => { e.stopPropagation(); onDetail(record) }}
              className="btn-icon p-1" style={{ color: 'var(--text-3)' }} title="View details">
              <Eye size={12} />
            </button>
            {isEditor && !deleting && (
              <>
                <button onClick={e => { e.stopPropagation(); onEdit() }}
                  className="btn-icon p-1" style={{ color: 'var(--text-3)' }} title="Edit">
                  <Pencil size={11} />
                </button>
                <button onClick={e => { e.stopPropagation(); onDelete() }}
                  className="btn-icon p-1"
                  style={{ color: 'rgba(239,68,68,0.4)' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.4)'}
                  title="Delete">
                  <Trash2 size={11} />
                </button>
              </>
            )}
            {deleting && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-3)' }} />}
          </div>
        </div>

        {/* Row 2: status badge + last modified */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {status ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                {status}
              </span>
            ) : <span />}
            {attachments.length > 0 && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: 'rgba(14,165,233,0.10)', color: '#0ea5e9', border: '1px solid rgba(14,165,233,0.22)' }}
              >
                <Paperclip size={10} />
                {attachments.length}
              </span>
            )}
          </div>
          {modified && (
            <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}>
              <Clock size={9} />{fmtShortDate(modified)}
            </span>
          )}
        </div>

        {/* Short status — headline, up to 3 lines */}
        {short && (
          <p className="text-[13px] font-semibold leading-snug mb-1.5"
            style={{ color: 'var(--text-1)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {short}
          </p>
        )}

        {/* Detailed status — dimmer, 2-line clamp, no toggle */}
        {detail && detail.trim() !== short.trim() && (
          <p className="text-[12px] leading-snug"
            style={{ color: 'var(--text-3)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {detail}
          </p>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// List View Row
// ─────────────────────────────────────────────────────────────────────────────

export function ListViewRow({ record, idx, isEditor, onEdit, onDelete, onDetail, selected, onSelect, columns, deleting, compact = false, showClientAccents = true, layout }) {
  const f = record.fields || {}
  const client   = f['Client']  || '?'
  const project  = f['Project'] || '?'
  const status   = f['Status']  || ''
  const short    = f['Short Status'] || ''
  const detail   = f['Current Status (Detailed)'] || ''
  const modified = f['lastModifiedTime'] || ''
  const clrHex   = clientColor(client)
  const sc       = statusStyle(status)
  const sel      = selected

  return (
    <div className={`grid gap-3 px-4 transition-colors group ${compact ? 'py-2.5' : 'py-3'}`}
      style={{
        gridTemplateColumns: layout.gridTemplateColumns,
        minWidth: layout.minWidth,
        alignItems: 'center',
        background: sel ? hexToRgba(clrHex, 0.05) : (idx % 2 === 0 ? 'var(--card-bg)' : 'var(--bg-input)'),
        borderBottom: '1px solid var(--border)',
        borderLeft: showClientAccents && sel ? `3px solid ${clrHex}` : '3px solid transparent',
      }}>

      {/* Checkbox */}
      {isEditor ? (
        <button onClick={() => onSelect(record.id)}
          className="w-4 h-4 rounded flex items-center justify-center transition-all"
          style={{ background: sel ? clrHex : 'transparent', border: `1.5px solid ${sel ? clrHex : 'var(--border)'}` }}>
          {sel && <Check size={9} color="#fff" strokeWidth={3} />}
        </button>
      ) : <span className="w-4" />}

      {/* Dynamic columns */}
      {columns.includes('Client') && (
        <div className="min-w-0">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold truncate"
            style={{ color: showClientAccents ? clrHex : 'var(--text-2)', background: showClientAccents ? hexToRgba(clrHex, 0.08) : 'var(--bg-input)', border: `1px solid ${showClientAccents ? hexToRgba(clrHex, 0.18) : 'var(--border)'}` }}>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: clrHex }} />
            <span className="truncate">{client}</span>
          </span>
        </div>
      )}
      {columns.includes('Project') && (
        <div className="min-w-0">
          <span className="text-[13px] font-semibold block truncate" style={{ color: 'var(--text-1)' }}>
            {project}
          </span>
        </div>
      )}
      {columns.includes('Status') && (
        <div className="min-w-0">
          {status && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
              {status}
            </span>
          )}
        </div>
      )}
      {columns.includes('Short Status') && (
        <div className="min-w-0">
          <span className="text-[12px] block truncate" style={{ color: 'var(--text-2)' }}>
            {short || '—'}
          </span>
        </div>
      )}
      {columns.includes('Detailed Status') && (
        <div className="min-w-0">
          <span className="text-[11px] block leading-relaxed"
            style={{ color: 'var(--text-3)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {detail || '—'}
          </span>
        </div>
      )}
      {columns.includes('Attachments') && (() => {
        const files = parseAttachments(f['Attachments'])
        if (!files.length) return <div className="min-w-0"><span style={{ color: 'var(--text-3)', fontSize: 11 }}>—</span></div>
        const first = fileTypeInfo(files[0])
        return (
          <div className="min-w-0">
            <button
              onClick={e => { e.stopPropagation(); onDetail(record) }}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition-all hover:opacity-80"
              style={{ background: first.bg, border: `1px solid ${first.color}33` }}
              title="Click to preview files">
              <first.Icon size={10} style={{ color: first.color }} />
              <span className="text-[11px] font-semibold" style={{ color: first.color }}>
                {files.length} file{files.length === 1 ? '' : 's'}
              </span>
            </button>
          </div>
        )
      })()}
      {columns.includes('Last Modified') && (
        <div className="min-w-0">
          <span className="text-[11px] block tabular-nums" style={{ color: 'var(--text-3)' }}>
            {fmtShortDate(modified) || '—'}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-0.5 flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <button onClick={() => onDetail(record)} className="btn-icon p-1" style={{ color: 'var(--text-3)' }} title="View">
          <Eye size={12} />
        </button>
        {isEditor && !deleting && (
          <>
            <button onClick={onEdit} className="btn-icon p-1" style={{ color: 'var(--text-3)' }} title="Edit">
              <Pencil size={12} />
            </button>
            <button onClick={onDelete} className="btn-icon p-1"
              style={{ color: 'rgba(239,68,68,0.5)' }}
              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.5)'}
              title="Delete">
              <Trash2 size={12} />
            </button>
          </>
        )}
        {deleting && <Loader2 size={11} className="animate-spin" style={{ color: 'var(--text-3)' }} />}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Kanban Board — drag-and-drop
// ─────────────────────────────────────────────────────────────────────────────

export function KanbanCard({ record, isEditor, onEdit, onDetail, selected, onSelect, updating, onDragStart, onDragEnd, isDragging, compact = false, showClientAccents = true, dragDisabled = false }) {
  const f = record.fields || {}
  const client  = f['Client']  || '?'
  const project = f['Project'] || '?'
  const short   = f['Short Status'] || ''
  const clrHex  = clientColor(client)
  const sel     = selected

  return (
    <div
      className="rounded-xl p-3 transition-all select-none"
      style={{
        background: sel ? hexToRgba(clrHex, 0.08) : 'var(--card-bg)',
        border: sel ? `1.5px solid ${clrHex}` : '1px solid var(--border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        opacity: updating ? 0.6 : isDragging ? 0.45 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-bold" style={{ color: showClientAccents ? clrHex : 'var(--text-2)' }}>{client}</span>
          <p className="text-xs font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>{project}</p>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {isEditor && (
            <div
              draggable={!updating && !dragDisabled}
              onDragStart={e => {
                if (dragDisabled) return
                e.dataTransfer.setData('text/plain', record.id)
                e.dataTransfer.effectAllowed = 'move'
                onDragStart?.(record.id)
              }}
              onDragEnd={() => onDragEnd?.()}
              className="btn-icon p-0.5"
              style={{ color: 'var(--text-3)', cursor: updating || dragDisabled ? 'not-allowed' : 'grab', opacity: dragDisabled ? 0.45 : 1 }}
              title={dragDisabled ? 'Switch board grouping back to Status to drag cards' : 'Drag to move'}
            >
              <GripVertical size={11} />
            </div>
          )}
          {isEditor && (
            <button onClick={e => { e.stopPropagation(); onSelect(record.id) }}
              className="w-4 h-4 rounded flex items-center justify-center transition-all"
              style={{ background: sel ? clrHex : 'transparent', border: `1.5px solid ${sel ? clrHex : 'var(--border)'}` }}>
              {sel && <Check size={8} color="#fff" strokeWidth={3} />}
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); onDetail(record) }} className="btn-icon p-0.5" style={{ color: 'var(--text-3)' }}>
            <Eye size={11} />
          </button>
          {isEditor && (
            <button onClick={e => { e.stopPropagation(); onEdit() }} className="btn-icon p-0.5" style={{ color: 'var(--text-3)' }}>
              <Pencil size={11} />
            </button>
          )}
        </div>
      </div>
      {short && (
        <p className={`leading-snug ${compact ? 'text-[10px]' : 'text-[11px]'}`} style={{ color: 'var(--text-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {short}
        </p>
      )}
      {updating && (
        <div className="flex items-center gap-1 mt-1.5">
          <Loader2 size={10} className="animate-spin" style={{ color: 'var(--text-3)' }} />
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Updating…</span>
        </div>
      )}
    </div>
  )
}

export function KanbanColumn({ statusKey, statusLabel, records, isEditor, onEdit, onDetail, selectedIds, onSelect, onDrop, updatingIds, onDragStart, onDragEnd, draggedId, compact = false, showClientAccents = true, draggable = true }) {
  const [dragOver, setDragOver] = useState(false)
  const sc = draggable ? statusStyle(statusLabel) : { color: '#475569', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.24)', dot: '#94a3b8' }

  function handleDragOver(e) {
    if (!draggable || !isEditor) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }

  return (
    <div
      className="flex flex-col min-w-[240px] sm:min-w-[260px] flex-1 rounded-2xl transition-all"
      style={{
        background: dragOver ? sc.bg : 'var(--bg-input)',
        border: dragOver ? `2px dashed ${sc.border}` : '1px solid var(--border)',
        boxShadow: dragOver ? `0 0 16px ${sc.bg}` : 'none',
      }}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { setDragOver(false); if (draggable && isEditor) onDrop(statusKey, e) }}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5 rounded-t-2xl"
        style={{ borderBottom: `1.5px solid ${sc.border}`, background: sc.bg }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: sc.dot }} />
          <span className="text-xs font-bold" style={{ color: sc.color }}>{statusLabel}</span>
        </div>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: sc.color, color: '#fff' }}>{records.length}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)', minHeight: 80 }}>
        {records.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2 opacity-50">
            <div className="w-8 h-8 rounded-xl border-2 border-dashed flex items-center justify-center"
              style={{ borderColor: sc.border }}>
              <Plus size={14} style={{ color: sc.color }} />
            </div>
            <p className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>{draggable ? 'Drop here' : 'No records'}</p>
          </div>
        )}
        {records.map(r => (
          <KanbanCard
            key={r.id}
            record={r}
            isEditor={isEditor}
            onEdit={() => onEdit(r)}
            onDetail={onDetail}
            selected={selectedIds.has(r.id)}
            onSelect={onSelect}
            updating={updatingIds.has(r.id)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            isDragging={draggedId === r.id}
            compact={compact}
            showClientAccents={showClientAccents}
            dragDisabled={!draggable}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Modal — create/edit
// ─────────────────────────────────────────────────────────────────────────────
