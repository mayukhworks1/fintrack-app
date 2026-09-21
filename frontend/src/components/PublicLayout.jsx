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
import { ArrowRight, Menu, X, Moon, Sun, Search } from 'lucide-react'
import MegaNav, { NAV, ALL_PAGES } from './MegaNav'
import CommandPalette, { openCommandPalette } from './CommandPalette'
import { useTheme } from '../context/ThemeContext'
// The app's own mark, not a second one drawn for this page. The public site
// briefly shipped a different logo from the product and the favicon; there is
// one mark, and this is it.
import BrandMark from './BrandMark'

export default function PublicLayout({ children }) {
  const { dark, toggle } = useTheme()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [legalModal, setLegalModal] = useState(null) // 'terms' | 'privacy' | null

  // Close on navigation, or the menu stays over the page you just opened.
  useEffect(() => { setOpen(false) }, [pathname])

  // A fixed overlay that scrolls the page behind it reads as broken.
  useEffect(() => {
    if (!open && !legalModal) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setLegalModal(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, legalModal])

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
        <nav className="mx-auto flex items-center gap-2 sm:gap-3 px-4 sm:px-6"
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

          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Search or jump to (⌘K)"
            className="hidden sm:flex items-center gap-2 rounded-lg text-xs font-medium ml-1 md:ml-2"
            style={{
              height: 36,
              padding: '0 10px',
              background: 'var(--bg-input)',
              border: '1px solid var(--card-border)',
              color: 'var(--text-3)',
              cursor: 'pointer',
              transition: 'border-color 150ms ease, color 150ms ease',
            }}
          >
            <Search size={13} aria-hidden="true" style={{ color: 'var(--text-3)' }} />
            <span className="hidden lg:inline">Search docs, questions…</span>
            <span className="lg:hidden">Search…</span>
            <kbd className="font-mono rounded px-1.5 py-0.5"
                 style={{
                   fontSize: 10,
                   background: 'var(--card-bg)',
                   border: '1px solid var(--card-border)',
                   color: 'var(--text-2)',
                 }}>
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={openCommandPalette}
              aria-label="Search site"
              className="sm:hidden flex items-center justify-center rounded-lg"
              style={{
                width: 40, height: 40, background: 'transparent',
                border: '1px solid var(--card-border)', color: 'var(--text-2)', cursor: 'pointer',
              }}
            >
              <Search size={16} />
            </button>

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
            <button
              type="button"
              onClick={() => { setOpen(false); openCommandPalette() }}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2.5 mt-3 text-left font-medium text-xs"
              style={{
                background: 'var(--bg-input)', border: '1px solid var(--card-border)',
                color: 'var(--text-2)', cursor: 'pointer',
              }}
            >
              <Search size={14} style={{ color: 'var(--text-3)' }} />
              <span className="flex-1">Search or jump to…</span>
              <kbd className="font-mono rounded px-1.5 py-0.5 text-[10px]"
                   style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
                ⌘K
              </kbd>
            </button>
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
            FinTrack — Financial Control & Delivery Intelligence
            <span className="hidden sm:inline">·</span>
            {/* Affordance for command palette */}
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
            <Link to="/privacy" className="inline-flex items-center text-xs font-semibold rounded-lg"
                  style={{ minHeight: 44, padding: '0 10px', color: 'var(--text-2)', textDecoration: 'none' }}>
              Privacy Policy
            </Link>
            <Link to="/terms" className="inline-flex items-center text-xs font-semibold rounded-lg"
                  style={{ minHeight: 44, padding: '0 10px', color: 'var(--text-2)', textDecoration: 'none' }}>
              Terms of Service
            </Link>
            <Link to="/login" className="inline-flex items-center text-xs font-semibold rounded-lg"
                  style={{ minHeight: 44, padding: '0 10px', color: 'var(--accent)', textDecoration: 'none' }}>
              Sign in
            </Link>
          </div>
        </div>
      </footer>

      {/* Institutional Legal Modal Dialog */}
      {legalModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setLegalModal(null)}
        >
          <div
            className="relative max-w-2xl w-full max-h-[85vh] flex flex-col rounded-xl overflow-hidden shadow-2xl"
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              color: 'var(--text-1)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b"
                 style={{ borderColor: 'var(--card-border)' }}>
              <div>
                <h3 className="ft-display text-lg font-bold" style={{ color: 'var(--text-1)' }}>
                  {legalModal === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
                </h3>
                <p className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>
                  Effective Date: January 1, 2026 · FinTrack Institutional Platform
                </p>
              </div>
              <button
                onClick={() => setLegalModal(null)}
                className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs leading-relaxed"
                 style={{ color: 'var(--text-2)' }}>
              {legalModal === 'privacy' ? (
                <>
                  <section>
                    <h4 className="font-bold text-sm mb-1" style={{ color: 'var(--text-1)' }}>1. Data Isolation & Tenant Boundaries</h4>
                    <p>FinTrack operates with strict tenant-level cryptographic and relational data isolation. Customer financial ledger entries, tax filings, invoice records, and proprietary contract documents are stored in dedicated schema spaces and are never co-mingled or used to train public foundation models.</p>
                  </section>
                  <section>
                    <h4 className="font-bold text-sm mb-1" style={{ color: 'var(--text-1)' }}>2. Security & Audit Logging</h4>
                    <p>All authenticated sessions, API transactions, and query executions are logged asynchronously into an immutable audit ledger containing actor identifiers, timestamps, origin IP metadata, and parameter payloads for regulatory compliance.</p>
                  </section>
                  <section>
                    <h4 className="font-bold text-sm mb-1" style={{ color: 'var(--text-1)' }}>3. Document Encryption</h4>
                    <p>Uploaded contracts, agreements, and financial statements are encrypted at rest using AES-256 and in transit via TLS 1.3. Vector embeddings generated for semantic citations are scoped strictly to the customer workspace.</p>
                  </section>
                </>
              ) : (
                <>
                  <section>
                    <h4 className="font-bold text-sm mb-1" style={{ color: 'var(--text-1)' }}>1. Service Provision & SLA</h4>
                    <p>FinTrack provides real-time financial tracking, receivables monitoring, statutory tax ledger calculation, and document intelligence services subject to enterprise service tier agreements.</p>
                  </section>
                  <section>
                    <h4 className="font-bold text-sm mb-1" style={{ color: 'var(--text-1)' }}>2. Role-Based Access & Accountability</h4>
                    <p>Organizations are responsible for configuring and administering role-based permissions (RBAC) and access tokens issued to authorized personnel. FinTrack enforces server-side query scoping on every database round-trip.</p>
                  </section>
                  <section>
                    <h4 className="font-bold text-sm mb-1" style={{ color: 'var(--text-1)' }}>3. Deterministic Computations</h4>
                    <p>Financial summaries and analytical queries are executed deterministically against synchronized database mirrors. The AI analytical assistant acts as a query transpiler and does not generate unverified arithmetic.</p>
                  </section>
                </>
              )}
            </div>

            <div className="px-6 py-3 border-t flex justify-end"
                 style={{ borderColor: 'var(--card-border)', background: 'var(--bg-input)' }}>
              <button
                onClick={() => setLegalModal(null)}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity"
                style={{ background: 'var(--accent-btn)' }}
              >
                Acknowledge & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
