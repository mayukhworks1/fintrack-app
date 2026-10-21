/**
 * The public site's motion and media primitives, and the shell around them.
 *
 * These are the parts every public page builds on, so the tests are about the
 * ways shared motion fails everyone at once: a figure that never reaches its
 * value, a video that starts by itself under reduced motion or downloads
 * before anyone looks at it, an image with no reserved space, content that
 * waits forever for an observer that does not exist, and a header that is
 * torn down and rebuilt on every click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'

import RollNumber from '../components/motion/RollNumber'
import InViewVideo from '../components/motion/InViewVideo'
import Shot from '../components/motion/Shot'
import LazyMount from '../components/motion/LazyMount'
import StepRail from '../components/motion/StepRail'
import { SCREENS, VIDEOS, screen as screenMedia } from '../components/motion/media'
import LoopVideo from '../components/LoopVideo'
import { useAutoplay } from '../hooks/useAutoplay'
import { useActiveStep } from '../hooks/useActiveStep'
import { useInk } from '../hooks/useInk'
import { PageHead } from '../components/PublicBits'
import PublicLayout from '../components/PublicLayout'
import { ALL_PAGES } from '../components/MegaNav'

let authState = { status: 'anon', isWeb: false, isAll: false, isAdmin: false, isViewer: false, isImpersonating: false }
vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
  ThemeProvider: ({ children }) => children,
}))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }))
vi.mock('../pages/Dashboard', () => ({ default: () => <div>dashboard stub</div> }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))
vi.mock('../services/api', () => ({
  api: {
    auth: {
      providers: vi.fn().mockResolvedValue({ google: false, zoho: false }),
      verify: vi.fn().mockResolvedValue({ valid: false }),
      googleStartUrl: vi.fn(() => '/api/auth/google/start'),
      zohoStartUrl: vi.fn(() => '/api/auth/zoho/start'),
    },
  },
  API_BASE_URL: '',
  getAuthToken: () => '',
  setAuthToken: vi.fn(),
}))

/* ── environment helpers ─────────────────────────────────────────────── */

function setReducedMotion(reduced, extra = {}) {
  vi.stubGlobal('matchMedia', vi.fn((q) => ({
    matches: q.includes('prefers-reduced-motion') ? reduced : !!extra[q],
    media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  })))
}

/** An observer that reports every target as fully visible as soon as it is watched. */
function observeAsVisible() {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ isIntersecting: true, intersectionRatio: 1, target: el }]) }
    unobserve() {}
    disconnect() {}
  })
}

/** An observer that never reports anything until `fire` is called. */
function observeManually() {
  const live = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb; this.els = []; live.push(this) }
    observe(el) { this.els.push(el) }
    unobserve() {}
    disconnect() { this.els = [] }
  })
  return {
    fire(entry = {}) {
      for (const io of live) for (const el of io.els) {
        io.cb([{ isIntersecting: true, intersectionRatio: 1, target: el, ...entry }])
      }
    },
  }
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  authState = { status: 'anon', isWeb: false, isAll: false, isAdmin: false, isViewer: false, isImpersonating: false }
  setReducedMotion(false)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete document.visibilityState
})

/* ── RollNumber ──────────────────────────────────────────────────────── */

const inr = (n) => `₹${n.toLocaleString('en-IN')}`

describe('RollNumber', () => {
  it('renders one node holding the final value when there is no observer', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { container } = render(<RollNumber value={1594180} format={inr} />)
    expect(screen.getAllByText('₹15,94,180')).toHaveLength(1)
    expect(container.querySelectorAll('.ft-m-roll')).toHaveLength(1)
  })

  it('shows the final value under reduced motion, even below the fold', () => {
    setReducedMotion(true)
    observeManually()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 5000, bottom: 5020, left: 0, right: 10, width: 10, height: 20 })
    render(<RollNumber value={1594180} format={inr} />)
    expect(screen.getAllByText('₹15,94,180')).toHaveLength(1)
  })

  it('counts up once revealed when it starts below the fold, and lands on the value', async () => {
    const io = observeManually()
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    let now = 0
    vi.stubGlobal('performance', { now: () => now })
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})

    const { container } = render(<RollNumber value={8} />)
    const figure = container.querySelector('.ft-m-roll')
    const spoken = container.querySelector('.sr-only')
    // Nothing is measured at mount: the observer says where the figure is.
    expect(rect).not.toHaveBeenCalled()
    expect(figure.textContent).toBe('8')
    // Its first report puts the figure below the viewport: it drops to the
    // start, out of sight, while assistive technology still reads the value.
    act(() => io.fire({ isIntersecting: false, intersectionRatio: 0,
                        boundingClientRect: { top: 5000 }, rootBounds: { height: 800 } }))
    expect(figure.textContent).toBe('0')
    expect(figure.getAttribute('aria-hidden')).toBe('true')
    expect(spoken.textContent).toBe('8')
    await act(async () => {
      io.fire()
      for (let i = 0; i < 40 && frames.length; i++) { now += 100; frames.splice(0).forEach(cb => cb(now)) }
    })
    expect(figure.textContent).toBe('8')
    expect(figure.hasAttribute('aria-hidden')).toBe(false)
    expect(spoken.textContent).toBe('')
    expect(container.textContent).toBe('8')
  })

  it('stays on its value when the observer first finds it on screen', () => {
    const io = observeManually()
    const { container } = render(<RollNumber value={8} />)
    act(() => io.fire())
    expect(container.textContent).toBe('8')
    act(() => io.fire({ isIntersecting: false, intersectionRatio: 0,
                        boundingClientRect: { top: 5000 }, rootBounds: { height: 800 } }))
    expect(container.textContent).toBe('8')
  })

  it('reserves the width of the final figure', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { container } = render(<RollNumber value={1594180} format={inr} />)
    expect(container.querySelector('.ft-m-roll').style.minWidth).toBe('10ch')
  })
})

/* ── InViewVideo and LoopVideo ───────────────────────────────────────── */

describe('InViewVideo', () => {
  it('never autoplays, preloads nothing and always has a poster', () => {
    observeAsVisible()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const { container } = render(<InViewVideo id="sheet-demo" label="Spreadsheet editor, sample data" />)
    const v = container.querySelector('video')
    expect(v.hasAttribute('autoplay')).toBe(false)
    expect(v.getAttribute('preload')).toBe('none')
    expect(v.getAttribute('poster')).toBe(VIDEOS['sheet-demo'].poster)
    expect(v.getAttribute('width')).toBe('1280')
    expect(v.getAttribute('height')).toBe('800')
    expect(container.querySelector('figcaption').textContent).toMatch(/sample data/i)
  })

  it('never calls play() under reduced motion, and offers a Play button instead', async () => {
    setReducedMotion(true)
    observeAsVisible()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const { container } = render(<InViewVideo id="sheet-demo" label="Sample data" />)
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(play).not.toHaveBeenCalled()
    // No sources until someone presses play: no video bytes either.
    expect(container.querySelectorAll('source')).toHaveLength(0)
    const toggle = screen.getByRole('button', { name: /pause video/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('plays once in view and stops when the tab is hidden', async () => {
    observeAsVisible()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => false })
    try {
      const { container } = render(<InViewVideo id="sheet-demo" label="Sample data" />)
      await act(async () => {})
      expect(play).toHaveBeenCalled()
      // WebM first, mp4 second.
      const types = [...container.querySelectorAll('source')].map(s => s.getAttribute('type'))
      expect(types).toEqual(['video/webm', 'video/mp4'])
      await act(async () => { setVisibility('hidden') })
      expect(pause).toHaveBeenCalled()
    } finally {
      delete HTMLMediaElement.prototype.paused
    }
  })

  it('LoopVideo is decorative, lazy and pausable', () => {
    observeAsVisible()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const { container } = render(<LoopVideo src="/media/pomelli_photoshoot-6.mp4" className="w-full h-full" />)
    const v = container.querySelector('video')
    expect(v.hasAttribute('autoplay')).toBe(false)
    expect(v.getAttribute('preload')).toBe('none')
    expect(v.getAttribute('aria-hidden')).toBe('true')
    expect(v.getAttribute('poster')).toBe(VIDEOS['loop-6'].poster)
    expect(container.querySelector('figcaption')).toBeNull()
    expect(screen.getByRole('button', { name: /pause animation/i })).toBeInTheDocument()
  })
})

/* ── useAutoplay ─────────────────────────────────────────────────────── */

function AutoplayProbe(props) {
  const { ref, running, toggle } = useAutoplay(props)
  return <button ref={ref} data-running={String(running)} onClick={toggle}>probe</button>
}

describe('useAutoplay', () => {
  it('is not running under reduced motion until the visitor presses play', async () => {
    setReducedMotion(true)
    observeAsVisible()
    render(<AutoplayProbe />)
    const probe = screen.getByText('probe')
    expect(probe.dataset.running).toBe('false')
    await act(async () => { fireEvent.click(probe) })
    expect(probe.dataset.running).toBe('true')
  })

  it('stops while the tab is hidden', async () => {
    observeAsVisible()
    render(<AutoplayProbe />)
    const probe = screen.getByText('probe')
    expect(probe.dataset.running).toBe('true')
    await act(async () => { setVisibility('hidden') })
    expect(probe.dataset.running).toBe('false')
    await act(async () => { setVisibility('visible') })
    expect(probe.dataset.running).toBe('true')
  })

  it('does not run while out of view, and a pause wins until resumed', async () => {
    const io = observeManually()
    render(<AutoplayProbe />)
    const probe = screen.getByText('probe')
    expect(probe.dataset.running).toBe('false')
    await act(async () => { io.fire() })
    expect(probe.dataset.running).toBe('true')
    await act(async () => { fireEvent.click(probe) })
    expect(probe.dataset.running).toBe('false')
  })
})

/* ── Shot ────────────────────────────────────────────────────────────── */

describe('Shot', () => {
  it('reserves its size and loads lazily from the registry', () => {
    const { container } = render(
      <Shot id="sheet" alt="Spreadsheet editor, sample data" caption="Sample data." />,
    )
    const img = container.querySelector('img')
    expect(img.getAttribute('width')).toBe(String(SCREENS.sheet.w))
    expect(img.getAttribute('height')).toBe(String(SCREENS.sheet.h))
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('decoding')).toBe('async')
    expect(img.getAttribute('fetchpriority')).toBeNull()
    expect(img.getAttribute('srcset')).toBe('/media/screens/sheet-sm.webp 800w, /media/screens/sheet.webp 1600w')
    expect(container.querySelector('figure figcaption').textContent).toBe('Sample data.')
  })

  it('opens a hotspot callout on focus and closes it on Escape', () => {
    render(<Shot id="sheet" alt="Sheet, sample data" spots={[{ x: '40%', y: '20%', label: 'Formula bar' }]} />)
    const spot = screen.getByRole('button', { name: 'Formula bar' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(spot)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Formula bar')
    expect(spot).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(spot, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('is eager with a high fetch priority only when asked', () => {
    const { container } = render(<Shot id="dashboard" alt="Dashboard, sample data" priority />)
    const img = container.querySelector('img')
    expect(img.getAttribute('loading')).toBe('eager')
    expect(img.getAttribute('fetchpriority')).toBe('high')
  })

  it('opens the full image in a dialog when zoomable', () => {
    render(<Shot id="gateway" alt="AI gateway, sample data" zoom />)
    fireEvent.click(screen.getByRole('button', { name: /enlarge/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('img').getAttribute('src')).toBe(screenMedia('gateway').src)
  })

  it('never points a public page at the uncropped insights capture by default', () => {
    expect(screenMedia('page-insights-charts').src).toBe('/media/derived/page-insights-charts.webp')
  })
})

/* ── LazyMount, StepRail, useActiveStep, useInk ──────────────────────── */

describe('LazyMount', () => {
  it('mounts at once when there is no observer', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<LazyMount minHeight={400}><p>inside</p></LazyMount>)
    expect(screen.getByText('inside')).toBeInTheDocument()
  })

  it('holds the space until it is near the viewport', async () => {
    const io = observeManually()
    const { container } = render(<LazyMount minHeight={400} id="film"><p>inside</p></LazyMount>)
    expect(screen.queryByText('inside')).toBeNull()
    const holder = container.querySelector('#film')
    expect(holder.style.minHeight).toBe('400px')
    await act(async () => { io.fire() })
    expect(screen.getByText('inside')).toBeInTheDocument()
    expect(holder.style.minHeight).toBe('400px')
  })
})

function StepProbe() {
  const { active, stepRef, tracking } = useActiveStep(3)
  return (
    <div data-active={active} data-tracking={String(tracking)}>
      {[0, 1, 2].map(i => <p key={i} ref={stepRef(i)}>step {i}</p>)}
    </div>
  )
}

function InkProbe({ at }) {
  const ref = useInk(at)
  return (
    <div ref={ref} className="ft-m-ink">
      {['a', 'b'].map((t, i) => <button key={t} aria-pressed={i === at}>{t}</button>)}
      <span className="ft-m-ink-bar" />
    </div>
  )
}

describe('step stories and tab rows', () => {
  it('StepRail draws one dot per step and is hidden from assistive tech', () => {
    const { container } = render(<StepRail count={4} active={1} labels={['a', 'b', 'c', 'd']} />)
    const rail = container.querySelector('.ft-m-rail')
    expect(rail).toHaveAttribute('aria-hidden', 'true')
    expect(rail.querySelectorAll('.ft-m-rail-dot')).toHaveLength(4)
    expect(rail.querySelectorAll('[data-current]')).toHaveLength(1)
  })

  it('StepRail reads every step as current under reduced motion', () => {
    setReducedMotion(true)
    const { container } = render(<StepRail count={3} active={0} />)
    expect(container.querySelectorAll('[data-current]')).toHaveLength(3)
  })

  it('useActiveStep stays on the first step and stops tracking under reduced motion', () => {
    setReducedMotion(true)
    observeAsVisible()
    const { container } = render(<StepProbe />)
    expect(container.firstChild.dataset.active).toBe('0')
    expect(container.firstChild.dataset.tracking).toBe('false')
  })

  it('useActiveStep follows the step crossing the band', () => {
    observeAsVisible()   // reports every step; the last one reported wins
    const { container } = render(<StepProbe />)
    expect(container.firstChild.dataset.tracking).toBe('true')
    expect(container.firstChild.dataset.active).toBe('2')
  })

  it('useInk measures the active item onto the container', () => {
    const { container, rerender } = render(<InkProbe at={0} />)
    const box = container.querySelector('.ft-m-ink')
    expect(box.getAttribute('data-axis')).toBe('x')
    expect(box.hasAttribute('data-ink')).toBe(true)
    expect(box.style.getPropertyValue('--ink-x')).toMatch(/px$/)
    rerender(<InkProbe at={1} />)
    expect(box.style.getPropertyValue('--ink-w')).toMatch(/px$/)
  })
})

/* ── Media registry ──────────────────────────────────────────────────── */

describe('media registry', () => {
  it('gives every screen a size, and the new captures their own height', () => {
    for (const id of Object.keys(SCREENS)) {
      const s = screenMedia(id)
      expect(s.w, id).toBeGreaterThan(0)
      expect(s.h, id).toBeGreaterThan(0)
      expect(s.src).toMatch(/\.webp$/)
      expect(s.srcSm).toMatch(/\.webp$/)
    }
    expect(SCREENS.sheet.h).toBe(1000)
    expect(SCREENS.dashboard.h).toBe(1031)
  })

  it('gives every video a poster and a size', () => {
    for (const [id, v] of Object.entries(VIDEOS)) {
      expect(v.poster, id).toMatch(/\.webp$/)
      expect(v.w * v.h, id).toBeGreaterThan(0)
    }
  })
})

/* ── PageHead aside ──────────────────────────────────────────────────── */

describe('PageHead aside', () => {
  const aside = <div>hero visual</div>

  it('sets the aside after the lede, in the main column, at every width', () => {
    setReducedMotion(false, { '(min-width: 1100px)': true })
    const { container } = render(<PageHead eyebrow="E" lines={['one', 'two']} aside={aside}>lede</PageHead>)
    const main = container.querySelector('.pb-main')
    expect(main).not.toBeNull()
    expect(main.textContent).toMatch(/one two.*lede.*hero visual/)
    // The opening is painted in the first frame: nothing in it waits on a reveal.
    expect(container.querySelector('.ft-reveal, .ft-rise')).toBeNull()
  })
})

/* ── The shell ───────────────────────────────────────────────────────── */

const LAZY_ROUTE = { timeout: 8000 }

describe('the public shell', () => {
  it('keeps the same header node across navigations', async () => {
    observeAsVisible()
    const App = (await import('../App')).default
    let go
    function Driver() { go = useNavigate(); return null }
    const { container } = render(
      <MemoryRouter initialEntries={['/']}><App /><Driver /></MemoryRouter>,
    )
    await screen.findByRole('navigation', { name: /sample workspace/i }, LAZY_ROUTE)
    const header = container.querySelector('header')
    expect(header).not.toBeNull()

    await act(async () => { go('/features') })
    await screen.findByRole('navigation', { name: /modules on this page/i }, LAZY_ROUTE)
    expect(container.querySelector('header')).toBe(header)
    expect(container.querySelectorAll('header')).toHaveLength(1)
    expect(container.querySelectorAll('footer')).toHaveLength(1)
  }, 20000)

  it('renders the whole chrome once even when a page wraps itself in PublicLayout', () => {
    const { container } = render(
      <MemoryRouter><PublicLayout><PublicLayout><p>page</p></PublicLayout></PublicLayout></MemoryRouter>,
    )
    expect(container.querySelectorAll('header')).toHaveLength(1)
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByText('page')).toBeInTheDocument()
  })

  it('names the search button by its visible text and announces its shortcut', () => {
    render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    const search = screen.getByRole('button', { name: /search pages and questions/i })
    expect(search).not.toHaveAttribute('aria-label')
    expect(search).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K')
  })

  it('footer reaches every page, the legal pages and sign-in', () => {
    render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    const footer = screen.getByRole('contentinfo')
    for (const { to, label } of ALL_PAGES) {
      expect(within(footer).getByRole('link', { name: label })).toHaveAttribute('href', to)
    }
    expect(within(footer).getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy')
    expect(within(footer).getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms')
    expect(within(footer).getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
  })

  it('phone menu: opens with the new strip, closes on Escape and hands focus back', async () => {
    render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    const toggle = screen.getByRole('button', { name: 'Open menu' })
    await act(async () => { fireEvent.click(toggle) })
    const menu = document.getElementById('ft-mobile-menu')
    expect(menu).not.toBeNull()
    expect(within(menu).getByRole('link', { name: /new.*pages/i })).toHaveAttribute('href', '/features#shipped')
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })
    await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    expect(document.getElementById('ft-mobile-menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open menu' }))
  })

  it('lands on the #anchor once the page holding it has mounted', async () => {
    const original = Element.prototype.scrollIntoView
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      render(
        <MemoryRouter initialEntries={['/features#shipped']}>
          <PublicLayout><section id="shipped">new things</section></PublicLayout>
        </MemoryRouter>,
      )
      await act(async () => { await new Promise(r => setTimeout(r, 60)) })
      expect(scroll).toHaveBeenCalled()
      expect(scroll.mock.contexts[0].id).toBe('shipped')
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })
})
