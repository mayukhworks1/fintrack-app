// Presence helpers: who is editing, in which colour, and document comparison.

// Same palette the server assigns from; the server's choice wins on the wire.
export const PRESENCE_COLORS = ['#2383e2', '#d9730d', '#0f7b6c', '#9065b0', '#e03e3e', '#c14c8a', '#64473a', '#dfab01', '#4d6461', '#337ea9']

export function colorFor(seed) {
  let h = 0
  for (const ch of String(seed || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length]
}

export function displayName(user) {
  if (!user) return 'You'
  const full = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ')
  return (full || user.name || user.email || 'You').trim().slice(0, 60)
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = [...parts[0]][0] || '?'
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] : ''
  return (first + last).toUpperCase()
}

/** Distinct remote editors from an awareness instance (one entry per person,
 *  however many tabs they have open). */
export function peersOf(awareness, selfId) {
  const seen = new Map()
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === selfId || !state?.user?.name) return
    const key = `${state.user.name}|${state.user.color}`
    if (!seen.has(key)) seen.set(key, { clientId, name: state.user.name, color: state.user.color })
  })
  return [...seen.values()]
}

/** Documents compared by meaning: null attrs and empty attrs/marks/content
 *  dropped, keys and marks sorted. Mirrors the server's canonical(). */
export function canonicalDoc(doc) {
  let d = doc
  if (typeof d === 'string') {
    try { d = d.trim() ? JSON.parse(d) : null } catch { d = null }
  }
  const walk = (n) => {
    if (Array.isArray(n)) return n.map(walk)
    if (n && typeof n === 'object') {
      const out = {}
      for (const k of Object.keys(n).sort()) {
        const v = n[k]
        if (v === null || v === undefined) continue
        const w = walk(v)
        if ((k === 'attrs' || k === 'marks' || k === 'content') && (Array.isArray(w) ? !w.length : !Object.keys(w).length)) continue
        out[k] = k === 'marks' && Array.isArray(w) ? [...w].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)) : w
      }
      return out
    }
    return n
  }
  return JSON.stringify(walk(d || {}))
}

/** The same document, ignoring a trailing empty paragraph (the editor adds
 *  one; the server seeds one). */
export function sameDoc(a, b) {
  const strip = (doc) => {
    let d = doc
    if (typeof d === 'string') { try { d = d.trim() ? JSON.parse(d) : { type: 'doc', content: [] } } catch { return d } }
    const content = [...(d?.content || [])]
    while (content.length && content[content.length - 1]?.type === 'paragraph' && !(content[content.length - 1].content || []).length) content.pop()
    return { ...d, content }
  }
  return canonicalDoc(strip(a)) === canonicalDoc(strip(b))
}
