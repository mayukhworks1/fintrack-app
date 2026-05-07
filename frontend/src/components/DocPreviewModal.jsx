/**
 * DocPreviewModal — universal inline document previewer.
 *
 * Usage:
 *   const [previewDocs, setPreviewDocs] = useState(null) // { docs: [...], index: 0 }
 *   <DocPreviewModal state={previewDocs} onClose={() => setPreviewDocs(null)} />
 *
 *   To open:  setPreviewDocs({ docs: allFiles, index: clickedIndex })
 *
 * Preview strategy:
 *   • Images  → native <img> with pinch/scroll zoom + rotate
 *   • PDFs    → Google Docs Viewer iframe (works cross-origin, no CORS issues)
 *   • Others  → Download + Open-in-tab fallback
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Download, ExternalLink, FileText, Image as ImageIcon,
  ZoomIn, ZoomOut, RotateCw, ChevronLeft, ChevronRight,
} from 'lucide-react'

/* ── helpers ── */
const isImage = (a) => {
  if (!a) return false
  if (a.mime?.startsWith('image/')) return true
  return /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(a.url || '') ||
         /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.name || '')
}
const isPdf = (a) => {
  if (!a) return false
  return a.mime === 'application/pdf' ||
         /\.pdf(\?|$)/i.test(a.url || '') ||
         (a.name || '').toLowerCase().endsWith('.pdf')
}

/* ── Google Docs Viewer URL ── */
const gdocsUrl = (url) =>
  `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`

/* ── single-doc preview body ── */
function PreviewBody({ doc }) {
  const [iframeError, setIframeError]   = useState(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [zoom, setZoom]   = useState(1)
  const [rotate, setRotate] = useState(0)

  // Reset state whenever the doc changes
  useEffect(() => {
    setIframeError(false)
    setIframeLoaded(false)
    setZoom(1)
    setRotate(0)
  }, [doc?.url])

  if (!doc) return null

  /* Image */
  if (isImage(doc)) {
    return (
      <div className="flex-1 overflow-auto flex items-center justify-center min-h-0 relative"
        style={{ background: 'var(--bg-base)', padding: '1.5rem' }}>
        {/* Zoom / rotate controls */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded-lg z-10"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
          <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="w-7 h-7 flex items-center justify-center rounded opacity-80 hover:opacity-100" style={{ color: '#fff' }} title="Zoom out">
            <ZoomOut size={13} />
          </button>
          <span className="text-[11px] tabular-nums text-white min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} className="w-7 h-7 flex items-center justify-center rounded opacity-80 hover:opacity-100" style={{ color: '#fff' }} title="Zoom in">
            <ZoomIn size={13} />
          </button>
          <div className="w-px h-4 mx-1" style={{ background: 'rgba(255,255,255,0.25)' }} />
          <button onClick={() => setRotate(r => (r + 90) % 360)} className="w-7 h-7 flex items-center justify-center rounded opacity-80 hover:opacity-100" style={{ color: '#fff' }} title="Rotate">
            <RotateCw size={13} />
          </button>
          <button onClick={() => { setZoom(1); setRotate(0) }} className="text-[10px] px-2 py-0.5 rounded opacity-70 hover:opacity-100" style={{ color: '#fff' }}>Reset</button>
        </div>

        <img
          src={doc.url}
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

  /* PDF via Google Docs Viewer */
  if (isPdf(doc)) {
    if (iframeError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center min-h-0"
          style={{ background: 'var(--bg-base)' }}>
          <FileText size={52} style={{ color: 'var(--text-3)', opacity: 0.25 }} />
          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-2)' }}>Preview unavailable</p>
            <p className="text-xs max-w-xs mx-auto" style={{ color: 'var(--text-3)' }}>
              This PDF could not be loaded in the viewer. Open it directly below.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            <a href={doc.url} download={doc.name}
              className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.45rem 0.9rem' }}>
              <Download size={13} />Download
            </a>
            <a href={doc.url} target="_blank" rel="noopener noreferrer"
              className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.45rem 0.9rem' }}>
              <ExternalLink size={13} />Open in new tab
            </a>
          </div>
        </div>
      )
    }

    return (
      <div className="flex-1 relative min-h-0 flex flex-col">
        {/* Loading overlay */}
        {!iframeLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10"
            style={{ background: 'var(--bg-base)' }}>
            <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--accent)' }} />
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading PDF preview…</p>
          </div>
        )}
        <iframe
          key={doc.url}
          src={gdocsUrl(doc.url)}
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

  /* Unknown file type */
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center min-h-0"
      style={{ background: 'var(--bg-base)' }}>
      <FileText size={52} style={{ color: 'var(--text-3)', opacity: 0.25 }} />
      <div>
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-2)' }}>{doc.name}</p>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>Preview not available for this file type</p>
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        <a href={doc.url} download={doc.name}
          className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.45rem 0.9rem' }}>
          <Download size={13} />Download
        </a>
        <a href={doc.url} target="_blank" rel="noopener noreferrer"
          className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.45rem 0.9rem' }}>
          <ExternalLink size={13} />Open in new tab
        </a>
      </div>
    </div>
  )
}

/* ── Main modal ── */
export function DocPreviewModal({ state, onClose }) {
  const [idx, setIdx] = useState(0)

  // Sync index when state changes
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

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-stretch animate-fade-in" role="dialog" aria-modal="true" aria-label={`Preview: ${doc?.name}`}>
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(10px)' }} onClick={onClose} />

      {/* Panel */}
      <div className="relative flex flex-col w-full m-3 sm:m-6 rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', zIndex: 1 }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0 gap-3"
          style={{ borderBottom: '1px solid var(--card-border)', background: 'var(--sidebar-bg)' }}>

          {/* Left: icon + name + doc count */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {isPdf(doc)
              ? <FileText size={15} style={{ color: '#f87171', flexShrink: 0 }} />
              : isImage(doc)
                ? <ImageIcon size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />
                : <FileText size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{doc?.name}</p>
            {multi && (
              <span className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded-md tabular-nums"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                {idx + 1} / {docs.length}
              </span>
            )}
          </div>

          {/* Right: actions + close */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <a href={doc?.url} download={doc?.name}
              className="btn-ghost hidden sm:flex"
              style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem' }}
              onClick={e => e.stopPropagation()}
              title="Download file">
              <Download size={12} />
              <span>Download</span>
            </a>
            <a href={doc?.url} target="_blank" rel="noopener noreferrer"
              className="btn-ghost hidden sm:flex"
              style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem' }}
              onClick={e => e.stopPropagation()}
              title="Open in new tab">
              <ExternalLink size={12} />
              <span>Open</span>
            </a>
            {/* Mobile: just icons */}
            <a href={doc?.url} download={doc?.name} className="sm:hidden btn-icon" title="Download"><Download size={14} /></a>
            <a href={doc?.url} target="_blank" rel="noopener noreferrer" className="sm:hidden btn-icon" title="Open in tab"><ExternalLink size={14} /></a>
            <button onClick={onClose} className="btn-icon" aria-label="Close preview">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Preview body ── */}
        <PreviewBody doc={doc} />

        {/* ── Multi-doc navigation ── */}
        {multi && (
          <div className="flex items-center justify-center gap-3 py-3 flex-shrink-0"
            style={{ borderTop: '1px solid var(--card-border)', background: 'var(--sidebar-bg)' }}>
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
              className="btn-icon" style={{ opacity: idx === 0 ? 0.3 : 1 }} aria-label="Previous">
              <ChevronLeft size={16} />
            </button>

            {/* Dot indicators */}
            <div className="flex items-center gap-1.5">
              {docs.map((d, i) => (
                <button key={i} onClick={() => setIdx(i)}
                  title={d.name}
                  style={{
                    width: i === idx ? 20 : 7,
                    height: 7,
                    borderRadius: 9999,
                    background: i === idx ? 'var(--accent)' : 'var(--card-border)',
                    transition: 'all 0.2s',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }} />
              ))}
            </div>

            <button onClick={() => setIdx(i => Math.min(docs.length - 1, i + 1))} disabled={idx === docs.length - 1}
              className="btn-icon" style={{ opacity: idx === docs.length - 1 ? 0.3 : 1 }} aria-label="Next">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
