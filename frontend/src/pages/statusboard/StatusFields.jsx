// Extracted from StatusBoard.jsx — StatusFields.
import { fileTypeInfo } from '../../components/DocPreviewModal'
import { api } from '../../services/api'
import { ChevronDown, ExternalLink, Loader2, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function StatusAttachmentField({ value, onChange, recordId }) {
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const [dragOver,  setDragOver]  = useState(false)
  const fileInputRef = useRef(null)
  const attachments = Array.isArray(value) ? value : []
  const disabled = !recordId

  async function processFiles(files) {
    if (!files?.length || !recordId) return
    setUploading(true)
    setUploadErr('')
    try {
      let latest = attachments
      for (const file of files) {
        const result = await api.status.upload(recordId, 'Attachments', file)
        latest = result?.attachments || latest
      }
      onChange(latest)
    } catch (e) {
      setUploadErr(e.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    if (disabled || uploading) return
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length) processFiles(files)
  }

  function removeAt(index) {
    onChange(attachments.filter((_, i) => i !== index))
  }

  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
        Attachments <span className="font-normal" style={{ color: 'var(--text-3)' }}>· shared with public views</span>
      </label>
      {attachments.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {attachments.map((item, index) => {
            const name = item?.name || item?.filename || `Attachment ${index + 1}`
            const url  = item?.url  || item?.presignedUrl || ''
            const info = fileTypeInfo(item)
            return (
              <div key={`${name}-${index}`} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ background: info.bg }}>
                  <info.Icon size={11} style={{ color: info.color }} />
                </div>
                <span className="flex-1 truncate text-xs font-medium" style={{ color: 'var(--text-2)' }}>{name}</span>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    className="btn-icon p-1" style={{ opacity: 0.5 }} aria-label="Open">
                    <ExternalLink size={11} />
                  </a>
                )}
                <button type="button" onClick={() => removeAt(index)}
                  className="btn-icon p-1" style={{ color: '#ef4444', opacity: 0.6 }}
                  aria-label="Remove attachment" title="Remove">
                  <X size={11} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div
        onDragOver={e => { e.preventDefault(); if (!disabled && !uploading) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}>
        <button
          type="button"
          onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
          disabled={disabled || uploading}
          className="w-full rounded-xl border border-dashed px-3 py-4 flex items-center justify-center gap-2 text-sm font-medium transition-all"
          style={{
            borderColor: dragOver ? 'rgba(59,130,246,0.6)' : (disabled ? 'var(--border)' : 'rgba(59,130,246,0.28)'),
            background: dragOver ? 'rgba(59,130,246,0.08)' : (disabled ? 'var(--bg-input)' : 'rgba(59,130,246,0.04)'),
            color: disabled ? 'var(--text-3)' : 'var(--text-2)',
            opacity: disabled ? 0.8 : 1,
            transform: dragOver ? 'scale(1.01)' : 'scale(1)',
          }}>
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {disabled ? 'Save the status first to upload files' : dragOver ? 'Drop files here' : 'Upload or drag & drop files'}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={e => processFiles(Array.from(e.target.files || []))}
      />
      {uploadErr && <p className="mt-1.5 text-xs" style={{ color: '#ef4444' }}>{uploadErr}</p>}
    </div>
  )
}

export function ComboBox({ value, onChange, options, placeholder, required, id }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value || '')
  const ref = useRef(null)
  const filtered = query
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => { setQuery(value || '') }, [value])

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function select(opt) {
    onChange(opt)
    setQuery(opt)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref} id={id}>
      <div className="relative">
        <input
          className="input-field w-full text-sm pr-8"
          value={query}
          required={required}
          placeholder={placeholder}
          autoComplete="off"
          onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
        />
        <button type="button" tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--text-3)' }}
          onClick={() => setOpen(o => !o)}>
          <ChevronDown size={14} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl shadow-xl overflow-y-auto"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: 220, boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
          {filtered.map(opt => (
            <button key={opt} type="button"
              className="w-full text-left px-3 py-2 text-sm transition-colors"
              style={{ color: opt === value ? 'var(--accent)' : 'var(--text-1)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              onClick={() => select(opt)}>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
