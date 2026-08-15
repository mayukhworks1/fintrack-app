import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { isChunkLoadError } from '../utils/chunkError'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('FinTrack caught error:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    // A failed module stays failed: the browser caches the rejection, so
    // re-rendering just replays it. The only way out is a fresh document, which
    // also re-fetches index.html and with it the current chunk names.
    const isStaleChunk = isChunkLoadError(this.state.error)

    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'rgba(239,68,68,0.1)', boxShadow: '0 0 24px rgba(239,68,68,0.15)' }}>
          <AlertTriangle size={28} style={{ color: '#f87171' }} />
        </div>
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          Something went wrong
        </h2>
        <p className="text-sm mb-1 max-w-sm" style={{ color: 'var(--text-3)' }}>
          {isStaleChunk
            ? 'A new version of FinTrack was released while this tab was open.'
            : (this.state.error?.message || 'An unexpected error occurred')}
        </p>
        <p className="text-xs mb-6" style={{ color: 'var(--text-3)' }}>
          {isStaleChunk
            ? 'Reload to pick it up — nothing you were doing has been lost.'
            : 'The rest of the app is still working — this section failed to render.'}
        </p>
        <button
          onClick={() => {
            if (isStaleChunk) window.location.reload()
            else this.setState({ hasError: false, error: null })
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}
        >
          <RefreshCw size={14} /> {isStaleChunk ? 'Reload' : 'Try again'}
        </button>
      </div>
    )
  }
}
