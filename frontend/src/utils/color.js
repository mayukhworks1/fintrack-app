// "#3b82f6", 0.1 -> "rgba(59,130,246,0.1)". A six-digit hex is converted
// directly; anything else (a palette token such as "var(--chart-1)", or a
// named colour) is mixed with transparent in CSS, so callers can pass tokens
// and still get a translucent tint that follows the palette.
export function hexToRgba(hex, a) {
  if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
    return `rgba(${r},${g},${b},${a})`
  }
  const pct = Math.round(Math.max(0, Math.min(1, Number(a) || 0)) * 1000) / 10
  return `color-mix(in srgb, ${hex} ${pct}%, transparent)`
}

// Same as hexToRgba, named for what it does with tokens.
export const tint = hexToRgba
