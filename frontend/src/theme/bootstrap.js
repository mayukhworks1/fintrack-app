import { bootstrapTheme } from './themeStore'

bootstrapTheme()

// The height the browser actually paints. Home-screen apps on iOS 26 can
// size 100vh/100dvh taller than the visible screen, which pushes the phone
// tab bar into an unpainted strip at the bottom. innerHeight is the real
// layout viewport, so the phone shell is sized from it (app-mobile.css).
function trackViewportHeight() {
  if (typeof window === 'undefined') return
  const root = document.documentElement
  const set = () => root.style.setProperty('--app-vh', `${window.innerHeight}px`)
  set()
  window.addEventListener('resize', set)
  window.addEventListener('orientationchange', () => setTimeout(set, 250))
  window.addEventListener('pageshow', set)
}
trackViewportHeight()
