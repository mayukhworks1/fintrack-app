/**
 * Shell for the public pages.
 *
 * The nav, the mobile menu and the footer were inline in the landing page,
 * which made a second public page impossible without duplicating them. They
 * live here so every public route gets the same chrome and the same way in.
 *
 * The shell persists across navigation. App renders one PublicLayout around
 * whichever public page is current, and provides PublicChromeContext; a page
 * that wraps itself in <PublicLayout> (they all do, so each one still renders
 * whole on its own, as the tests render them) gets only its children back
 * when it is already inside a shell. So the header is the same DOM node from
 * page to page: it does not blink, the theme toggle keeps focus, and only the
 * page inside <main> moves.
 *
 * The page inside <main> sits behind a Suspense boundary that stays mounted.
 * On the first load it shows a skeleton; on a later navigation (a transition)
 * React keeps the current page on screen until the next one has loaded, then
 * swaps it in with a short rise (.ft-m-page) — never on the first load, and
 * not at all under reduced motion.
 *
 * The mobile menu is the part that was missing entirely at first: the nav
 * links were simply hidden below 640px, so on a phone there was no way to
 * reach anything but the sign-in button.
 */
import { createContext, Suspense, useContext, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, Menu, X, Moon, Sun, Search } from 'lucide-react'
import MegaNav, { NAV, NewStrip } from './MegaNav'
import CommandPalette, { openCommandPalette } from './CommandPalette'
import { useTheme } from '../context/ThemeContext'
import { TAGLINE } from '../content/publicContent'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { prefersReducedMotion } from '../hooks/useReducedMotion'
import { usePresence } from '../hooks/usePresence'
// The app's own mark, not a second one drawn for this page. The public site
// briefly shipped a different logo from the product and the favicon; there is
// one mark, and this is it.
import BrandMark from './BrandMark'

/** True inside a rendered shell; a nested PublicLayout then renders only its children. */
export const PublicChromeContext = createContext(false)

const FOOTER_GROUPS = { product: 'Product', trust: 'Trust' }

const isApple = () => {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad|ipod/i.test(navigator.userAgentData?.platform || navigator.platform || '')
}

export default function PublicLayout({ children }) {
  const inside = useContext(PublicChromeContext)
  if (inside) return children
  return <PublicShell>{children}</PublicShell>
}

/** The route fallback: a page-head-shaped skeleton that holds the space inside <main>. */
export function PublicPageFallback() {
  return (
    <div role="status" className="mx-auto w-full px-4 sm:px-6 pt-10 sm:pt-14"
         style={{ maxWidth: 1120, minHeight: '70vh' }}>
      <span className="sr-only">Loading the page…</span>
      <span aria-hidden="true" className="ft-m-skeleton block" style={{ width: 110, height: 12 }} />
      <span aria-hidden="true" className="ft-m-skeleton block mt-5" style={{ width: 'min(560px, 92%)', height: 40 }} />
      <span aria-hidden="true" className="ft-m-skeleton block mt-3" style={{ width: 'min(420px, 72%)', height: 40 }} />
      <span aria-hidden="true" className="ft-m-skeleton block mt-7" style={{ width: 'min(520px, 88%)', height: 14 }} />
      <span aria-hidden="true" className="ft-m-skeleton block mt-2.5" style={{ width: 'min(460px, 80%)', height: 14 }} />
    </div>
  )
}

/* Lands on #anchor once the page holding it has actually mounted. The
   router's own effect runs on the first commit, before a lazy page exists,
   so a deep link to /features#shipped used to stop at the top. Retries for
   a second, for content that mounts a beat later. */
function HashLanding() {
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash || hash.length < 2) return
    let id
    try { id = decodeURIComponent(hash.slice(1)) } catch { return }
    let tries = 0
    let frame = 0
    const seek = () => {
      const el = document.getElementById(id)
      if (el) { el.scrollIntoView({ behavior: 'auto', block: 'start' }); return }
      if (++tries < 60) frame = requestAnimationFrame(seek)
    }
    frame = requestAnimationFrame(seek)
    return () => cancelAnimationFrame(frame)
    // Once per page mount: a hash change on the same page is App's to handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function PublicShell({ children }) {
  const { dark, toggle } = useTheme()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const headerRef = useRef(null)
  const menuRef = useRef(null)
  const toggleRef = useRef(null)
  // The phone menu stays mounted through its exit, so closing runs the
  // opening backwards and a second tap mid-close turns it round.
  const [menuMounted, menuState] = usePresence(open, menuRef)
  const [keycap] = useState(() => (isApple() ? '⌘K' : 'Ctrl K'))

  // The page enter plays on client-side navigations only. Derived during
  // render (not in an effect), so the first navigated page already has it.
  const [firstPath] = useState(pathname)
  const [moved, setMoved] = useState(false)
  if (!moved && pathname !== firstPath) setMoved(true)

  // Close on navigation, or the menu stays over the page you just opened.
  useEffect(() => { setOpen(false) }, [pathname])

  // The header gains a shadow once the page has moved under it. React
  // ignores a set to the same value, so this costs nothing per scroll event.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Press feedback lands on pointer-down (the :active rules in
  // styles/motion.css). iOS Safari only applies :active to a tap when a
  // touch listener exists somewhere on the page; this passive no-op is that.
  useEffect(() => {
    const noop = () => {}
    document.addEventListener('touchstart', noop, { passive: true })
    return () => document.removeEventListener('touchstart', noop)
  }, [])

  // Spotlight: tell the card under a mouse pointer where the pointer is, so
  // its glow (index.css, SPOTLIGHT) can follow it. One listener for the page.
  useEffect(() => {
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return
    if (prefersReducedMotion()) return
    let frame = 0
    const onMove = (e) => {
      const el = e.target?.closest?.('.ft-chip, .ft-lift, .ft-spot')
      if (!el || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const r = el.getBoundingClientRect()
        el.style.setProperty('--mx', `${e.clientX - r.left}px`)
        el.style.setProperty('--my', `${e.clientY - r.top}px`)
      })
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => { document.removeEventListener('pointermove', onMove); cancelAnimationFrame(frame) }
  }, [])

  // While the phone menu is open, Tab stays in the header (the menu and the
  // button that closes it), and focus starts on the menu's first control.
  useFocusTrap(headerRef, open)
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector('a[href], button:not([disabled])')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  // A fixed overlay that scrolls the page behind it reads as broken. Escape
  // closes, and focus goes back to the button that opened it.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      // After the trap has let go, which is what restores focus otherwise:
      // a browser that does not focus a tapped button leaves it nowhere.
      requestAnimationFrame(() => toggleRef.current?.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    // `main-app-theme` is the product's palette. Without it the public pages
    // render from the bare :root fallback — a different blue, a colder
    // off-white, different text greys — so the site a visitor saw first did
    // not match the app they signed in to.
    <PublicChromeContext.Provider value>
      <div className="main-app-theme login-bg ft-m-shell min-h-screen flex flex-col"
           style={{ color: 'var(--text-1)' }}>
        <header
          ref={headerRef}
          className="ft-header sticky top-0 z-40"
          data-scrolled={scrolled ? '' : undefined}
          data-menu={open ? '' : undefined}
        >
          <nav aria-label="Main" className="mx-auto flex items-center gap-2 sm:gap-3 px-4 sm:px-6"
               style={{ maxWidth: 1120, minHeight: 60 }}>
            {/* Padded to a real target — as a bare 30px mark plus text this was
                under the ~44px a thumb can hit. */}
            <Link to="/" className="flex items-center gap-2"
                  style={{ color: 'var(--text-1)', textDecoration: 'none',
                           minHeight: 44, paddingRight: 4 }}>
              <BrandMark size={30} />
              <span className="ft-wordmark" style={{ fontSize: '1.16rem' }}>FinTrack</span>
            </Link>

            <MegaNav />

            {/* The accessible name is the visible text: an aria-label that said
                something else was a mismatch for anyone using voice control. */}
            <button
              type="button"
              onClick={openCommandPalette}
              aria-keyshortcuts="Meta+K Control+K"
              className="ft-m-press hidden sm:flex items-center gap-2 rounded-lg text-xs font-medium ml-1 md:ml-2"
              style={{
                height: 36,
                padding: '0 10px',
                background: 'var(--bg-input)',
                border: '1px solid var(--card-border)',
                color: 'var(--text-3)',
                cursor: 'pointer',
              }}
            >
              <Search size={13} aria-hidden="true" style={{ color: 'var(--text-3)' }} />
              <span className="hidden lg:inline">Search pages and questions…</span>
              <span className="lg:hidden">Search…</span>
              <kbd className="ft-m-kbd-hint font-mono rounded px-1.5 py-0.5"
                   style={{
                     fontSize: 10,
                     background: 'var(--card-bg)',
                     border: '1px solid var(--card-border)',
                     color: 'var(--text-2)',
                   }}>
                {keycap}
              </kbd>
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={openCommandPalette}
                aria-label="Search site"
                className="ft-m-press sm:hidden flex items-center justify-center rounded-lg"
                style={{
                  width: 40, height: 40, background: 'transparent',
                  border: '1px solid var(--card-border)', color: 'var(--text-2)', cursor: 'pointer',
                }}
              >
                <Search size={16} aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={toggle}
                aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="ft-m-press flex items-center justify-center rounded-lg"
                style={{
                  width: 40, height: 40, background: 'transparent',
                  border: '1px solid var(--card-border)', color: 'var(--text-2)', cursor: 'pointer',
                }}
              >
                {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
              </button>

              <Link to="/login"
                    className="ft-btn hidden md:flex items-center gap-1.5 rounded-lg font-semibold text-sm"
                    style={{
                      minHeight: 40, padding: '0 16px', background: 'var(--accent-btn)',
                      color: 'var(--accent-fg)', textDecoration: 'none',
                    }}>
                Sign in <ArrowRight size={15} aria-hidden="true" />
              </Link>

              <button
                type="button"
                ref={toggleRef}
                onClick={() => setOpen(o => !o)}
                aria-label={open ? 'Close menu' : 'Open menu'}
                aria-expanded={open}
                aria-controls="ft-mobile-menu"
                className="ft-m-press md:hidden flex items-center justify-center rounded-lg"
                style={{
                  width: 44, height: 44, background: 'transparent',
                  border: '1px solid var(--card-border)', color: 'var(--text-1)', cursor: 'pointer',
                }}
              >
                {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
              </button>
            </div>
          </nav>
          {/* Reading progress. Scroll-linked in CSS where the browser has it,
              absent where it does not — the right amount of missing for a
              decoration that costs no JavaScript either way. */}
          <span className="ft-progress" aria-hidden="true" />

          {menuMounted && (
            /* Every destination, grouped and described. A phone sheet that
               lists six bare nouns is the same problem the desktop nav had.
               It slides in and its groups follow in order, and slides back
               out the way it came; under reduced motion it cross-fades. */
            <div id="ft-mobile-menu" ref={menuRef} data-shown="" data-state={menuState}
                 inert={menuState === 'closed' ? '' : undefined}
                 className="ft-m-menu ft-m-seq md:hidden px-4 pb-4 overflow-y-auto"
                 style={{ borderTop: '1px solid var(--card-border)', maxHeight: 'calc(100vh - 60px)' }}>
              <div style={{ '--i': 0 }}>
                <button
                  type="button"
                  onClick={() => { setOpen(false); openCommandPalette() }}
                  className="ft-m-press w-full flex items-center gap-2 rounded-lg px-3 mt-3 text-left font-medium text-xs"
                  style={{
                    minHeight: 44,
                    background: 'var(--bg-input)', border: '1px solid var(--card-border)',
                    color: 'var(--text-2)', cursor: 'pointer',
                  }}
                >
                  <Search size={14} aria-hidden="true" style={{ color: 'var(--text-3)' }} />
                  <span className="flex-1">Search pages and questions…</span>
                  <kbd className="ft-m-kbd-hint font-mono rounded px-1.5 py-0.5 text-[10px]"
                       style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
                    {keycap}
                  </kbd>
                </button>
                <NewStrip />
              </div>
              {NAV.map((group, gi) => (
                <div key={group.id} className="pt-3" style={{ '--i': gi + 1 }}>
                  <p className="ft-eyebrow mb-1.5" style={{ fontSize: '0.6rem' }}>{group.label}</p>
                  {group.items.map(({ to, label, blurb }) => (
                    <Link key={to} to={to}
                          aria-current={pathname === to ? 'page' : undefined}
                          className="ft-m-press-lg block rounded-lg px-3 py-2.5"
                          style={{
                            background: pathname === to ? 'var(--accent-dim)' : 'transparent',
                            textDecoration: 'none',
                          }}>
                      <span className="block font-bold text-sm"
                            style={{ color: pathname === to ? 'var(--accent-ink, var(--accent))' : 'var(--text-1)' }}>
                        {label}
                      </span>
                      <span className="block" style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-3)' }}>
                        {blurb}
                      </span>
                    </Link>
                  ))}
                </div>
              ))}
              <div style={{ '--i': NAV.length + 1 }}>
                <Link to="/login"
                      className="ft-m-press flex items-center justify-center gap-2 rounded-lg font-bold text-sm mt-4"
                      style={{
                        minHeight: 48, background: 'var(--accent-btn)', color: 'var(--accent-fg)',
                        textDecoration: 'none',
                      }}>
                  Sign in <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}
        </header>

        <CommandPalette />

        <main className="flex-1">
          <Suspense fallback={<PublicPageFallback />}>
            <div key={pathname} className={moved ? 'ft-m-page' : undefined}>
              {children}
              <HashLanding />
            </div>
          </Suspense>
        </main>

        <footer className="mx-auto w-full px-4 sm:px-6 pb-10" style={{ maxWidth: 1120 }}>
          <div className="ft-m-foot pt-8" style={{ borderTop: '1px solid var(--card-border)' }}>
            <div className="ft-m-foot-brand">
              <Link to="/" className="inline-flex items-center gap-2"
                    style={{ color: 'var(--text-1)', textDecoration: 'none', minHeight: 44 }}>
                <BrandMark size={26} />
                <span className="ft-wordmark" style={{ fontSize: '1.05rem' }}>FinTrack</span>
              </Link>
              <p className="text-sm mt-2" style={{ color: 'var(--text-2)', lineHeight: 1.55, maxWidth: 300 }}>
                {TAGLINE}
              </p>
              <p className="ft-m-kbd-hint hidden sm:flex items-center gap-1.5 text-xs mt-2"
                 style={{ color: 'var(--text-3)' }}>
                Press <kbd className="ft-kbd">{keycap}</kbd> to search
              </p>
              <Link to="/login"
                    className="ft-btn inline-flex items-center gap-1.5 rounded-lg font-semibold text-sm mt-4"
                    style={{
                      minHeight: 44, padding: '0 16px', background: 'var(--accent-btn)',
                      color: 'var(--accent-fg)', textDecoration: 'none',
                    }}>
                Sign in <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
            {NAV.map(group => (
              <div key={group.id}>
                <h2 className="ft-eyebrow mb-1.5">{FOOTER_GROUPS[group.id] || group.label}</h2>
                <ul className="m-0 p-0" style={{ listStyle: 'none' }}>
                  {group.items.map(({ to, label }) => (
                    <li key={to}>
                      <Link to={to} className="ft-m-foot-link"
                            aria-current={pathname === to ? 'page' : undefined}>
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div>
              <h2 className="ft-eyebrow mb-1.5">Legal</h2>
              <ul className="m-0 p-0" style={{ listStyle: 'none' }}>
                <li><Link to="/privacy" className="ft-m-foot-link">Privacy Policy</Link></li>
                <li><Link to="/terms" className="ft-m-foot-link">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
        </footer>
      </div>
    </PublicChromeContext.Provider>
  )
}
