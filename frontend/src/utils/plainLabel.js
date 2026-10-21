/**
 * Display form of a stored label. Some records carry an emoji prefix in
 * their value (status and health options such as "🟢 Active"); the value is
 * kept as stored for filters and writes, and only the text is shown.
 */
const PICTO = /(?![©®™])[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]|[️‍⃣]/gu

export function plainLabel(value) {
  if (value == null) return ''
  return String(value).replace(PICTO, '').replace(/\s{2,}/g, ' ').trim()
}
