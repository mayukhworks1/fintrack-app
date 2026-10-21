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
import { Menu, X, Moon, Sun, Search } from 'lucide-react'
import MegaNav, { NAV, NewStrip } from './MegaNav'
import CommandPalette, { openCommandPalette } from './CommandPalette'
import { useTheme } from '../context/ThemeContext'
import { TAGLINE } from '../content/publicContent'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { usePresence } from '../hooks/usePresence'
// The app's own mark, not a second one drawn for this page. The public site
// briefly shipped a different logo from the product and the favicon; there is
// one mark, and this is it.
import BrandMark from './BrandMark'
import '../styles/public-site.css'

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
    // `main-app-theme` is the product's palette, so the site a visitor sees
    // first matches the app they sign in to. `pb` scopes the site's own type,
    // grid and surfaces (styles/public-site.css).
    <PublicChromeContext.Provider value>
      <div className="main-app-theme pb ft-m-shell min-h-screen flex flex-col">
        <header
          ref={headerRef}
          className="pb-header"
          data-scrolled={scrolled ? '' : undefined}
          data-menu={open ? '' : undefined}
        >
          <nav aria-label="Main" className="pb-wrap pb-nav">
            <Link to="/" className="pb-brand">
              <BrandMark size={28} />
              <span className="ft-wordmark" style={{ fontSize: '1.12rem' }}>FinTrack</span>
            </Link>

            <MegaNav />

            {/* The accessible name is the visible text, for voice control. */}
            <button
              type="button"
              onClick={openCommandPalette}
              aria-keyshortcuts="Meta+K Control+K"
              className="pb-search hidden sm:inline-flex"
            >
              <Search size={14} strokeWidth={1.5} aria-hidden="true" />
              <span className="hidden lg:inline">Search pages and questions</span>
              <span className="lg:hidden">Search</span>
              <kbd className="ft-m-kbd-hint">{keycap}</kbd>
            </button>

            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={openCommandPalette} aria-label="Search site"
                      className="pb-iconbtn sm:hidden">
                <Search size={18} strokeWidth={1.5} aria-hidden="true" />
              </button>

              <button type="button" onClick={toggle}
                      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                      className="pb-iconbtn">
                {dark ? <Sun size={18} strokeWidth={1.5} aria-hidden="true" />
                      : <Moon size={18} strokeWidth={1.5} aria-hidden="true" />}
              </button>

              <Link to="/login" className="pb-btn pb-btn-primary pb-btn-sm hidden md:inline-flex" style={{ marginLeft: 8 }}>
                Sign in
              </Link>

              <button
                type="button"
                ref={toggleRef}
                onClick={() => setOpen(o => !o)}
                aria-label={open ? 'Close menu' : 'Open menu'}
                aria-expanded={open}
                aria-controls="ft-mobile-menu"
                className="pb-iconbtn md:hidden"
                style={{ width: 44, height: 44, color: 'var(--text-1)' }}
              >
                {open ? <X size={20} strokeWidth={1.5} aria-hidden="true" />
                      : <Menu size={20} strokeWidth={1.5} aria-hidden="true" />}
              </button>
            </div>
          </nav>

          {menuMounted && (
            /* Every destination, grouped and described. It fades in and out;
               under reduced motion it is simply there. */
            <div id="ft-mobile-menu" ref={menuRef} data-shown="" data-state={menuState}
                 inert={menuState === 'closed' ? '' : undefined}
                 className="ft-m-menu pb-menu md:hidden">
              <div className="pb-wrap">
                <button
                  type="button"
                  onClick={() => { setOpen(false); openCommandPalette() }}
                  className="pb-search w-full"
                  style={{ margin: '16px 0 0', height: 44 }}
                >
                  <Search size={16} strokeWidth={1.5} aria-hidden="true" />
                  <span className="flex-1 text-left">Search pages and questions</span>
                </button>
                <div style={{ marginTop: 12 }}><NewStrip /></div>
                {NAV.map(group => (
                  <div key={group.id} className="pb-menu-group">
                    <p className="pb-label" style={{ marginBottom: 4 }}>{group.label}</p>
                    {group.items.map(({ to, label, blurb }) => (
                      <Link key={to} to={to} className="pb-menu-link"
                            aria-current={pathname === to ? 'page' : undefined}>
                        <b>{label}</b>
                        <span>{blurb}</span>
                      </Link>
                    ))}
                  </div>
                ))}
                <Link to="/login" className="pb-btn pb-btn-primary w-full" style={{ marginTop: 20 }}>
                  Sign in
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

        <footer className="pb-footer">
          <div className="pb-wrap">
            <div className="pb-footer-grid">
              <div>
                <Link to="/" className="pb-brand">
                  <BrandMark size={24} />
                  <span className="ft-wordmark" style={{ fontSize: '1.02rem' }}>FinTrack</span>
                </Link>
                <p className="pb-small" style={{ marginTop: 8, maxWidth: 320 }}>{TAGLINE}</p>
                <p style={{ marginTop: 16 }}>
                  <Link to="/login" className="pb-btn pb-btn-quiet pb-btn-sm">Sign in</Link>
                </p>
              </div>
              {NAV.map(group => (
                <div key={group.id}>
                  <h2>{FOOTER_GROUPS[group.id] || group.label}</h2>
                  <ul>
                    {group.items.map(({ to, label }) => (
                      <li key={to}>
                        <Link to={to} aria-current={pathname === to ? 'page' : undefined}>{label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div>
                <h2>Legal</h2>
                <ul>
                  <li><Link to="/privacy" aria-current={pathname === '/privacy' ? 'page' : undefined}>Privacy Policy</Link></li>
                  <li><Link to="/terms" aria-current={pathname === '/terms' ? 'page' : undefined}>Terms of Service</Link></li>
                </ul>
              </div>
            </div>
            <p className="pb-footer-note ft-m-kbd-hint">
              Press <kbd className="ft-kbd">{keycap}</kbd> to search the site. Figures shown on these pages are sample data.
            </p>
          </div>
        </footer>
      </div>
    </PublicChromeContext.Provider>
  )
}
