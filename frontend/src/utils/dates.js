// Date formatters and link-expiry helpers shared across pages.

// "12 Mar 2026"
export function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return String(iso).slice(0, 10) }
}

// "12 Mar 2026, 4:05 pm"
export function fmtDateTime(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return String(iso) }
}

// Same output as fmtDateTime; on failure it hands back the value unchanged.
export function ts(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return v }
}

/** A Date for an ISO string, or null when it is empty or unparseable. */
export function parseDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d) ? null : d
}

export function isExpired(iso) { return iso ? new Date(iso) < new Date() : false }

// Share-link expiry presets, in hours. 0 means the link never expires.
export const EXPIRY_OPTS = [
  { label: 'Never',    value: 0   },
  { label: '1 hour',   value: 1   },
  { label: '24 hours', value: 24  },
  { label: '3 days',   value: 72  },
  { label: '7 days',   value: 168 },
  { label: '30 days',  value: 720 },
]
