// "#3b82f6", 0.1 -> "rgba(59,130,246,0.1)". Expects a six-digit hex colour.
export function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}
