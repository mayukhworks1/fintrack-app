// The branded screens a visitor sees in place of shared content: password,
// expired, not found. Published pages and shared view links both use them.
import { usePageMeta } from '../../hooks/usePageMeta'

// ---------------------------------------------------------------------------
// Theme: one set of colours for light, one for dark, picked by the visitor's
// device. Web pages (HTML) keep whatever colours their author wrote.
// ---------------------------------------------------------------------------
export const PV_THEME = `
:root{--pv-bg:#f8fafc;--pv-card:#ffffff;--pv-ink:#0f172a;--pv-text:#374151;--pv-mute:#64748b;--pv-line:#e2e8f0;--pv-subtle:#f1f5f9;--pv-accent-soft:#eff6ff;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--pv-bg:#0b0e14;--pv-card:#131822;--pv-ink:#f1f5f9;--pv-text:#cbd5e1;--pv-mute:#8b95a7;--pv-line:#252c39;--pv-subtle:#1a2030;--pv-accent-soft:#16233f;color-scheme:dark}
.md mark{background:#854d0e;color:#fef9c3}.md code{color:#f9a8d4}}
body{background:var(--pv-bg)}
@keyframes pv-spin{to{transform:rotate(360deg)}}
@keyframes pv-shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
.pv-skel{background:linear-gradient(90deg,var(--pv-subtle) 0%,var(--pv-line) 50%,var(--pv-subtle) 100%);background-size:800px 100%;animation:pv-shimmer 1.3s linear infinite;border-radius:8px}
@media (prefers-reduced-motion: reduce){.pv-skel{animation:none}}
`

export function BrandMark({ size = 22 }) {
  return <img src="/favicon.svg" alt="" width={size} height={size} style={{ borderRadius: 6, display: 'block' }} />
}

// The screens a visitor sees instead of the page itself: password, expired,
// not found. Same frame for all three so the brand reads the same everywhere.
export function BrandScreen({ icon, title, message, docTitle, children, product = 'FinTrack Pages', headingRef }) {
  usePageMeta({ title: docTitle || title })
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'max(32px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(32px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))', boxSizing: 'border-box', background: 'radial-gradient(1200px 600px at 50% -10%, var(--pv-accent-soft), var(--pv-bg) 60%)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ width: '100%', maxWidth: 420, background: 'var(--pv-card)', border: '1px solid var(--pv-line)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 20px 60px rgba(15,23,42,0.12)' }}>
        <div style={{ height: 4, background: 'linear-gradient(90deg,#2563eb,#7c3aed)' }} />
        <div style={{ padding: '36px 32px 32px', textAlign: 'center' }}>
          <div aria-hidden="true" style={{ width: 56, height: 56, margin: '0 auto 18px', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--pv-accent-soft)', color: '#2563eb' }}>
            {icon}
          </div>
          <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} style={{ outline: 'none', margin: '0 0 8px', fontSize: 22, fontWeight: 800, lineHeight: 1.25, color: 'var(--pv-ink)', letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{title}</h1>
          {message && <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: 'var(--pv-mute)' }}>{message}</p>}
          {children}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22, fontSize: 12.5, color: 'var(--pv-mute)' }}>
        <BrandMark size={18} /> Shared securely with <strong style={{ color: 'var(--pv-text)', fontWeight: 700 }}>{product}</strong>
      </div>
    </div>
  )
}

const Svg = ({ children }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
export const LockIcon = () => <Svg><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>
export const ClockIcon = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
export const SearchIcon = () => <Svg><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>
