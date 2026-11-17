// Draws every page of a PDF right in the app with pdf.js, so phones get a
// real, scrollable preview instead of a blank embedded viewer. The file comes
// straight from its URL when the host allows it, else through the API relay
// (signed-in users, Teable hosts only). Loaded on demand: pdf.js is large.
import { useEffect, useRef, useState } from 'react'
import { API_BASE_URL, getAuthToken } from '../services/api'

async function fetchPdfBytes(url, signal) {
  try {
    const direct = await fetch(url, { signal, credentials: 'omit' })
    if (direct.ok) return await direct.arrayBuffer()
  } catch (e) {
    if (e?.name === 'AbortError') throw e
  }
  const token = getAuthToken()
  const res = await fetch(`${API_BASE_URL}/api/storage/remote?url=${encodeURIComponent(url)}`, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`Could not load the PDF (${res.status})`)
  return await res.arrayBuffer()
}

export default function PdfViewer({ url, onFail }) {
  const box = useRef(null)
  const [state, setState] = useState({ status: 'loading', pages: 0 })

  useEffect(() => {
    const ctrl = new AbortController()
    let doc = null
    let cancelled = false
    const host = box.current
    setState({ status: 'loading', pages: 0 })
    ;(async () => {
      try {
        const [pdfjs, worker, bytes] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
          fetchPdfBytes(url, ctrl.signal),
        ])
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise
        if (cancelled) return
        setState({ status: 'ready', pages: doc.numPages })
        host.innerHTML = ''
        const width = Math.max(240, host.clientWidth - 16)
        const dpr = Math.min(window.devicePixelRatio || 1, 3)
        for (let n = 1; n <= doc.numPages; n += 1) {
          if (cancelled) return
          const page = await doc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const scale = width / base.width
          const vp = page.getViewport({ scale: scale * dpr })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(vp.width)
          canvas.height = Math.floor(vp.height)
          canvas.style.width = `${Math.floor(base.width * scale)}px`
          canvas.style.height = `${Math.floor(base.height * scale)}px`
          canvas.setAttribute('role', 'img')
          canvas.setAttribute('aria-label', `Page ${n} of ${doc.numPages}`)
          canvas.className = 'pdf-page'
          host.appendChild(canvas)
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
        }
      } catch (e) {
        if (cancelled || e?.name === 'AbortError') return
        setState({ status: 'error', pages: 0 })
        onFail?.(e)
      }
    })()
    return () => {
      cancelled = true
      ctrl.abort()
      doc?.destroy?.()
    }
  }, [url, onFail])

  return (
    <div className="flex-1 min-h-0 overflow-auto relative" style={{ background: 'var(--bg-base)', WebkitOverflowScrolling: 'touch' }}>
      {state.status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent)' }} />
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading PDF…</p>
        </div>
      )}
      <div ref={box} className="pdf-pages" />
    </div>
  )
}
