/**
 * Centralised number/currency formatters.
 *
 * Design goal: show EXACT digits. No "12.5L" / "2.1Cr" shorthand — ever.
 * Indian grouping (12,34,567) is applied via toLocaleString('en-IN').
 * Fractional rupees (paise) are only rendered when non-zero so we don't
 * show "1200.00" for a whole number, but "1,234.50" for the odd case.
 */

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n)

export function formatInr(n, opts = {}) {
  const { showZero = true, showFraction = 'auto', prefix = '₹' } = opts
  const v = Number(n)
  if (!isFiniteNum(v)) return showZero ? `${prefix}0` : '—'
  if (v === 0 && !showZero) return '—'

  const abs = Math.abs(v)
  const frac = abs - Math.floor(abs)
  const shouldShowFrac =
    showFraction === true ||
    (showFraction === 'auto' && frac > 0.0001)

  const digits = shouldShowFrac ? 2 : 0
  const s = v.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${prefix}${s}`
}

/** Plain integer with Indian grouping, e.g. 12,34,567 */
export function formatInt(n) {
  const v = Number(n)
  if (!isFiniteNum(v)) return '0'
  return v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

/** Percentage with up to 2 decimals, trimmed. */
export function formatPct(n, digits = 2) {
  const v = Number(n)
  if (!isFiniteNum(v)) return '0%'
  // strip trailing zeros after decimal
  const s = v.toFixed(digits).replace(/\.?0+$/, '')
  return `${s}%`
}
