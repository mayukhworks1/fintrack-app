/**
 * Device Info Collector
 * ─────────────────────
 * Gathers every device signal a browser is willing to expose, then encodes
 * it as a compact JSON payload sent on every API request via the
 * `X-Client-Hint` header.
 *
 * We CANNOT get the OS hostname (e.g. "Mayukh's MacBook") — every browser
 * engine blocks that for privacy.  What we collect:
 *
 *   • UA Client Hints (Chromium only): platform, platformVersion, model,
 *     arch, bitness, uaFullVersion — the modern, structured replacement
 *     for the legacy User-Agent string.
 *   • navigator.platform (legacy, e.g. "MacIntel", "Win32") — still useful
 *     as a fallback for non-Chromium browsers.
 *   • CPU cores (navigator.hardwareConcurrency)
 *   • RAM in GB (navigator.deviceMemory — Chromium only)
 *   • GPU renderer (via WebGL UNMASKED_RENDERER_WEBGL extension)
 *   • Screen geometry + devicePixelRatio
 *   • Timezone + language (Intl)
 *   • Network type (navigator.connection.effectiveType)
 *   • Touch capability (navigator.maxTouchPoints)
 *
 * The collection is cached for the session — we compute once on first
 * call and reuse, since none of these signals change mid-session and we
 * don't want to thrash the GPU canvas on every fetch.
 */

let _cached = null
let _cachedPromise = null

function _safeGetGPU() {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (!gl) return null
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return null
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || null
    const vendor   = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || null
    // Many GPUs report as "ANGLE (NVIDIA, GeForce RTX...)" — strip the prefix
    if (typeof renderer === 'string') {
      const m = renderer.match(/ANGLE\s*\(([^)]+)\)/i)
      if (m) return m[1].trim()
    }
    return renderer || vendor
  } catch { return null }
}

async function _collect() {
  const nav = navigator || {}

  // ── Modern UA Client Hints (Chromium / Edge) ──
  let ch = null
  if (nav.userAgentData) {
    try {
      const high = await nav.userAgentData.getHighEntropyValues([
        'platform', 'platformVersion', 'model',
        'architecture', 'bitness', 'uaFullVersion', 'wow64',
      ])
      ch = {
        platform:        high.platform || null,
        platformVersion: high.platformVersion || null,
        model:           high.model || null,
        arch:            high.architecture || null,
        bitness:         high.bitness || null,
        fullVersion:     high.uaFullVersion || null,
        mobile:          !!nav.userAgentData.mobile,
      }
    } catch { /* not supported or blocked */ }
  }

  // ── Screen ──
  const scr = window.screen || {}
  const screenStr = scr.width && scr.height
    ? `${scr.width}x${scr.height}${window.devicePixelRatio > 1 ? `@${window.devicePixelRatio}x` : ''}`
    : null

  // ── Locale / TZ ──
  let tz = null, locale = null
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions()
    tz = opts.timeZone || null
    locale = opts.locale || null
  } catch {}

  // ── Network ──
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection
  const network = conn ? (conn.effectiveType || conn.type || null) : null
  const downlink = conn?.downlink || null

  // ── GPU ──
  const gpu = _safeGetGPU()

  return {
    // UA Client Hints (or null if unsupported)
    ch,
    // Legacy / universal
    platform:    nav.platform || null,
    language:    nav.language || (nav.languages && nav.languages[0]) || null,
    locale,
    timezone:    tz,
    cores:       typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    memoryGb:    typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    touchPoints: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : null,
    cookieEnabled: !!nav.cookieEnabled,
    onLine:      typeof nav.onLine === 'boolean' ? nav.onLine : null,
    screen:      screenStr,
    colorDepth:  typeof scr.colorDepth === 'number' ? scr.colorDepth : null,
    viewport:    window.innerWidth && window.innerHeight ? `${window.innerWidth}x${window.innerHeight}` : null,
    gpu,
    network,
    downlinkMbps: downlink,
  }
}

/**
 * Returns the device-info JSON encoded as base64 (URL-safe) for header transport.
 * Async because UA Client Hints high-entropy resolution is async, but the
 * result is cached so subsequent calls are synchronous-fast.
 */
export async function getDeviceHintHeader() {
  if (_cached) return _cached
  if (_cachedPromise) return _cachedPromise
  _cachedPromise = (async () => {
    try {
      const info = await _collect()
      const json = JSON.stringify(info)
      // Base64-URL encoding for safe header transport
      const b64 = typeof btoa === 'function'
        ? btoa(unescape(encodeURIComponent(json)))
        : Buffer.from(json, 'utf-8').toString('base64')
      _cached = b64
      return b64
    } catch {
      _cached = ''
      return ''
    } finally {
      _cachedPromise = null
    }
  })()
  return _cachedPromise
}

/** For local diagnostics — returns the decoded object */
export async function getDeviceInfo() { return _collect() }
