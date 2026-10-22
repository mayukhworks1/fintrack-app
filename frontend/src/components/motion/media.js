/**
 * Every image and video the public pages show, with its intrinsic size.
 *
 * This is the single source of `src`, `width` and `height` for product media.
 * A screenshot rendered without its real dimensions reserves no space and
 * shoves the page down when it arrives, so nothing reads a path or a size
 * from anywhere else.
 *
 * The captures are of the sample workspace (invented clients and figures),
 * taken in the light theme at 1600px wide with an 800px copy beside each.
 *
 *   screen('sheet') → { src, srcSm, w, h, smW }
 *   VIDEOS['sheet-demo'] → { webm, mp4, poster, w, h, seconds }
 *
 * Three screens also carry a 240px `thumb`, for the features hero's card
 * stack, where they are shown 120px wide: the 800px copy is six times what
 * that needs.
 *
 * Do not show the full `page-insights` capture on a public page: its views
 * table lists IP addresses and network providers. `page-insights-charts` is
 * the same screen cropped to the charts.
 */

const OLD = { w: 1600, h: 1031, smW: 800 }   // captures from the first round
const NEW = { w: 1600, h: 1000, smW: 800 }   // spreadsheet, link and gateway captures

export const SCREENS = {
  dashboard: OLD,
  invoices: OLD,
  projects: OLD,
  status: OLD,
  assistant: OLD,
  tax: OLD,
  analytics: OLD,
  studio: OLD,
  pages: OLD,
  sheet: { ...NEW, thumb: '/media/derived/sheet-thumb.webp', thumbW: 240 },
  'sheet-public': NEW,
  gateway: { ...NEW, thumb: '/media/derived/gateway-thumb.webp', thumbW: 240 },
  'gateway-providers': NEW,
  'page-insights': NEW,
  'page-insights-charts': {
    w: 1300, h: 765, smW: 800,
    src: '/media/derived/page-insights-charts.webp',
    srcSm: '/media/derived/page-insights-charts-sm.webp',
  },
  'link-preview': {
    w: 1200, h: 630, smW: 600,
    src: '/media/derived/link-preview-invoice-tracker.webp',
    srcSm: '/media/derived/link-preview-invoice-tracker-sm.webp',
    thumb: '/media/derived/link-preview-invoice-tracker-thumb.webp', thumbW: 240,
  },
}

export const VIDEOS = {
  'sheet-demo': {
    webm: '/media/sheet-demo.webm', mp4: '/media/sheet-demo.mp4',
    poster: '/media/sheet-demo-poster.webp', w: 1280, h: 800, seconds: 8.84,
  },
  film: {
    mp4: '/media/fintrack-film.mp4', mp4Small: '/media/derived/fintrack-film-720.mp4',
    poster: '/media/derived/film-poster.webp', w: 1920, h: 1080, seconds: 28.5,
  },
  // The three decorative portrait loops behind LoopVideo. Posters are their
  // first frame, so a loop that has not started shows what it will start as.
  'loop-5': {
    webm: '/media/pomelli_photoshoot-5.webm', mp4: '/media/pomelli_photoshoot-5.mp4',
    poster: '/media/derived/pomelli_photoshoot-5-poster.webp', w: 720, h: 1280, seconds: 8,
  },
  'loop-6': {
    webm: '/media/pomelli_photoshoot-6.webm', mp4: '/media/pomelli_photoshoot-6.mp4',
    poster: '/media/derived/pomelli_photoshoot-6-poster.webp', w: 720, h: 1280, seconds: 8,
  },
  'loop-7': {
    webm: '/media/pomelli_photoshoot-7.webm', mp4: '/media/pomelli_photoshoot-7.mp4',
    poster: '/media/derived/pomelli_photoshoot-7-poster.webp', w: 720, h: 1280, seconds: 8,
  },
}

/** Resolve a screen id to its files and size. Throws on an unknown id. */
export function screen(id) {
  const s = SCREENS[id]
  if (!s) throw new Error(`Unknown screen "${id}"`)
  return {
    src: s.src || `/media/screens/${id}.webp`,
    srcSm: s.srcSm || `/media/screens/${id}-sm.webp`,
    w: s.w,
    h: s.h,
    smW: s.smW || 800,
    thumb: s.thumb || null,
    thumbW: s.thumbW || null,
  }
}

/** The video entry whose mp4 or webm is `src`, if it is registered. */
export function videoForSrc(src) {
  return Object.values(VIDEOS).find(v => v.mp4 === src || v.webm === src) || null
}
