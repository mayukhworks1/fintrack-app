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

  const toggle = () => setDark(d => !d)

  return (
    <ThemeCtx.Provider value={{ dark, toggle }}>
      {children}
    </ThemeCtx.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeCtx)
}
