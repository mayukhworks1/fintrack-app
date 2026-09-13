import { createContext, useContext, useState, useEffect } from 'react'

const ThemeCtx = createContext(null)

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('fintrack-theme')
    return saved ? saved === 'dark' : false // default light
  })

  useEffect(() => {
    const html = document.documentElement
    // :root = light, html.dark = dark  (no .light class needed)
    html.classList.remove('light', 'dark')
    if (dark) html.classList.add('dark')
    localStorage.setItem('fintrack-theme', dark ? 'dark' : 'light')
  }, [dark])

  /**
   * Flip the theme, wiping the new one in as a circle from wherever the
   * request came from.
   *
   * View transitions are progressive: where the API is missing the callback
   * runs immediately and the existing 0.3s background transition on body
   * carries the change, which is what happened before this existed. The
   * circle is clipped from the pointer's last position, so the theme appears
   * to spread from the button that was pressed rather than the page flipping
   * colour all at once.
   */
  const toggle = (e) => {
    const flip = () => setDark(d => !d)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || !document.startViewTransition) return flip()

    const x = e?.clientX ?? window.innerWidth - 72
    const y = e?.clientY ?? 30
    const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))

    const t = document.startViewTransition(() => flip())
    t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.22,1,0.36,1)',
          pseudoElement: '::view-transition-new(root)' }
      )
    }).catch(() => {})
  }

  return (
    <ThemeCtx.Provider value={{ dark, toggle }}>
      {children}
    </ThemeCtx.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeCtx)
}
