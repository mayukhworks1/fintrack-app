/**
 * Tax ledger: how one month's billing splits once GST and TDS are applied.
 *
 * At a pre-tax billing B, with GST rate g and TDS rate t:
 *
 *   invoice total            B × (1 + g)
 *   GST, held for the state  B × g
 *   TDS, withheld at source  B × t      (the client deducts it; it is a tax
 *                                          credit, not money still owed)
 *   cash the client pays     B × (1 + g − t)
 *   yours                    B × (1 − t)
 *
 * The bar is the invoice total cut into those three parts. Each part is a
 * full-width layer moved and scaled by transform, so a slider change slides
 * the boundaries instead of resizing boxes. Figures roll on change, and
 * under reduced motion they simply change.
 */
import { useState } from 'react'
import { inr } from './demoData'
import RollNumber from './motion/RollNumber'

const KINDS = [
  { id: 'services', label: 'Professional services', sub: '18% GST · 10% TDS (194J)', gst: 0.18, tds: 0.10 },
  { id: 'works',    label: 'Contract work',         sub: '18% GST · 2% TDS (194C)',  gst: 0.18, tds: 0.02 },
  { id: 'export',   label: 'Zero-rated export',     sub: '0% GST · no TDS',          gst: 0,    tds: 0 },
]

export default function TaxFlowSimulator() {
  const [billed, setBilled] = useState(1000000)
  const [kind, setKind] = useState(KINDS[0])
  const g = kind.gst, t = kind.tds

  const total = billed * (1 + g)
  const gst = billed * g
  const tds = billed * t
  const yours = billed * (1 - t)
  const cash = billed * (1 + g - t)
  // shares of the invoice total, left to right: yours | TDS | GST
  const a = yours / total, b = tds / total, c = gst / total

  return (
    <div className="ft-f-demo ft-f-tax">
      <div className="ft-f-tax-controls">
        <div role="group" aria-label="Kind of work" className="ft-f-tax-kinds">
          {KINDS.map(k => (
            <button key={k.id} type="button" aria-pressed={k.id === kind.id} onClick={() => setKind(k)}>
              <b className="text-[12.5px]">{k.label}</b><span className="text-[11px] text-[var(--text-3)]">{k.sub}</span>
            </button>
          ))}
        </div>
        <div className="ft-f-range">
          <label htmlFor="taxflow-billed">Billed this month, before tax</label>
          <output htmlFor="taxflow-billed">{inr(billed)}</output>
          <input id="taxflow-billed" type="range" min={100000} max={5000000} step={50000}
                 value={billed} onChange={(e) => setBilled(Number(e.target.value))} />
        </div>
      </div>

      <dl className="ft-f-tax-figs" data-row="lead">
        <div><dt className="text-[11.5px] text-[var(--text-3)]">Invoice total</dt><dd><RollNumber value={Math.round(total)} format={inr} align="start" /></dd></div>
        <div><dt className="text-[11.5px] text-[var(--text-3)]">Cash the client pays</dt><dd><RollNumber value={Math.round(cash)} format={inr} align="start" /></dd></div>
      </dl>
      <div className="ft-f-split" aria-hidden="true">
        <span className="ft-f-seg-layer" data-k="yours" style={{ '--a': 0, '--w': a }} />
        <span className="ft-f-seg-layer" data-k="tds" style={{ '--a': a, '--w': b }} />
        <span className="ft-f-seg-layer" data-k="gst" style={{ '--a': a + b, '--w': c }} />
      </div>

      <dl className="ft-f-tax-figs">
        <div data-k="yours"><dt className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-3)]"><i />Yours</dt><dd><RollNumber value={Math.round(yours)} format={inr} align="start" /></dd></div>
        <div data-k="tds"><dt className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-3)]"><i />TDS withheld at source</dt><dd><RollNumber value={Math.round(tds)} format={inr} align="start" /></dd></div>
        <div data-k="gst"><dt className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-3)]"><i />GST, for the government</dt><dd><RollNumber value={Math.round(gst)} format={inr} align="start" /></dd></div>
      </dl>
      <p className="ft-f-foot">
        Sample figures. TDS is a credit against your income tax, not money a client still owes,
        which is why the ledger never counts it as outstanding.
      </p>
    </div>
  )
}
