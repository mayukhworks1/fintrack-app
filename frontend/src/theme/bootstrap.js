import { bootstrapTheme } from './themeStore'

bootstrapTheme()

// The height the browser actually paints. Home-screen apps on iOS 26 can
// size 100vh/100dvh taller than the visible screen, which pushes the phone
// tab bar into an unpainted strip at the bottom. innerHeight is the real
// layout viewport, so the phone shell is sized from it (app-mobile.css).
function trackViewportHeight() {
  if (typeof window === 'undefined') return
  const root = document.documentElement
  const set = () => {
    const h = window.innerHeight
    const standalone = window.navigator.standalone === true
      || window.matchMedia?.('(display-mode: standalone)').matches
    const portrait = window.innerWidth < h
    const full = portrait ? window.screen.height : window.screen.width
    // iOS 26 home-screen apps with an opaque status bar: the page starts
    // below the status bar (innerHeight = screen - bar) but iOS still stops
    // drawing at innerHeight measured from the top of the screen, so the
    // bottom `gap` of the page is never painted. Measured on an iPhone 17
    // Pro Max: screen 956, innerHeight 894, nothing drawn below 832.
    const gap = full - h
    const clipped = standalone && portrait && gap > 0 && gap < 140
    root.style.setProperty('--app-vh', `${clipped ? h - gap : h}px`)
    root.classList.toggle('ios-clip', clipped)
  }
  set()
  window.addEventListener('resize', set)
  window.addEventListener('orientationchange', () => setTimeout(set, 250))
  window.addEventListener('pageshow', set)
}
trackViewportHeight()
