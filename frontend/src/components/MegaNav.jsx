/**
 * The public navigation.
 *
 * Three flat links could not carry the site any more. Splitting the landing
 * page — it had grown to seventeen screens on a phone — means there are now
 * six public pages, and six links in a row is a worse problem than one long
 * page: nobody reads a row of six nouns.
 *
 * So the nav groups them and says what each one is. A panel that shows a
 * sentence and a preview beside every destination is the difference between
 * choosing and guessing.
 *
 * Interaction rules, in order of how often they are got wrong:
 *
 *   Hover opens on a fine pointer only. On a touch screen there is no hover,
 *   and a menu that opens on the first tap and follows the link on the second
 *   is the single most disliked pattern on the mobile web — so touch gets a
 *   real button that toggles.
 *
 *   The close is delayed. Moving the pointer from the trigger down into the
 *   panel crosses a few pixels of neither, and closing on that gap makes the
 *   menu feel like it is running away.
 *
 *   Everything is reachable by keyboard. The trigger is a button with
 *   aria-expanded, Escape closes and returns focus to it, and Tab walks into
 *   the panel because the panel is the next thing in the document.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, ChevronDown } from 'lucide-react'
import {
  GlyphOneRecord, GlyphModules, GlyphLayers,
  GlyphPermissions, GlyphSwitches, GlyphQA,
} from './Glyphs'
import { usePresence } from '../hooks/usePresence'

/* Each entry names a page that exists and says what is on it. A menu that
   promises something the page does not deliver is worse than no menu. */
export const NAV = [
  {
    id: 'product',
    label: 'Product',
    kind: 'rich',
    items: [
      {
        to: '/', label: 'Overview',
        blurb: 'Delivery and the money for it — and a working copy you can drive.',
        visual: 'oneRecord',
      },
      {
        to: '/features', label: 'Features',
        blurb: 'Eleven modules — delivery, receivables, tax, audit — one at a time.',
        visual: 'modules',
      },
      {
        to: '/how-it-works', label: 'How it works',
        blurb: 'Nothing to migrate, and why an answer here can be checked.',
        visual: 'layers',
      },
    ],
  },
  {
    id: 'trust',
    label: 'Trust & fit',
    kind: 'rich',
    items: [
      {
        to: '/security', label: 'Security & access',
        blurb: 'Who can see what, and how the permission model enforces it.',
        visual: 'permissions',
      },
      {
        to: '/customise', label: 'Made yours',
        blurb: 'Configured, deployed on your own cloud, or extended for your case.',
        visual: 'switches',
      },
      {
        to: '/faq', label: 'Questions',
        blurb: 'The ones buyers actually ask, answered at length.',
        visual: 'qa',
      },
    ],
  },
]

/** Every page in the nav, flattened — the mobile sheet and the footer use it. */
export const ALL_PAGES = NAV.flatMap(g => g.items)

/**
 * What shipped most recently, under the Product items and at the top of the
 * phone menu. Deliberately not an entry in NAV: it points into a page, not
 * at one, and NAV holds only whole routes.
 */
export function NewStrip({ onClick }) {
  return (
    <Link to="/features#shipped" className="ft-m-new" onClick={onClick}>
      <span className="ft-m-new-badge">New</span>
      <span className="flex-1">Pages — spreadsheets, link previews, view insights</span>
      <ArrowRight size={14} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--accent-ink, var(--accent))' }} />
    </Link>
  )
}

/* Keyed by subject, not by shape. The previous map had four entries for six
   destinations, so two of them were always showing another page's picture. */
const VISUALS = {
  oneRecord: <GlyphOneRecord />,
  modules: <GlyphModules />,
  layers: <GlyphLayers />,
  permissions: <GlyphPermissions />,
  switches: <GlyphSwitches />,
  qa: <GlyphQA />,
}

/**
 * The panel's right half: a glance at the page being pointed at.
 *
 * The caption is gone. It printed the page name, which is already set in bold
 * in the row the pointer is resting on — the same word twice in one panel,
 * and a rule drawn under a picture to hold it. If the drawing needs a label
 * naming the thing it is next to, the drawing is not doing its job; the fix
 * was to make the drawing say something, not to caption it.
 */
function Preview({ items, current }) {
  // Every drawing for the group sits in one cell and the one being pointed
  // at fades up over the others. A cross-fade rather than a remount: moving
  // quickly down the list re-targets the fade from wherever it is, instead
  // of restarting a wipe from blank on every row. The wipe (ft-m-clip) plays
  // once, when the panel opens. Static under reduced motion.
  return (
    <div data-shown="" className="hidden lg:flex items-center justify-center rounded-xl p-5"
         style={{
           width: 244, flexShrink: 0,
           background: 'var(--bg-input)', border: '1px solid var(--card-border)',
         }}>
      <div aria-hidden="true" className="ft-m-clip ft-mega-art w-full" style={{ minHeight: 116 }}>
        {items.map(item => (
          <div key={item.to} data-on={item.to === current.to ? '' : undefined}>
            {VISUALS[item.visual]}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The dropdown itself. It stays mounted through its exit, so closing is the
 * opening run backwards, and pointing back in mid-close turns it round from
 * where it is (usePresence, and transitions in index.css).
 */
function MegaPanel({ open, fine, onEnter, onLeave, children }) {
  const ref = useRef(null)
  const [mounted, state] = usePresence(open, ref)
  if (!mounted) return null
  return (
    <div ref={ref} className="ft-mega" data-state={state}
         inert={state === 'closed' ? '' : undefined}
         onMouseEnter={fine ? onEnter : undefined}
         onMouseLeave={fine ? onLeave : undefined}>
      {children}
    </div>
  )
}

export default function MegaNav() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(null)     // group id, or null
  const [hovered, setHovered] = useState({}) // group id -> item.to
  const closeTimer = useRef(null)
  const rootRef = useRef(null)
  const triggers = useRef({})

  // A pointer that cannot hover must not have hover behaviour. Read once:
  // this decides which interaction model the nav uses and must not flip
  // between the trigger and the panel.
  const [fine, setFine] = useState(true)
  useEffect(() => {
    setFine(!!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches)
  }, [])

  const cancelClose = () => { clearTimeout(closeTimer.current); closeTimer.current = null }
  // Long enough to cross the gap between the trigger and the panel, short
  // enough that a menu left behind does not linger.
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(null), 180) }
  useEffect(() => cancelClose, [])

  // Navigating closes it, or the panel sits over the page it just opened.
  useEffect(() => { setOpen(null) }, [pathname])

  const close = useCallback((refocus) => {
    cancelClose()
    setOpen(null)
    if (refocus) triggers.current[refocus]?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') close(open) }
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) close() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open, close])

  const groupActive = (g) => g.items.some(i => i.to === pathname)

  return (
    <div ref={rootRef} className="hidden md:flex items-center gap-1 ml-3">
      {NAV.map(group => {
        const isOpen = open === group.id
        const active = groupActive(group)
        const current = group.items.find(i => i.to === (hovered[group.id] ?? group.items[0].to))
          ?? group.items[0]

        return (
          // Focus leaving the open group (tabbing on to the next trigger or
          // into the page) closes its panel; otherwise it would stay open over
          // the header and the heading while the visitor tabs on.
          <div key={group.id} className="relative"
               onBlur={(e) => { if (isOpen && !e.currentTarget.contains(e.relatedTarget)) close() }}
               onMouseEnter={fine ? () => { cancelClose(); setOpen(group.id) } : undefined}
               onMouseLeave={fine ? scheduleClose : undefined}>
            <button
              ref={el => (triggers.current[group.id] = el)}
              aria-expanded={isOpen}
              aria-haspopup="true"
              onClick={() => setOpen(isOpen ? null : group.id)}
              className="ft-m-press flex items-center gap-1.5 rounded-lg text-sm font-medium"
              style={{
                minHeight: 40, padding: '0 12px', cursor: 'pointer',
                background: isOpen || active ? 'var(--accent-dim)' : 'transparent',
                border: 0,
                color: isOpen || active ? 'var(--accent-ink, var(--accent))' : 'var(--text-2)',
              }}
            >
              {group.label}
              <ChevronDown size={14} aria-hidden="true" className="ft-mega-chev"
                           style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
            </button>

            <MegaPanel open={isOpen} fine={fine} onEnter={cancelClose} onLeave={scheduleClose}>
              <div className="flex gap-3">
                <div style={{ minWidth: 268, maxWidth: 300 }}>
                  <ul className="flex flex-col gap-0.5 m-0 p-0" style={{ listStyle: 'none' }}>
                    {group.items.map(item => {
                      const here = item.to === pathname
                      return (
                        <li key={item.to}>
                          <Link
                            to={item.to}
                            aria-current={here ? 'page' : undefined}
                            onMouseEnter={() => setHovered(h => ({ ...h, [group.id]: item.to }))}
                            onFocus={() => setHovered(h => ({ ...h, [group.id]: item.to }))}
                            className="ft-mega-item block rounded-lg px-3 py-2.5"
                            style={{ textDecoration: 'none' }}
                          >
                            <span className="block font-bold"
                                  style={{ fontSize: 13.5, color: here ? 'var(--accent-ink, var(--accent))' : 'var(--text-1)' }}>
                              {item.label}
                            </span>
                            <span className="block" style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-3)' }}>
                              {item.blurb}
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                  {group.id === 'product' && <NewStrip onClick={() => close()} />}
                </div>
                <Preview items={group.items} current={current} />
              </div>
            </MegaPanel>
          </div>
        )
      })}
    </div>
  )
}
