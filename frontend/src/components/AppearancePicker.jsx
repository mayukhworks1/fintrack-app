import { useRef } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { PALETTES, MODES } from '../theme/themeStore'

const PALETTE_META = {
  graphite: { label: 'Graphite', note: 'Quiet greys, system blue' },
  indigo:   { label: 'Indigo',   note: 'Deep indigo, violet highlights' },
  emerald:  { label: 'Emerald',  note: 'Warm paper, teal and green' },
}

const MODE_META = {
  light:  { label: 'Light',  Icon: Sun },
  dark:   { label: 'Dark',   Icon: Moon },
  system: { label: 'System', Icon: Monitor },
}

/**
 * Arrow keys move the selection inside a radio group, as the ARIA radio
 * pattern expects; only the checked option is in the tab order.
 */
function useRadioKeys(values, current, onPick) {
  const refs = useRef({})
  const onKeyDown = (e) => {
    const i = values.indexOf(current)
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = values[(i + 1) % values.length]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = values[(i - 1 + values.length) % values.length]
    else if (e.key === 'Home') next = values[0]
    else if (e.key === 'End') next = values[values.length - 1]
    if (next == null) return
    e.preventDefault()
    onPick(next)
    refs.current[next]?.focus()
  }
  return { refs, onKeyDown }
}

/** A miniature of the app in one palette: rail, page, a card, an accent and a chart. */
function PalettePreview({ palette }) {
  return (
    <div className="theme-preview appearance-preview" data-palette={palette} aria-hidden="true">
      <div className="appearance-preview-rail">
        <span className="appearance-preview-dot" />
        <span className="appearance-preview-line" />
        <span className="appearance-preview-line is-active" />
        <span className="appearance-preview-line" />
      </div>
      <div className="appearance-preview-page">
        <div className="appearance-preview-card">
          <span className="appearance-preview-text" />
          <span className="appearance-preview-text is-short" />
          <div className="appearance-preview-bars">
            <i style={{ height: '55%', background: 'var(--chart-1)' }} />
            <i style={{ height: '80%', background: 'var(--chart-2)' }} />
            <i style={{ height: '40%', background: 'var(--chart-3)' }} />
            <i style={{ height: '68%', background: 'var(--chart-4)' }} />
            <i style={{ height: '30%', background: 'var(--chart-5)' }} />
          </div>
        </div>
        <span className="appearance-preview-button" />
      </div>
    </div>
  )
}

export default function AppearancePicker() {
  const theme = useTheme() || {}
  const palette = theme.palette || 'graphite'
  const mode = theme.mode || (theme.dark ? 'dark' : 'light')
  const setPalette = theme.setPalette || (() => {})
  const setMode = theme.setMode || (() => {})

  const paletteKeys = useRadioKeys(PALETTES, palette, setPalette)
  const modeKeys = useRadioKeys(MODES, mode, setMode)

  return (
    <div className="space-y-4">
      <div>
        <p id="appearance-palette-label" className="text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>Palette</p>
        <div
          role="radiogroup"
          aria-labelledby="appearance-palette-label"
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          onKeyDown={paletteKeys.onKeyDown}
        >
          {PALETTES.map(id => {
            const on = id === palette
            return (
              <button
                key={id}
                ref={el => { paletteKeys.refs.current[id] = el }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => setPalette(id)}
                className="appearance-swatch"
                data-on={on || undefined}
              >
                <PalettePreview palette={id} />
                <span className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-3">
                  <span className="min-w-0 text-left">
                    <span className="block text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{PALETTE_META[id].label}</span>
                    <span className="block text-[11px] truncate" style={{ color: 'var(--text-3)' }}>{PALETTE_META[id].note}</span>
                  </span>
                  <span className="appearance-check" aria-hidden="true">{on && <Check size={11} strokeWidth={3} />}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <p id="appearance-mode-label" className="text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>Mode</p>
        <div
          role="radiogroup"
          aria-labelledby="appearance-mode-label"
          className="appearance-segment"
          onKeyDown={modeKeys.onKeyDown}
        >
          {MODES.map(id => {
            const on = id === mode
            const { label, Icon } = MODE_META[id]
            return (
              <button
                key={id}
                ref={el => { modeKeys.refs.current[id] = el }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => setMode(id)}
                data-on={on || undefined}
              >
                <Icon size={13} aria-hidden="true" /> {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
