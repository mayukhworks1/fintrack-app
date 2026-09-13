/**
 * Shell for the public pages.
 *
 * The nav, the mobile menu and the footer were inline in the landing page,
 * which made a second public page impossible without duplicating them. They
 * live here so every public route gets the same chrome and the same way in.
 *
 * The mobile menu is the part that was missing entirely: the nav links were
 * simply hidden below 640px, so on a phone there was no way to reach anything
 * but the sign-in button.
 */
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, Menu, X, Moon, Sun } from 'lucide-react'
import MegaNav, { NAV, ALL_PAGES } from './MegaNav'
import CommandPalette from './CommandPalette'
import { useTheme } from '../context/ThemeContext'
// The app's own mark, not a second one drawn for this page. The public site
// briefly shipped a different logo from the product and the favicon; there is
// one mark, and this is it.
import BrandMark from './BrandMark'

export default function PublicLayout({ children }) {
  const { dark, toggle } = useTheme()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  // Close on navigation, or the menu stays over the page you just opened.
  useEffect(() => { setOpen(false) }, [pathname])

  // A fixed overlay that scrolls the page behind it reads as broken.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
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
    <div className="main-app-theme login-bg min-h-screen flex flex-col"
         style={{ color: 'var(--text-1)' }}>
      <header
        className="sticky top-0 z-40"
        style={{
          background: 'color-mix(in srgb, var(--bg-base) 88%, transparent)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--card-border)',
        }}
      >
        <nav className="mx-auto flex items-center gap-3 px-4 sm:px-6"
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

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggle}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex items-center justify-center rounded-lg"
              style={{
                width: 40, height: 40, background: 'transparent',
                border: '1px solid var(--card-border)', color: 'var(--text-2)', cursor: 'pointer',
              }}
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <Link to="/login"
                  className="hidden md:flex items-center gap-1.5 rounded-lg font-semibold text-sm"
                  style={{
                    minHeight: 40, padding: '0 16px', background: 'var(--accent-btn)',
                    color: '#fff', textDecoration: 'none',
                  }}>
              Sign in <ArrowRight size={15} aria-hidden="true" />
            </Link>

            <button
              onClick={() => setOpen(o => !o)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              className="md:hidden flex items-center justify-center rounded-lg"
              style={{
                width: 40, height: 40, background: 'transparent',
                border: '1px solid var(--card-border)', color: 'var(--text-1)', cursor: 'pointer',
              }}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </nav>
        {/* Reading progress. Scroll-linked in CSS where the browser has it,
            absent where it does not — the right amount of missing for a
            decoration that costs no JavaScript either way. */}
        <span className="ft-progress" aria-hidden="true" />

        {open && (
          /* Every destination, grouped and described. A phone sheet that
             lists six bare nouns is the same problem the desktop nav had. */
          <div className="md:hidden px-4 pb-4 overflow-y-auto"
               style={{ borderTop: '1px solid var(--card-border)', maxHeight: 'calc(100vh - 60px)' }}>
            {NAV.map(group => (
              <div key={group.id} className="pt-3">
                <p className="ft-eyebrow mb-1.5" style={{ fontSize: '0.6rem' }}>{group.label}</p>
                {group.items.map(({ to, label, blurb }) => (
                  <Link key={to} to={to}
                        aria-current={pathname === to ? 'page' : undefined}
                        className="block rounded-lg px-3 py-2.5"
                        style={{
                          background: pathname === to ? 'var(--accent-dim)' : 'transparent',
                          textDecoration: 'none',
                        }}>
                    <span className="block font-bold text-sm"
                          style={{ color: pathname === to ? 'var(--accent)' : 'var(--text-1)' }}>
                      {label}
                    </span>
                    <span className="block" style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-3)' }}>
                      {blurb}
                    </span>
                  </Link>
                ))}
              </div>
            ))}
            <Link to="/login"
                  className="flex items-center justify-center gap-2 rounded-lg font-bold text-sm mt-4"
                  style={{
                    minHeight: 48, background: 'var(--accent-btn)', color: '#fff',
                    textDecoration: 'none',
                  }}>
              Sign in <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        )}
      </header>

      <CommandPalette />

      <main className="flex-1">{children}</main>

      <footer className="mx-auto w-full px-4 sm:px-6 pb-10" style={{ maxWidth: 1120 }}>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6"
             style={{ borderTop: '1px solid var(--card-border)' }}>
          <p className="text-xs flex items-center gap-2 flex-wrap justify-center sm:justify-start"
             style={{ color: 'var(--text-3)' }}>
            FinTrack — AI finance manager
            <span className="hidden sm:inline">·</span>
            {/* Otherwise nobody finds it. A shortcut with no affordance is a
                shortcut for the person who wrote it. */}
            <span className="hidden sm:flex items-center gap-1.5">
              press <kbd className="ft-kbd">⌘K</kbd> to search
            </span>
          </p>
          <div className="flex items-center flex-wrap justify-center gap-1">
            {ALL_PAGES.map(({ to, label }) => (
              <Link key={to} to={to} className="inline-flex items-center text-xs font-semibold rounded-lg"
                    style={{ minHeight: 44, padding: '0 10px', color: 'var(--text-2)', textDecoration: 'none' }}>
                {label}
              </Link>
            ))}
            <Link to="/login" className="inline-flex items-center text-xs font-semibold rounded-lg"
                  style={{ minHeight: 44, padding: '0 10px', color: 'var(--accent)', textDecoration: 'none' }}>
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
