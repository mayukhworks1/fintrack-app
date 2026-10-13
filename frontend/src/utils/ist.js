// Page expiry is set and shown in India Standard Time, whatever timezone the
// author's browser is in. IST has no daylight saving, so a fixed +05:30 offset
// is exact all year.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
const pad = (n) => String(n).padStart(2, '0')

// ISO instant -> "YYYY-MM-DDTHH:mm" in IST, the value a datetime-local input takes.
export function toIstInput(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const d = new Date(t + IST_OFFSET_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

// "YYYY-MM-DDTHH:mm" read as IST -> ISO string with the +05:30 offset.
export function fromIstInput(value) {
  if (!value) return ''
  return `${value.length === 16 ? value + ':00' : value}+05:30`
}

// "20 Oct 2026, 6:00 pm IST"
export function formatIst(iso) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return t.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' IST'
}

// Milliseconds left until `iso`, negative once it has passed.
export function msUntil(iso, now = Date.now()) {
  return new Date(iso).getTime() - now
}

// "2d 4h left", "3h 12m left", "45m left", "Expired"
export function countdown(iso, now = Date.now()) {
  const ms = msUntil(iso, now)
  if (!(ms > 0)) return 'Expired'
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  if (d) return `${d}d ${h}h left`
  if (h) return `${h}h ${mm}m left`
  return `${Math.max(mm, 1)}m left`
}

// Quick choices for the expiry field, as ISO strings.
export function expiryPreset(kind, now = Date.now()) {
  if (kind === 'eod') {
    // 11:59 pm today, IST
    const ist = new Date(now + IST_OFFSET_MS)
    const day = `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`
    return `${day}T23:59:00+05:30`
  }
  const hours = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 }[kind]
  return hours ? new Date(now + hours * 3600_000).toISOString() : ''
}
