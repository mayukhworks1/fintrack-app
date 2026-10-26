// Embeds are framed third-party pages, so only a short list of providers is
// accepted, and the frame URL is always rebuilt from the original link here —
// never taken from stored content. A document whose JSON was edited by hand to
// point an embed somewhere else therefore renders a plain link, not a frame.

const YT_ID = /^[A-Za-z0-9_-]{6,20}$/
const SAFE_ID = /^[A-Za-z0-9_-]{6,120}$/

function parse(raw) {
  if (!raw || typeof raw !== 'string') return null
  let s = raw.trim()
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u
  } catch {
    return null
  }
}

const host = (u) => u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '')

const PROVIDERS = [
  {
    id: 'youtube', label: 'YouTube', ratio: '16 / 9',
    match(u) {
      const h = host(u)
      let id = null
      if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0]
      else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
        if (u.pathname === '/watch') id = u.searchParams.get('v')
        else {
          const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/)
          if (m) id = m[1]
        }
      }
      if (!id || !YT_ID.test(id)) return null
      return `https://www.youtube-nocookie.com/embed/${id}`
    },
  },
  {
    id: 'loom', label: 'Loom', ratio: '16 / 9',
    match(u) {
      if (host(u) !== 'loom.com') return null
      const m = u.pathname.match(/^\/(?:share|embed)\/([^/?#]+)/)
      if (!m || !SAFE_ID.test(m[1])) return null
      return `https://www.loom.com/embed/${m[1]}`
    },
  },
  {
    id: 'figma', label: 'Figma', ratio: '4 / 3',
    match(u) {
      if (host(u) !== 'figma.com') return null
      if (!/^\/(?:file|design|proto|board|slides)\/[A-Za-z0-9]+/.test(u.pathname)) return null
      const clean = `https://www.figma.com${u.pathname}${u.search}`
      return `https://www.figma.com/embed?embed_host=fintrack&url=${encodeURIComponent(clean)}`
    },
  },
  {
    id: 'gdocs', label: 'Google Docs', height: 640,
    match(u) {
      if (host(u) !== 'docs.google.com') return null
      const m = u.pathname.match(/^\/document\/d\/([^/?#]+)/)
      if (!m || !SAFE_ID.test(m[1])) return null
      return `https://docs.google.com/document/d/${m[1]}/preview`
    },
  },
  {
    id: 'gsheets', label: 'Google Sheets', height: 560,
    match(u) {
      if (host(u) !== 'docs.google.com') return null
      const m = u.pathname.match(/^\/spreadsheets\/d\/([^/?#]+)/)
      if (!m || !SAFE_ID.test(m[1])) return null
      return `https://docs.google.com/spreadsheets/d/${m[1]}/preview`
    },
  },
  {
    id: 'gslides', label: 'Google Slides', ratio: '16 / 9.6',
    match(u) {
      if (host(u) !== 'docs.google.com') return null
      const m = u.pathname.match(/^\/presentation\/d\/([^/?#]+)/)
      if (!m || !SAFE_ID.test(m[1])) return null
      return `https://docs.google.com/presentation/d/${m[1]}/embed`
    },
  },
]

/** { provider, label, src, ratio?, height? } for an allowed link, else null. */
export function resolveEmbed(raw) {
  const u = parse(raw)
  if (!u) return null
  for (const p of PROVIDERS) {
    const src = p.match(u)
    if (src) return { provider: p.id, label: p.label, src, ratio: p.ratio, height: p.height }
  }
  return null
}

export const EMBED_PROVIDERS = PROVIDERS.map(p => p.label)

/** Sandbox for embed frames: enough for players and viewers, no top navigation. */
export const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms'

/** A link the document may point at: http(s), mailto, tel, or a same-site path. */
export function safeHref(url) {
  if (!url || typeof url !== 'string') return null
  const s = url.trim()
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s
  if (s.startsWith('/') && !s.startsWith('//')) return s
  if (s.startsWith('#')) return s
  return null
}

/** An image source the document may load: http(s), or a backend asset path. */
export function safeImageSrc(url) {
  if (!url || typeof url !== 'string') return null
  const s = url.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('/api/')) return s
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s)) return s
  return null
}
