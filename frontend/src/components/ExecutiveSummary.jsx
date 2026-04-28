import { useEffect, useState, useCallback } from 'react'
import { Sparkles, RefreshCw, AlertCircle } from 'lucide-react'
import { api } from '../services/api'
import clsx from 'clsx'

/**
 * AI Executive Summary card.
 *
 * Shows a 3-sentence AI-generated narrative summary of the business,
 * regenerated every 5 minutes (server-side cached) or on demand.
 *
 * Design: a hero-banner card with a subtle gradient, sparkle icon,
 * and typewriter-style reveal. Sized to dominate the top of the
 * Dashboard.
 */
export default function ExecutiveSummary() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchSummary = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else         setRefreshing(true)
    setError(null)
    try {
      const res = await api.ai.executiveSummary()
      setData(res)
    } catch (e) {
      setError(e.message || 'Could not generate summary')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchSummary(false) }, [fetchSummary])

  const sparkleColor = '#a78bfa'  // violet — AI signature

  return (
    <section
      aria-label="AI executive summary"
      className="relative overflow-hidden rounded-2xl animate-fade-in"
      style={{
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 30%, #4338ca 70%, #6d28d9 100%)',
        boxShadow: '0 4px 24px rgba(30,58,138,0.20), 0 1px 3px rgba(30,58,138,0.10)',
      }}
    >
      {/* Decorative gradient blobs */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute" style={{
          top: -80, right: -40, width: 320, height: 320,
          background: 'radial-gradient(circle, rgba(167,139,250,0.35) 0%, transparent 60%)',
          filter: 'blur(24px)',
        }} />
        <div className="absolute" style={{
          bottom: -60, left: 40, width: 240, height: 240,
          background: 'radial-gradient(circle, rgba(96,165,250,0.25) 0%, transparent 60%)',
          filter: 'blur(20px)',
        }} />
        {/* Subtle grid pattern */}
        <div className="absolute inset-0" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse at center, black 50%, transparent 90%)',
        }} />
      </div>

      <div className="relative p-5 sm:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div
              className="rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                width: 36, height: 36,
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.18)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <Sparkles size={16} style={{ color: sparkleColor }} aria-hidden="true" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ color: 'rgba(255,255,255,0.65)' }}>
                Executive Briefing
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {data?.model && `Powered by ${data.model}`}
                {data?.model && refreshing && ' · '}
                {refreshing && <span className="animate-pulse">refreshing…</span>}
              </p>
            </div>
          </div>
          <button
            onClick={() => fetchSummary(true)}
            disabled={loading || refreshing}
            aria-label="Regenerate summary"
            className="rounded-lg p-1.5 transition-all"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.85)',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.16)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
          >
            <RefreshCw size={13} className={clsx((loading || refreshing) && 'animate-spin')} />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="space-y-2 mt-2" aria-hidden="true">
            <div className="h-4 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.08)', width: '90%' }} />
            <div className="h-4 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.08)', width: '78%' }} />
            <div className="h-4 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.08)', width: '85%' }} />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
            <AlertCircle size={14} />
            <span>{error}</span>
            <button onClick={() => fetchSummary(false)}
              className="underline ml-1" style={{ color: 'rgba(255,255,255,0.95)' }}>retry</button>
          </div>
        ) : (
          <p
            className="text-[15px] sm:text-base leading-relaxed font-medium"
            style={{
              color: '#fff',
              letterSpacing: '-0.005em',
              textShadow: '0 1px 2px rgba(0,0,0,0.15)',
            }}
          >
            {data?.summary}
          </p>
        )}
      </div>
    </section>
  )
}
