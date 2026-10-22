/**
 * A progress rail for a step story: numbered dots joined by a line that fills
 * up to the step being read.
 *
 *   const { active, stepRef, tracking } = useActiveStep(4)
 *   <StepRail count={4} active={active} labels={['Read', 'Mirror', 'Ask', 'Check']} />
 *
 * The fill is a transform (scaleY, or scaleX when horizontal) over
 * --m-t-medium. Under reduced motion nothing fills and every step reads as
 * current, matching useActiveStep, which stops tracking there. It is a
 * picture of where you are, so it is aria-hidden: the steps themselves are
 * the content a screen reader walks.
 */
import { useReducedMotion } from '../../hooks/useReducedMotion'

export default function StepRail({
  count, active = 0, labels = [], orientation = 'vertical', className = '', style,
}) {
  const reduced = useReducedMotion()
  const n = Math.max(1, count | 0)
  const at = Math.min(Math.max(0, active | 0), n - 1)
  const progress = reduced || n === 1 ? 1 : at / (n - 1)

  return (
    <div
      className={`ft-m-rail ${className}`.trim()}
      data-orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
      data-still={reduced ? '' : undefined}
      aria-hidden="true"
      style={{ '--rail-p': progress, ...style }}
    >
      <span className="ft-m-rail-line" />
      <span className="ft-m-rail-fill" />
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="ft-m-rail-step"
            data-on={reduced || i <= at ? '' : undefined}
            data-current={reduced || i === at ? '' : undefined}>
          <span className="ft-m-rail-dot">{i + 1}</span>
          {labels[i] && <span className="ft-m-rail-label">{labels[i]}</span>}
        </div>
      ))}
    </div>
  )
}
