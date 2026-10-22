/**
 * The page being written, live.
 *
 * The generator already streamed its output token by token — the client
 * accumulated every delta and then displayed none of it, so all anyone saw was
 * a spinner and an elapsed counter. Watching the document appear is most of
 * what makes a generator feel like it is working rather than hanging, and it
 * is the difference between a 40-second wait and 40 seconds of progress.
 *
 * Only the tail is rendered. A full landing page runs past 40,000 characters,
 * and re-rendering all of it on every delta turns the browser into the
 * bottleneck — the visible window is the last few hundred lines, which is the
 * only part anyone is reading anyway.
 */
import { useEffect, useMemo, useRef } from 'react'

const VISIBLE_LINES = 160

export default function StreamingDraft({ content = '', label = 'Writing the page' }) {
  const paneRef = useRef(null)

  const { lines, chars, sections } = useMemo(() => {
    const all = content.split('\n')
    return {
      lines: all.slice(-VISIBLE_LINES),
      chars: content.length,
      // The generator tags every top-level block with data-agent-section, so
      // the tags arriving in the stream are a genuine progress signal rather
      // than an invented one.
      sections: [...content.matchAll(/data-agent-section="([\w-]+)"/g)].map(m => m[1]),
    }
  }, [content])

  // Follow the output the way a terminal does.
  useEffect(() => {
    const pane = paneRef.current
    if (pane) pane.scrollTop = pane.scrollHeight
  }, [content])

  if (!content) return null

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 10,
      background: 'var(--bg-base)', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
        fontSize: 11, color: 'var(--text-2)',
      }}>
        <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {chars.toLocaleString()} characters
        </span>
        {sections.length > 0 && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {sections.slice(-4).map((s, i) => (
              <span key={`${s}-${i}`} style={{
                padding: '1px 7px', borderRadius: 99, fontSize: 10, fontWeight: 600,
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                color: 'var(--accent)',
              }}>{s}</span>
            ))}
          </span>
        )}
      </div>

      <pre
        ref={paneRef}
        aria-live="polite"
        aria-label={`${label}. ${chars} characters so far.`}
        style={{
          margin: 0, padding: '10px 12px', maxHeight: 260, overflowY: 'auto',
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          fontSize: 11, lineHeight: 1.55, color: 'var(--text-2)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}
      >
        {lines.join('\n')}
        {/* The caret is what reads as "still writing" rather than "stopped". */}
        <span style={{
          display: 'inline-block', width: 7, height: 12, verticalAlign: -1,
          marginLeft: 2, background: 'var(--accent)',
          animation: 'ft-caret 1s step-end infinite',
        }} />
      </pre>

      <style>{`
        @keyframes ft-caret { 0%,100% { opacity:1 } 50% { opacity:0 } }
        @media (prefers-reduced-motion: reduce) {
          [style*="ft-caret"] { animation: none !important }
        }
      `}</style>
    </div>
  )
}
