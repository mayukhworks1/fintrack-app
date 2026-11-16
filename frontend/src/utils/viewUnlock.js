// Unlock tokens for password-protected shared view links. The server signs
// each one over the link and its password version and lets it live a few
// hours; this tab keeps it so a refresh does not ask for the password again.
// Storage can be unavailable (private mode, blocked site data): then the
// visitor simply enters the password again.
const KEY = 'ft-view-unlock:'

export function getViewUnlock(token) {
  if (!token) return ''
  try { return sessionStorage.getItem(KEY + token) || '' } catch { return '' }
}

export function setViewUnlock(token, value) {
  try {
    if (value) sessionStorage.setItem(KEY + token, value)
    else sessionStorage.removeItem(KEY + token)
  } catch { /* storage unavailable */ }
}

export function viewUnlockHeader(token) {
  const t = getViewUnlock(token)
  return t ? { 'X-View-Token': t } : undefined
}

// A strong random password for a share link: 4 groups of 5 characters from an
// alphabet without look-alikes (no 0/O, 1/l/I), about 113 bits.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

export function generateSharePassword(groups = 4, size = 5) {
  const n = groups * size
  const out = []
  const buf = new Uint32Array(n)
  // Rejection sampling keeps every character equally likely.
  const limit = Math.floor(0x100000000 / ALPHABET.length) * ALPHABET.length
  while (out.length < n) {
    globalThis.crypto.getRandomValues(buf)
    for (const v of buf) {
      if (v < limit && out.length < n) out.push(ALPHABET[v % ALPHABET.length])
    }
  }
  const chunks = []
  for (let g = 0; g < groups; g++) chunks.push(out.slice(g * size, (g + 1) * size).join(''))
  return chunks.join('-')
}

// The same strict address check the server makes (services/share_access.py).
const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

export function isValidDomain(raw) {
  const d = String(raw || '').trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '')
  if (!d || d.length > 253) return false
  const labels = d.split('.')
  return labels.length >= 2 && labels.every(l => LABEL.test(l)) && TLD.test(labels[labels.length - 1])
}

export function emailError(raw) {
  const email = String(raw || '').trim()
  const msg = 'Enter a valid email address, like name@company.com'
  if (!email) return 'Enter your email address'
  if (email.length > 254 || /[\s\x00-\x1f\x7f]/.test(email)) return msg
  const parts = email.split('@')
  if (parts.length !== 2) return msg
  const [local, domain] = parts
  if (!local || local.length > 64 || !LOCAL.test(local)) return msg
  if (!isValidDomain(domain)) return msg
  return ''
}

export function parseDomains(text) {
  const items = String(text || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)
  return [...new Set(items)]
}
