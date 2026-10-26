// Colour names the document may store. Marks and callouts keep only the name;
// the actual colours come from CSS variables (blocks.css), so a document reads
// correctly in light and dark mode and no style attribute is ever written
// from stored content.
export const COLORS = [
  { key: 'gray', label: 'Gray' },
  { key: 'brown', label: 'Brown' },
  { key: 'orange', label: 'Orange' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'green', label: 'Green' },
  { key: 'blue', label: 'Blue' },
  { key: 'purple', label: 'Purple' },
  { key: 'pink', label: 'Pink' },
  { key: 'red', label: 'Red' },
]
const KEYS = new Set(COLORS.map(c => c.key))
export const colorKey = (v) => (v && KEYS.has(String(v)) ? String(v) : null)

export const CALLOUT_TONES = [
  { key: 'default', label: 'Gray' },
  { key: 'blue', label: 'Blue' },
  { key: 'green', label: 'Green' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'red', label: 'Red' },
  { key: 'purple', label: 'Purple' },
]
const TONES = new Set(CALLOUT_TONES.map(t => t.key))
export const toneKey = (v) => (v && TONES.has(String(v)) ? String(v) : 'default')

export const CALLOUT_ICONS = ['💡', 'ℹ️', '⚠️', '✅', '❗', '📌', '🔥', '🚫', '📝', '🎯']
/** A callout icon is shown as text; keep it to a short emoji-sized string. */
export const calloutIcon = (v) => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s && [...s].length <= 4 ? s : '💡'
}
