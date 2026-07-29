/**
 * DocPreviewModal — universal inline document previewer.
 *
 * Supports:
 *   • Images  (png, jpg, jpeg, gif, webp, svg) — zoom + rotate
 *   • PDFs    — Google Docs Viewer iframe
 *   • Office  (docx, xlsx, pptx, doc, xls, ppt) — Google Docs Viewer iframe
 *   • Others  — Download + open-in-tab fallback
 *
 * Usage:
 *   const [previewDocs, setPreviewDocs] = useState(null) // { docs: [...], index: 0 }
 *   <DocPreviewModal state={previewDocs} onClose={() => setPreviewDocs(null)} />
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Download, ExternalLink, FileText, Image as ImageIcon,
  ZoomIn, ZoomOut, RotateCw, ChevronLeft, ChevronRight,
  File, FileSpreadsheet, Presentation,
} from 'lucide-react'

/* ── file-type detection ─────────────────────────────────────────────────── */

function extOf(a) {
  return ((a?.name || a?.url || '').split('.').pop() || '').toLowerCase().split('?')[0]
}

const IMAGE_EXTS  = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'avif'])
const PDF_EXTS    = new Set(['pdf'])
const WORD_EXTS   = new Set(['doc', 'docx', 'odt', 'rtf'])
const EXCEL_EXTS  = new Set(['xls', 'xlsx', 'ods', 'csv'])
const PPT_EXTS    = new Set(['ppt', 'pptx', 'odp'])

function isImage(a) {
  if (!a) return false
  if (a.mime?.startsWith('image/')) return true
  return IMAGE_EXTS.has(extOf(a))
}
function isPdf(a) {
  if (!a) return false
  return a.mime === 'application/pdf' || PDF_EXTS.has(extOf(a))
}
function isWord(a)  { return WORD_EXTS.has(extOf(a)) }
function isExcel(a) { return EXCEL_EXTS.has(extOf(a)) }
function isPpt(a)   { return PPT_EXTS.has(extOf(a)) }
function isOffice(a){ return isWord(a) || isExcel(a) || isPpt(a) }
function isGdocsViewable(a) { return isPdf(a) || isOffice(a) }

export function fileTypeInfo(a) {
  if (isImage(a))  return { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  label: 'Image',  Icon: ImageIcon }
  if (isPdf(a))    return { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: 'PDF',    Icon: FileText }
  if (isWord(a))   return { color: '#2563eb', bg: 'rgba(37,99,235,0.12)',   label: 'Word',   Icon: FileText }
  if (isExcel(a))  return { color: '#16a34a', bg: 'rgba(22,163,74,0.12)',   label: 'Excel',  Icon: FileSpreadsheet }
  if (isPpt(a))    return { color: '#d97706', bg: 'rgba(217,119,6,0.12)',   label: 'PPT',    Icon: Presentation }
  return            { color: '#64748b', bg: 'rgba(100,116,139,0.12)', label: extOf(a).toUpperCase() || 'File', Icon: File }
}

/* ── Google Docs Viewer URL ───────────────────────────────────────────────── */
const gdocsUrl = (url) =>
  `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`

/* ── single-doc preview body ─────────────────────────────────────────────── */
function PreviewBody({ doc }) {
  const [iframeError,  setIframeError]  = useState(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [zoom,   setZoom]   = useState(1)
  const [rotate, setRotate] = useState(0)

  useEffect(() => {
    setIframeError(false)
    setIframeLoaded(false)
    setZoom(1)
    setRotate(0)
  }, [doc?.url])

  if (!doc) return null
  const url = doc.url || doc.presignedUrl || ''

  /* ── Image ── */
  if (isImage(doc)) {
    return (
      <div className="flex-1 overflow-auto flex items-center justify-center min-h-0 relative"
        style={{ background: 'var(--bg-base)', padding: '1.5rem' }}>
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded-lg z-10"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
          <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}
            className="w-7 h-7 flex items-center justify-center rounded opacity-80 hover:opacity-100" style={{ color: '#fff' }} title="Zoom out">
            <ZoomOut size={13} />
          </button>
          <span className="text-[11px] tabular-nums text-white min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(4, z + 0.25))}
            className="w-7 h-7 flex items-center justify-center rounded opacity-80 hover:opacity-100" style={{ color: '#fff' }} title="Zoom in">
            <ZoomIn size={13} />
          </button>
          <div className="w-px h-4 mx-1" style={{ background: 'rgba(255,255,255,0.25)' }} />
          <button onClick={() => setRotate(r => (r + 90) % 360)}
            className="w-7 h-7 flex items-center justify-center rounded opacity-80 hover:opacity-100" style={{ color: '#fff' }} title="Rotate">
            <RotateCw size={13} />
          </button>
          <button onClick={() => { setZoom(1); setRotate(0) }}
            className="text-[10px] px-2 py-0.5 rounded opacity-70 hover:opacity-100" style={{ color: '#fff' }}>Reset</button>
        </div>
        <img
          src={url}
          alt={doc.name}
          style={{
            maxWidth: '100%',
            maxHeight: '75vh',
            objectFit: 'contain',
            transform: `scale(${zoom}) rotate(${rotate}deg)`,
            transformOrigin: 'center',
            transition: 'transform 0.2s ease',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        />
      </div>
    )
  }

  /* ── PDF / Office via Google Docs Viewer ── */
  if (isGdocsViewable(doc)) {
    if (iframeError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center min-h-0"
          style={{ background: 'var(--bg-base)' }}>
          <FileText size={52} style={{ color: 'var(--text-3)', opacity: 0.25 }} />
          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-2)' }}>Preview unavailable</p>
            <p className="text-xs max-w-xs mx-auto" style={{ color: 'var(--text-3)' }}>
              Could not load this file in the viewer. Open it directly below.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            <a href={url} download={doc.name} className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.45rem 0.9rem' }}>
              <Download size={13} />Download
            </a>
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.45rem 0.9rem' }}>
              <ExternalLink size={13} />Open in new tab
            </a>
          </div>
        </div>
      )
    }
    return (
      <div className="flex-1 relative min-h-0 flex flex-col">
        {!iframeLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10"
            style={{ background: 'var(--bg-base)' }}>
            <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--accent)' }} />
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              {isPdf(doc) ? 'Loading PDF…' : 'Loading document…'}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--text-3)', opacity: 0.6 }}>
              Powered by Google Docs Viewer
            </p>
          </div>
        )}
        <iframe
          key={url}
          src={gdocsUrl(url)}
          title={doc.name}
          className="flex-1 w-full"
          style={{ border: 'none', minHeight: '60vh' }}
          onLoad={() => setIframeLoaded(true)}
          onError={() => setIframeError(true)}
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      </div>
    )
  }

  /* ── Unknown file type ── */
  const info = fileTypeInfo(doc)
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center min-h-0"
      style={{ background: 'var(--bg-base)' }}>
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: info.bg }}>
        <info.Icon size={32} style={{ color: info.color }} />
      </div>
      <div>
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-2)' }}>{doc.name}</p>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>Preview not available for this file type</p>
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        <a href={url} download={doc.name} className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.45rem 0.9rem' }}>
          <Download size={13} />Download
        </a>
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.45rem 0.9rem' }}>
          <ExternalLink size={13} />Open in new tab
        </a>
      </div>
    </div>
  )
}

/* ── Thumbnail strip ─────────────────────────────────────────────────────── */
function ThumbnailStrip({ docs, idx, onSelect }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 overflow-x-auto flex-shrink-0"
      style={{ borderTop: '1px solid var(--card-border)', background: 'var(--sidebar-bg)' }}>
      {docs.map((d, i) => {
        const info = fileTypeInfo(d)
        const active = i === idx
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            title={d.name || `File ${i + 1}`}
            style={{
              flexShrink: 0,
              padding: '0.35rem 0.65rem',
              borderRadius: 10,
              fontSize: 11,
              fontWeight: active ? 700 : 500,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              maxWidth: 140,
              background: active ? info.bg : 'transparent',
              border: `1px solid ${active ? info.color + '44' : 'var(--card-border)'}`,
              color: active ? info.color : 'var(--text-3)',
              transition: 'all 0.15s',
            }}>
            <info.Icon size={11} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.name || `File ${i + 1}`}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ── Main modal ───────────────────────────────────────────────────────────── */
export function DocPreviewModal({ state, onClose }) {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (state) setIdx(state.index ?? 0)
  }, [state])

  const handleKey = useCallback((e) => {
    if (!state) return
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowLeft')  setIdx(i => Math.max(0, i - 1))
    if (e.key === 'ArrowRight') setIdx(i => Math.min((state.docs?.length ?? 1) - 1, i + 1))
  }, [state, onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  if (!state?.docs?.length) return null

  const docs  = state.docs
  const doc   = docs[idx]
  const multi = docs.length > 1
  const info  = fileTypeInfo(doc)
  const url   = doc?.url || doc?.presignedUrl || ''

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-stretch overlay-safe" role="dialog" aria-modal="true" aria-label={`Preview: ${doc?.name}`}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(10px)' }} onClick={onClose} />
      <div className="relative flex flex-col w-full m-3 sm:m-6 rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', zIndex: 1 }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0 gap-3"
          style={{ borderBottom: '1px solid var(--card-border)', background: 'var(--sidebar-bg)' }}>
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: info.bg }}>
              <info.Icon size={13} style={{ color: info.color }} />
            </div>
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{doc?.name}</p>
            <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: info.bg, color: info.color }}>
              {info.label}
            </span>
            {multi && (
              <span className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded-md tabular-nums"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                {idx + 1} / {docs.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {multi && (
              <>
                <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                  className="btn-icon" style={{ opacity: idx === 0 ? 0.3 : 1 }} title="Previous (←)">
                  <ChevronLeft size={14} />
                </button>
                <button onClick={() => setIdx(i => Math.min(docs.length - 1, i + 1))} disabled={idx === docs.length - 1}
                  className="btn-icon" style={{ opacity: idx === docs.length - 1 ? 0.3 : 1 }} title="Next (→)">
                  <ChevronRight size={14} />
                </button>
              </>
            )}
            <a href={url} download={doc?.name}
              className="btn-ghost hidden sm:flex" style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem' }}
              onClick={e => e.stopPropagation()} title="Download">
              <Download size={12} /><span>Download</span>
            </a>
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="btn-ghost hidden sm:flex" style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem' }}
              onClick={e => e.stopPropagation()} title="Open in new tab">
              <ExternalLink size={12} /><span>Open</span>
            </a>
            <a href={url} download={doc?.name} className="sm:hidden btn-icon" title="Download"><Download size={14} /></a>
            <a href={url} target="_blank" rel="noopener noreferrer" className="sm:hidden btn-icon" title="Open in tab"><ExternalLink size={14} /></a>
            <button onClick={onClose} className="btn-icon ml-1" aria-label="Close preview"><X size={14} /></button>
          </div>
        </div>

        {/* ── Preview body ── */}
        <PreviewBody doc={doc} />

        {/* ── Thumbnail strip (multi-file) ── */}
        {multi && <ThumbnailStrip docs={docs} idx={idx} onSelect={setIdx} />}
      </div>
    </div>,
    document.body
  )
}

/* ── AttachmentList — reusable list with click-to-preview ────────────────── */
export function AttachmentList({ attachments, onPreview, compact = false }) {
  if (!attachments?.length) return null
  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {attachments.map((item, index) => {
        const name = item?.name || item?.filename || `File ${index + 1}`
        const url  = item?.url  || item?.presignedUrl || ''
        const info = fileTypeInfo(item)
        return (
          <div
            key={`${name}-${index}`}
            className="flex items-center gap-2.5 rounded-xl cursor-pointer group transition-all"
            style={{
              padding: compact ? '0.4rem 0.7rem' : '0.55rem 0.85rem',
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
            }}
            onClick={() => onPreview && onPreview(index)}
            onMouseEnter={e => e.currentTarget.style.borderColor = info.color + '55'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
            <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: info.bg }}>
              <info.Icon size={11} style={{ color: info.color }} />
            </div>
            <span className="flex-1 truncate text-sm font-medium" style={{ color: 'var(--text-2)' }}>{name}</span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: info.bg, color: info.color }}>
              Preview
            </span>
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="btn-icon p-1" style={{ opacity: 0.4 }}
                title="Open in new tab"
                onClick={e => e.stopPropagation()}>
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}
