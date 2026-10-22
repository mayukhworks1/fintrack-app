import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { applyTheme, darkQuery, readPrefs, resolveDark, savePrefs, normalizePrefs } from '../theme/themeStore'

const ThemeCtx = createContext(null)

/**
 * Appearance state: { palette, mode } where mode is 'light' | 'dark' |
 * 'system'. `dark` is the resolved value, so screens that only care whether
 * the lights are off keep reading it as before.
 *
 * main.jsx has already put the saved choice on <html> before this mounts
 * (themeStore.bootstrapTheme), so the first render agrees with the page.
 */
export function ThemeProvider({ children }) {
  const [prefs, setPrefs] = useState(readPrefs)
  const [systemDark, setSystemDark] = useState(() => resolveDark('system'))
  const applied = useRef(null)

  // Follow the OS while in 'system' mode, live.
  useEffect(() => {
    const mq = darkQuery()
    if (!mq) return undefined
    const onChange = (e) => setSystemDark(!!e.matches)
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener?.(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener?.(onChange)
    }
  }, [])

  const dark = prefs.mode === 'system' ? systemDark : prefs.mode === 'dark'

  useEffect(() => {
    // The first pass only re-asserts what main.jsx already applied; every
    // later change is a switch, gets the cross-fade, and is saved. Comparing
    // against the last applied value keeps StrictMode's double effect run
    // from counting as a switch.
    const key = `${prefs.palette}/${prefs.mode}/${dark}`
    if (applied.current === key) return
    const isSwitch = applied.current !== null
    applied.current = key
    applyTheme(prefs, { animate: isSwitch })
    if (isSwitch) savePrefs(prefs)
  }, [prefs, dark])

  const setPalette = useCallback((palette) => {
    setPrefs(p => normalizePrefs({ ...p, palette }))
  }, [])

  const setMode = useCallback((mode) => {
    setPrefs(p => normalizePrefs({ ...p, mode }))
  }, [])

  /** The sun / moon buttons: flip to the opposite of what is showing now. */
  const toggle = useCallback(() => {
    setPrefs(p => ({ ...p, mode: dark ? 'light' : 'dark' }))
  }, [dark])

  const value = useMemo(
    () => ({ dark, palette: prefs.palette, mode: prefs.mode, setPalette, setMode, toggle }),
    [dark, prefs.palette, prefs.mode, setPalette, setMode, toggle]
  )

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export function useTheme() {
  return useContext(ThemeCtx)
}
