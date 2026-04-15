import { createContext, useContext, useState, useEffect } from 'react'

const ThemeCtx = createContext(null)

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('fintrack-theme')
    return saved ? saved === 'dark' : true // default dark
  })

  useEffect(() => {
    const html = document.documentElement
    if (dark) {
      html.classList.remove('light')
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
      html.classList.add('light')
    }
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
