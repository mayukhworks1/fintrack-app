/**
 * The plan shown before an artifact is built: a title and summary, the
 * features it would build (all ticked, all editable, plus your own), a few
 * questions with sensible defaults, and a style. "Build it" builds with those
 * choices; "Skip questions" builds from the request as typed.
 *
 * While the plan is being written a skeleton holds its place, and skipping is
 * already possible.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { composeBuildPrompt, initialChoices, readDontAsk, writeDontAsk } from './artifactPlan'
import './PlanCard.css'

function Chip({ type, name, checked, onChange, children, className = '' }) {
  return (
    <label className={`plan-chip ${className}`}>
      <input type={type} name={name} checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  )
}

export function PlanSkeleton({ onSkip, btnStyle }) {
  return (
    <section className="plan-card" aria-busy="true" aria-label="Planning your app">
      <div className="plan-head">
        <span className="plan-eyebrow"><Sparkles size={13} aria-hidden="true" /> Planning your app…</span>
      </div>
      <div className="plan-skeleton" aria-hidden="true">
        <div className="skeleton" style={{ height: 20, width: '45%' }} />
        <div className="skeleton" style={{ height: 12, width: '80%' }} />
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', marginTop: 6 }}>
          {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton" style={{ height: 14, width: `${70 + (i % 3) * 10}%` }} />)}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {[90, 120, 100].map((w, i) => <div key={i} className="skeleton" style={{ height: 30, width: w, borderRadius: 99 }} />)}
        </div>
      </div>
      <div className="plan-foot">
        <span style={{ marginRight: 'auto', fontSize: 12.5, color: 'var(--text-2)' }}>A few seconds. You can skip this and build straight away.</span>
        <button type="button" style={btnStyle} onClick={onSkip}>Skip and build now</button>
      </div>
    </section>
  )
}

export default function PlanCard({ prompt, plan, onBuild, onSkip, onBack, btnStyle, btnPrimaryStyle }) {
  const uid = useId()
  const [choices, setChoices] = useState(() => initialChoices(plan))
  const [extra, setExtra] = useState('')
  const [dontAsk, setDontAsk] = useState(readDontAsk)
  const headingRef = useRef(null)

  // Focus moves to the plan when it appears, so keyboard and screen-reader
  // users land on it rather than on a button that has gone.
  useEffect(() => { headingRef.current?.focus() }, [])

  const toggleFeature = (i) => setChoices(c => ({
    ...c, features: c.features.map((f, j) => (j === i ? { ...f, on: !f.on } : f)),
  }))
  const addFeature = () => {
    const text = extra.trim()
    if (!text) return
    setChoices(c => (c.features.some(f => f.text.toLowerCase() === text.toLowerCase())
      ? c
      : { ...c, features: [...c.features, { text, on: true }] }))
    setExtra('')
  }
  const answer = (q, option) => setChoices(c => {
    if (!q.multi) return { ...c, answers: { ...c.answers, [q.id]: option } }
    const now = c.answers[q.id] || []
    const next = now.includes(option) ? now.filter(o => o !== option) : [...now, option]
    return { ...c, answers: { ...c.answers, [q.id]: next } }
  })
  const setDontAskPref = (on) => { setDontAsk(on); writeDontAsk(on) }

  const kept = choices.features.filter(f => f.on).length
  const build = () => onBuild(composeBuildPrompt(prompt, plan, choices), choices.style)

  return (
    <section className="plan-card" aria-labelledby={`${uid}-title`}>
      <div className="plan-head">
        <span className="plan-eyebrow"><Sparkles size={13} aria-hidden="true" /> Here’s the plan. Change anything, then build.</span>
        <h3 id={`${uid}-title`} ref={headingRef} tabIndex={-1} className="plan-title" style={{ outline: 'none' }}>
          {plan.title || 'Your app'}
        </h3>
        {plan.summary && <p className="plan-summary">{plan.summary}</p>}
      </div>

      <div className="plan-body">
        <fieldset className="plan-group">
          <legend className="plan-legend">Features <span style={{ fontWeight: 500, color: 'var(--text-2)' }}>· {kept} selected</span></legend>
          <div className="plan-features">
            {choices.features.map((f, i) => (
              <label key={`${f.text}-${i}`} className={`plan-feature${f.on ? '' : ' off'}`}>
                <input type="checkbox" checked={f.on} onChange={() => toggleFeature(i)} />
                <span>{f.text}</span>
              </label>
            ))}
          </div>
          <div className="plan-add">
            <label htmlFor={`${uid}-extra`} className="sr-only">Add your own feature</label>
            <input
              id={`${uid}-extra`}
              value={extra}
              maxLength={120}
              placeholder="Add your own, e.g. export to CSV"
              onChange={e => setExtra(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeature() } }}
            />
            <button type="button" style={btnStyle} onClick={addFeature} disabled={!extra.trim()}>Add</button>
          </div>
        </fieldset>

        {plan.questions.map(q => (
          <fieldset key={q.id} className="plan-group">
            <legend className="plan-legend">{q.question}{q.multi && <span style={{ fontWeight: 500, color: 'var(--text-2)' }}> · pick any</span>}</legend>
            <div className="plan-chips">
              {q.options.map(o => {
                const a = choices.answers[q.id]
                const on = q.multi ? (a || []).includes(o) : a === o
                return (
                  <Chip key={o} type={q.multi ? 'checkbox' : 'radio'} name={`${uid}-${q.id}`} checked={on} onChange={() => answer(q, o)}>
                    <Check size={13} className="tick" aria-hidden="true" />{o}
                  </Chip>
                )
              })}
            </div>
          </fieldset>
        ))}

        {plan.styleOptions.length > 0 && (
          <fieldset className="plan-group">
            <legend className="plan-legend">Style</legend>
            <div className="plan-styles">
              {plan.styleOptions.map(s => (
                <Chip key={s.id} type="radio" name={`${uid}-style`} className="plan-style"
                  checked={choices.style === s.id} onChange={() => setChoices(c => ({ ...c, style: s.id }))}>
                  {s.label}
                  {s.description && <small>{s.description}</small>}
                </Chip>
              ))}
            </div>
          </fieldset>
        )}
      </div>

      <div className="plan-foot">
        <label className="plan-dontask">
          <input type="checkbox" checked={dontAsk} onChange={e => setDontAskPref(e.target.checked)} />
          Don’t ask before building
        </label>
        {onBack && <button type="button" className="plan-link" onClick={onBack}>Edit request</button>}
        <button type="button" className="plan-link" onClick={onSkip}>Skip questions</button>
        <button type="button" className="plan-build" style={{ ...btnPrimaryStyle, padding: '8px 18px', fontSize: 13 }} onClick={build}>
          Build it
        </button>
      </div>
    </section>
  )
}
