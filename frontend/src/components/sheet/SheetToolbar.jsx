import { memo, useRef } from 'react'
import {
  Undo2, Redo2, BetweenHorizontalStart, BetweenHorizontalEnd, BetweenVerticalStart, BetweenVerticalEnd,
  Trash2, ArrowDownAZ, ArrowDownZA, AlignLeft, AlignCenter, AlignRight, WrapText, Heading, Snowflake,
  Sigma, Search, Upload, Download, MoreHorizontal, MoveHorizontal, ArrowLeft, ArrowRight,
} from 'lucide-react'
import { FORMATS } from '../../utils/sheet'

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl+'
export const shortcut = keys => keys.replace(/Mod\+/g, MOD)

const FORMAT_SHORT = { auto: 'Auto', text: 'Text', number: 'Number', inr: '₹ Rupee', percent: '% Percent', date: 'Date' }

function Btn({ label, keys, onClick, disabled, pressed, children, wide, popup, expanded }) {
  const tip = keys ? `${label} (${shortcut(keys)})` : label
  return (
    <button type="button" className={'ft-sheet-tb' + (wide ? ' is-wide' : '')} aria-label={label} title={tip}
      aria-pressed={pressed === undefined ? undefined : !!pressed} disabled={disabled}
      aria-haspopup={popup || undefined} aria-expanded={popup ? !!expanded : undefined}
      onMouseDown={e => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  )
}

const Sep = () => <span className="ft-sheet-sep" aria-hidden="true" />

/** Compact icon toolbar; wraps on desktop and scrolls sideways on a phone. */
function SheetToolbar({ state, act }) {
  const fileRef = useRef(null)
  const { canUndo, canRedo, format, align, wrap, header, multiRows, multiCols, menuFor } = state
  const rowWord = multiRows ? 'Rows' : 'Row'
  const colWord = multiCols ? 'Columns' : 'Column'
  const type = format?.type || 'auto'
  return (
    <div className="ft-sheet-bar" role="toolbar" aria-label="Sheet tools">
      <Btn label="Undo" keys="Mod+Z" onClick={act.undo} disabled={!canUndo}><Undo2 size={16} /></Btn>
      <Btn label="Redo" keys="Mod+Y" onClick={act.redo} disabled={!canRedo}><Redo2 size={16} /></Btn>
      <Sep />
      <Btn label="Insert row above" onClick={() => act.insertRows(false)}><BetweenHorizontalStart size={16} /></Btn>
      <Btn label="Insert row below" onClick={() => act.insertRows(true)}><BetweenHorizontalEnd size={16} /></Btn>
      <Btn label="Insert column left" onClick={() => act.insertCols(false)}><BetweenVerticalStart size={16} /></Btn>
      <Btn label="Insert column right" onClick={() => act.insertCols(true)}><BetweenVerticalEnd size={16} /></Btn>
      <Btn label={`Delete ${rowWord.toLowerCase()}`} onClick={act.deleteRows} wide>
        <Trash2 size={14} aria-hidden="true" /><span className="ft-sheet-tb-text">{rowWord}</span>
      </Btn>
      <Btn label={`Delete ${colWord.toLowerCase()}`} onClick={act.deleteCols} wide>
        <Trash2 size={14} aria-hidden="true" /><span className="ft-sheet-tb-text">{colWord}</span>
      </Btn>
      <Sep />
      <Btn label="Sort A to Z by this column" onClick={() => act.sort(true)}><ArrowDownAZ size={16} /></Btn>
      <Btn label="Sort Z to A by this column" onClick={() => act.sort(false)}><ArrowDownZA size={16} /></Btn>
      <Sep />
      <select className="ft-sheet-select" aria-label="Column format" title="Column format" value={type}
        onChange={e => act.format(e.target.value)}>
        {FORMATS.map(f => <option key={f.type} value={f.type}>{FORMAT_SHORT[f.type] || f.label}</option>)}
      </select>
      <Btn label=".0 fewer decimal places" onClick={() => act.decimals(-1)}>
        <span className="ft-sheet-tb-text">.0</span><ArrowLeft size={11} aria-hidden="true" />
      </Btn>
      <Btn label=".00 more decimal places" onClick={() => act.decimals(1)}>
        <span className="ft-sheet-tb-text">.00</span><ArrowRight size={11} aria-hidden="true" />
      </Btn>
      <Sep />
      <Btn label="Align left" onClick={() => act.align('left')} pressed={align === 'left'}><AlignLeft size={16} /></Btn>
      <Btn label="Align centre" onClick={() => act.align('center')} pressed={align === 'center'}><AlignCenter size={16} /></Btn>
      <Btn label="Align right" onClick={() => act.align('right')} pressed={align === 'right'}><AlignRight size={16} /></Btn>
      <Btn label="Wrap text" onClick={act.wrap} pressed={wrap}><WrapText size={16} /></Btn>
      <Btn label="Column width" keys="Alt+Shift+←/→" onClick={act.width}><MoveHorizontal size={16} /></Btn>
      <Sep />
      <Btn label="Header row" onClick={act.header} pressed={header}><Heading size={16} /></Btn>
      <Btn label="Freeze rows and columns" popup="menu" expanded={menuFor === 'freeze'}
        onClick={e => act.freezeMenu(e.currentTarget, e.detail === 0)}><Snowflake size={16} /></Btn>
      <Sep />
      <Btn label="AutoSum" keys="Alt+=" onClick={act.autoSum}><Sigma size={16} /></Btn>
      <Btn label="Find" keys="Mod+F" onClick={act.find}><Search size={16} /></Btn>
      <Sep />
      <Btn label="Import CSV" onClick={() => fileRef.current?.click()}><Upload size={16} /></Btn>
      <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) act.importFile(f) }} />
      <Btn label="Download CSV" onClick={act.download}><Download size={16} /></Btn>
      <Btn label="Cell actions" keys="Shift+F10" popup="menu" expanded={menuFor === 'more'}
        onClick={e => act.moreMenu(e.currentTarget, e.detail === 0)}><MoreHorizontal size={16} /></Btn>
    </div>
  )
}

export default memo(SheetToolbar)
