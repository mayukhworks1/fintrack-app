/**
 * The hero aside on /how-it-works: five minutes of the mirror's life.
 *
 * Three routes keep the Postgres mirror current, and each has its own rhythm
 * (backend/app/db/sync.py): a webhook whenever a record changes, an
 * incremental pass every 30 seconds, and a full pass every 5 minutes that
 * also notices deletions. Written as a sentence those are three numbers; laid
 * on one time axis they are a picture of why the mirror is never far behind.
 *
 * The webhook dots sit at invented moments — a webhook fires when someone
 * edits a record, which has no schedule — and the card says it is an
 * illustration. The two passes are drawn at their real interval.
 *
 * It draws once when the page opens and then holds still. Under reduced
 * motion it is simply drawn.
 */
const SPAN = 300          // seconds on the axis
const W = 300             // track width in viewBox units
const x = (s) => (s / SPAN) * W

// Illustrative edits. There is no schedule to a webhook; these only show that
// changes arrive between the passes rather than on them.
const EDITS = [22, 58, 71, 148, 203, 262]
const TICKS = Array.from({ length: SPAN / 30 }, (_, i) => (i + 1) * 30)

function Track({ children }) {
  return (
    <svg viewBox={`-6 0 ${W + 12} 28`} className="ft-s-cad-track" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

export default function SyncCadence() {
  return (
    <figure className="ft-s-cad">
      <div className="ft-s-cad-head">
        <span className="ft-s-cad-title">Sync cadence</span>
        <span className="ft-s-cad-note">Five minutes, illustrated</span>
      </div>

      <div className="ft-s-cad-row">
        <div className="ft-s-cad-label"><b>Webhook</b><span>on each change</span></div>
        <Track>
          <path d={`M0 14 H${W}`} pathLength="1" className="ft-s-cad-base ft-m-draw" />
          {EDITS.map((s, i) => (
            <circle key={s} cx={x(s)} cy="14" r="4.5" className="ft-s-cad-dot ft-m-pop"
                    style={{ '--d': `${380 + i * 90}ms` }} />
          ))}
        </Track>
      </div>

      <div className="ft-s-cad-row">
        <div className="ft-s-cad-label"><b>Incremental</b><span>every 30 s</span></div>
        <Track>
          <path d={`M0 14 H${W}`} pathLength="1" className="ft-s-cad-base ft-m-draw" style={{ '--d': '120ms' }} />
          {TICKS.map((s, i) => (
            <path key={s} d={`M${x(s)} 6 V22`} pathLength="1" className="ft-s-cad-tick ft-m-draw"
                  style={{ '--d': `${300 + i * 60}ms` }} />
          ))}
        </Track>
      </div>

      <div className="ft-s-cad-row">
        <div className="ft-s-cad-label"><b>Full pass</b><span>every 5 min</span></div>
        <Track>
          <path d={`M0 22 V8 H${W} V22`} pathLength="1" className="ft-s-cad-span ft-m-draw" style={{ '--d': '240ms' }} />
          <circle cx={W} cy="8" r="5" className="ft-s-cad-full ft-m-pop" style={{ '--d': '1100ms' }} />
        </Track>
      </div>

      <div className="ft-s-cad-axis" aria-hidden="true"><span>0:00</span><span>2:30</span><span>5:00</span></div>

      <figcaption className="ft-s-cad-cap">
        All three routes call the same upsert, and a copy older than the one
        already stored is left alone — so whichever arrives first, the row ends
        up the same.
      </figcaption>
    </figure>
  )
}
