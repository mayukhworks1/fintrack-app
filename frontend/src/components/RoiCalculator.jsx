/**
 * What slow collections cost you — your numbers, your arithmetic.
 *
 * Every assumption is an input the visitor sets, and every result is a line
 * of arithmetic over those inputs, written out beside it. Nothing here is a
 * FinTrack outcome: the product does not promise a days-sales-outstanding
 * figure, and a calculator that quietly assumes one is a claim dressed as a
 * tool. What the product does is show which invoices are holding the number
 * up; the link at the end goes to the sandbox where that can be tried.
 *
 *   cash tied up          billing × DSO / 30
 *   freed at target DSO   billing × (DSO − target) / 30
 *   carrying cost / year  freed × cost of capital
 *   time on invoices      invoices × minutes / 60 × 12 hours a year, × ₹/hour
 */
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { inr } from './demoData'
import RollNumber from './motion/RollNumber'

function Range({ label, value, set, min, max, step, show, ticks }) {
  const id = useId()
  return (
    <div className="ft-f-range">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id}>{show(value)}</output>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => set(Number(e.target.value))} />
      <span className="ft-f-ticks-row" aria-hidden="true">{ticks.map(t => <span key={t}>{t}</span>)}</span>
    </div>
  )
}

const num = (n) => Math.round(n).toLocaleString('en-IN')

export default function RoiCalculator() {
  const [billing, setBilling] = useState(2500000)
  const [dso, setDso] = useState(48)
  const [target, setTarget] = useState(35)
  const [rate, setRate] = useState(12)
  const [invoices, setInvoices] = useState(40)
  const [minutes, setMinutes] = useState(20)
  const [perHour, setPerHour] = useState(800)

  const goal = Math.min(target, dso)
  const tied = (billing * dso) / 30
  const freed = (billing * (dso - goal)) / 30
  const carrying = freed * (rate / 100)
  const hours = (invoices * minutes * 12) / 60
  const timeCost = hours * perHour

  // One sentence for screen readers, once the inputs have been still for half
  // a second: the figures above roll through every value in between, and a
  // live region over them would read out each one.
  const summary = `Cash waiting in receivables ${inr(Math.round(tied))}. Freed if you reach ${goal} days ${inr(Math.round(freed))}. ` +
    `Carrying that costs ${inr(Math.round(carrying))} a year. Time on invoices ${num(hours)} hours a year.`
  const [spoken, setSpoken] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched) return
    const t = setTimeout(() => setSpoken(summary), 500)
    return () => clearTimeout(t)
  }, [summary, touched])

  return (
    <div className="ft-f-roi">
      <div className="ft-f-roi-inputs" onChange={() => setTouched(true)}>
        <p className="ft-f-kicker">Your assumptions</p>
        <div className="ft-f-roi-grid">
          <Range label="Billed per month" value={billing} set={setBilling} min={200000} max={20000000} step={100000}
                 show={inr} ticks={['₹2L', '₹1Cr', '₹2Cr']} />
          <Range label="Cost of capital" value={rate} set={setRate} min={6} max={24} step={0.5}
                 show={(v) => `${v}% a year`} ticks={['6%', '15%', '24%']} />
          <Range label="Days to collect today" value={dso} set={setDso} min={10} max={120} step={1}
                 show={(v) => `${v} days`} ticks={['10 d', '65 d', '120 d']} />
          <Range label="Days to collect you aim for" value={target} set={setTarget} min={7} max={120} step={1}
                 show={(v) => `${v} days`} ticks={['7 d', '60 d', '120 d']} />
          <Range label="Invoices per month" value={invoices} set={setInvoices} min={5} max={500} step={5}
                 show={num} ticks={['5', '250', '500']} />
          <Range label="Minutes chasing each one" value={minutes} set={setMinutes} min={0} max={120} step={5}
                 show={(v) => `${v} min`} ticks={['0', '60', '120']} />
          <Range label="Cost of an hour" value={perHour} set={setPerHour} min={200} max={5000} step={50}
                 show={inr} ticks={['₹200', '₹2,600', '₹5,000']} />
        </div>
      </div>

      <p className="sr-only" role="status">{spoken}</p>
      <div className="ft-f-roi-out">
        <div className="ft-f-roi-lead">
          <p className="ft-f-kicker">Cash waiting in receivables</p>
          <p className="ft-f-big"><RollNumber value={Math.round(tied)} format={inr} align="start" /></p>
          <p className="mt-0.5 mb-3 text-[12px] text-[var(--text-3)] tabular-nums">{inr(billing)} a month × {dso} days ÷ 30</p>
          <div className="ft-f-roi-days" aria-hidden="true">
            <span className="ft-f-roi-day" data-k="now" style={{ '--s': Math.min(1, dso / 120) }} />
            <span className="ft-f-roi-day" data-k="goal" style={{ '--s': Math.min(1, goal / 120) }} />
          </div>
          <p className="ft-f-roi-legend flex flex-wrap gap-x-3 gap-y-1 mt-2 mb-0 text-[11.5px] text-[var(--text-3)]">
            <span><i data-k="now" /> {dso} days today</span>
            <span><i data-k="goal" /> {goal} days aimed for</span>
          </p>
        </div>

        <dl className="ft-f-roi-figs">
          <div>
            <dt className="text-[11.5px] font-semibold text-[var(--text-3)]">Freed if you reach {goal} days</dt>
            <dd><RollNumber value={Math.round(freed)} format={inr} align="start" /></dd>
            <dd className="ft-f-roi-note">{inr(billing)} × ({dso} − {goal}) ÷ 30</dd>
          </div>
          <div>
            <dt className="text-[11.5px] font-semibold text-[var(--text-3)]">What carrying that costs a year</dt>
            <dd><RollNumber value={Math.round(carrying)} format={inr} align="start" /></dd>
            <dd className="ft-f-roi-note">at {rate}% a year</dd>
          </div>
          <div>
            <dt className="text-[11.5px] font-semibold text-[var(--text-3)]">Time on invoices a year</dt>
            <dd><RollNumber value={Math.round(hours)} format={(n) => `${num(n)} h`} align="start" /></dd>
            <dd className="ft-f-roi-note">{inr(timeCost)} at {inr(perHour)} an hour</dd>
          </div>
        </dl>

        <p className="ft-f-foot">
          Arithmetic on your inputs, not a promise. FinTrack shows which invoices hold the figure up:
          the ageing bands, who owes what, and what is withheld as TDS rather than owed.
        </p>
        <Link to="/#try" className="ft-f-link">
          Try the ageing bands in the sandbox <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
