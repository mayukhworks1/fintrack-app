/**
 * Spreadsheet engine behind Pages sheets: CSV/TSV, addresses, the formula
 * evaluator, number/date formats and the grid edits the editor applies.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  parseCSV, toCSV, csvToGrid, gridToCSV, parseLine, parseTSV, toTSV,
  colName, colIndex, cellName, parseRef, parseRange,
  createEvaluator, cellDisplay, FORMULA_FUNCTIONS, FUNCTION_HELP, ERROR_HELP, isErrorValue, isFormula, formulaRefs,
  toNumber, isNumeric, dateSerial, formatDate, FORMATS, formatValue,
  shiftFormula, insertRows, deleteRows, insertCols, deleteCols, shiftColMeta, sortRows, fillSeries, moveRange,
} from '../utils/sheet'

afterEach(() => { vi.useRealTimers() })

// Evaluates `formula` in column Z of a new row under `data` and returns its value.
function calc(formula, data = []) {
  const grid = [...data.map(r => [...r]), [...new Array(25).fill(''), formula]]
  return createEvaluator(grid).value(grid.length - 1, 25)
}

// Every cell's display text.
function displayAll(grid) {
  const ev = createEvaluator(grid)
  return grid.map((row, r) => row.map((_, c) => ev.display(r, c)))
}

// The engine this module replaced, kept verbatim as a fixture so existing
// sheets can be checked to compute the same results.
function legacyEngine() {
  const FORMULA_FUNCTIONS = ['SUM','AVERAGE','AVG','MIN','MAX','COUNT','COUNTA','PRODUCT','ROUND','ABS','SQRT','POWER','MEDIAN']
  function parseLine(line) {
    const r=[]; let c=''; let q=false
    for(let i=0;i<line.length;i++){
      if(line[i]==='"'){if(q&&line[i+1]==='"'){c+='"';i++}else q=!q}
      else if(line[i]===','&&!q){r.push(c.trim());c=''}
      else c+=line[i]
    }
    r.push(c.trim()); return r
  }
  function csvToGrid(text) {
    if (!text?.trim()) return [['','',''],['','',''],['','','']]
    const lines = text.trim().split('\n').filter(Boolean)
    const rows = lines.map(parseLine)
    const cols = Math.max(...rows.map(r=>r.length), 1)
    return rows.map(r => { while(r.length<cols) r.push(''); return r })
  }
  function colToIdx(s) { let n=0; for (const ch of s.toUpperCase()) n=n*26+(ch.charCodeAt(0)-64); return n-1 }
  function parseRef(ref) {
    const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim())
    if (!m) return null
    return { c: colToIdx(m[1]), r: parseInt(m[2],10)-1 }
  }
  function cellRaw(grid, r, c) { return grid[r]?.[c] ?? '' }
  function cellEval(grid, r, c, visiting) {
    const raw = cellRaw(grid, r, c)
    if (typeof raw === 'string' && raw.trim().startsWith('=')) {
      const key = r+':'+c
      if (visiting.has(key)) return '#CIRC'
      visiting.add(key)
      const out = evalFormula(raw, grid, visiting)
      visiting.delete(key)
      return out
    }
    return raw
  }
  function cellNum(grid, r, c, visiting) { const n = parseFloat(cellEval(grid, r, c, visiting)); return isNaN(n) ? 0 : n }
  function expandArgNums(arg, grid, visiting) {
    arg = arg.trim()
    if (!arg) return { nums: [], nonEmpty: 0 }
    if (arg.includes(':')) {
      const [a, b] = arg.split(':')
      const pa = parseRef(a), pb = parseRef(b)
      if (!pa || !pb) return { nums: [], nonEmpty: 0 }
      const nums = []; let nonEmpty = 0
      for (let r=Math.min(pa.r,pb.r); r<=Math.max(pa.r,pb.r); r++)
        for (let c=Math.min(pa.c,pb.c); c<=Math.max(pa.c,pb.c); c++) {
          const v = cellEval(grid, r, c, visiting)
          if (v !== '' && v != null) nonEmpty++
          const n = parseFloat(v); if (!isNaN(n)) nums.push(n)
        }
      return { nums, nonEmpty }
    }
    const p = parseRef(arg)
    if (p) { const v = cellEval(grid, p.r, p.c, visiting); const n = parseFloat(v); return { nums: isNaN(n)?[]:[n], nonEmpty: (v!==''&&v!=null)?1:0 } }
    const val = evalArith(arg.replace(/\$?[A-Za-z]+\$?\d+/g, (ref) => { const pr=parseRef(ref); return pr?String(cellNum(grid,pr.r,pr.c,visiting)):'0' }))
    return { nums: val==null?[]:[val], nonEmpty: val==null?0:1 }
  }
  function applyFn(name, argStr, grid, visiting) {
    const args = splitArgs(argStr)
    const fname = name.toUpperCase()
    let nums = [], nonEmpty = 0
    for (const a of args) { const r = expandArgNums(a, grid, visiting); nums = nums.concat(r.nums); nonEmpty += r.nonEmpty }
    switch (fname) {
      case 'SUM':     return nums.reduce((a,b)=>a+b,0)
      case 'AVERAGE':
      case 'AVG':     return nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : 0
      case 'MIN':     return nums.length ? Math.min(...nums) : 0
      case 'MAX':     return nums.length ? Math.max(...nums) : 0
      case 'COUNT':   return nums.length
      case 'COUNTA':  return nonEmpty
      case 'PRODUCT': return nums.reduce((a,b)=>a*b,1)
      case 'MEDIAN': { if(!nums.length) return 0; const s=[...nums].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2 }
      case 'ROUND': { const x=nums[0]??0, d=args[1]!=null?parseInt(args[1],10):0; const f=Math.pow(10,isNaN(d)?0:d); return Math.round(x*f)/f }
      case 'ABS':     return Math.abs(nums[0]??0)
      case 'SQRT':    return Math.sqrt(nums[0]??0)
      case 'POWER':   return Math.pow(nums[0]??0, nums[1]??0)
      default:        return '#NAME?'
    }
  }
  function splitArgs(s) {
    const out = []; let depth = 0, cur = ''
    for (const ch of s) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
    }
    if (cur.trim() !== '' || out.length) out.push(cur)
    return out
  }
  function evalArith(expr) {
    const tokens = expr.match(/(\d+\.?\d*|\.\d+|[+\-*/()%])/g)
    if (!tokens) return null
    const out = [], ops = []
    const prec = { '+':1,'-':1,'*':2,'/':2,'%':2 }
    let prev = null
    for (let t of tokens) {
      if (/^[\d.]/.test(t)) { out.push(parseFloat(t)); prev = 'num' }
      else if (t === '(') { ops.push(t); prev = '(' }
      else if (t === ')') { while (ops.length && ops[ops.length-1] !== '(') out.push(ops.pop()); ops.pop(); prev = 'num' }
      else {
        if (t === '-' && (prev === null || prev === '(' || prev === 'op')) out.push(0)
        while (ops.length && ops[ops.length-1] !== '(' && prec[ops[ops.length-1]] >= prec[t]) out.push(ops.pop())
        ops.push(t); prev = 'op'
      }
    }
    while (ops.length) out.push(ops.pop())
    const st = []
    for (const tk of out) {
      if (typeof tk === 'number') st.push(tk)
      else { const b = st.pop(), a = st.pop(); if (a==null||b==null) return null
        st.push(tk==='+'?a+b:tk==='-'?a-b:tk==='*'?a*b:tk==='%'?a%b:a/b) }
    }
    const r = st.pop()
    return (r==null || !isFinite(r)) ? null : r
  }
  function evalFormula(raw, grid, visiting = new Set()) {
    try {
      let s = String(raw).trim().replace(/^=/, '')
      const fnRe = /([A-Za-z][A-Za-z0-9]*)\s*\(([^()]*)\)/
      let guard = 0
      while (fnRe.test(s) && guard++ < 200) {
        s = s.replace(fnRe, (m, name, args) => {
          if (FORMULA_FUNCTIONS.includes(name.toUpperCase())) return `(${applyFn(name, args, grid, visiting)})`
          return `(${args})`
        })
      }
      s = s.replace(/\$?[A-Za-z]+\$?\d+/g, (ref) => { const p = parseRef(ref); return p ? String(cellNum(grid, p.r, p.c, visiting)) : '0' })
      const val = evalArith(s)
      if (val == null) return '#ERR'
      return String(Math.round(val * 1e10) / 1e10)
    } catch { return '#ERR' }
  }
  function cellDisplay(grid, r, c) {
    const raw = cellRaw(grid, r, c)
    if (typeof raw === 'string' && raw.trim().startsWith('=')) return evalFormula(raw, grid, new Set([r+':'+c]))
    return raw
  }
  return { FORMULA_FUNCTIONS, csvToGrid, cellDisplay }
}

describe('CSV', () => {
  it('parses quotes, escaped quotes and commas or newlines inside quotes', () => {
    expect(parseCSV('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCSV('"Mumbai, MH",5')).toEqual([['Mumbai, MH', '5']])
    expect(parseCSV('"He said ""hi""",x')).toEqual([['He said "hi"', 'x']])
    expect(parseCSV('"line1\nline2",x\ny,z')).toEqual([['line1\nline2', 'x'], ['y', 'z']])
    expect(parseCSV('a,,c')).toEqual([['a', '', 'c']])
  })

  it('handles CRLF and CR line endings and a byte order mark', () => {
    expect(parseCSV('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCSV('a\rb')).toEqual([['a'], ['b']])
    expect(parseCSV('"x\r\ny",z\r\n')).toEqual([['x\r\ny', 'z']])
    expect(parseCSV('﻿Name,Amt')).toEqual([['Name', 'Amt']])
  })

  it('keeps blank rows between rows and drops trailing empty lines', () => {
    expect(parseCSV('a,b\n\n1,2')).toEqual([['a', 'b'], [''], ['1', '2']])
    expect(csvToGrid('a,b\n\n1,2')).toEqual([['a', 'b'], ['', ''], ['1', '2']])
    expect(parseCSV('a\n\n\n')).toEqual([['a']])
    expect(parseCSV('a,b\n,\n')).toEqual([['a', 'b'], ['', '']])
  })

  it('trims unquoted fields but keeps quoted fields exactly', () => {
    expect(parseCSV('  a  , " b " ,c ')).toEqual([['a', ' b ', 'c']])
    expect(parseLine('a, "b,c" ,d')).toEqual(['a', 'b,c', 'd'])
    expect(parseLine('')).toEqual([''])
  })

  it('quotes fields with commas, quotes, line breaks or edge spaces', () => {
    expect(toCSV([['a,b', 'x"y', ' lead', 'trail ', 'plain', 'line\nbreak', 'cr\rx']]))
      .toBe('"a,b","x""y"," lead","trail ",plain,"line\nbreak","cr\rx"')
    expect(toCSV([[1, null, undefined, true]])).toBe('1,,,true')
  })

  it('round-trips awkward grids, blank rows included', () => {
    const grid = [
      ['Name', 'Note', 'Amount'],
      ['Asha', 'Said "ok", then left', '1,20,000'],
      ['', '', ''],
      [' spaced ', 'two\nlines', '=SUM(C2:C3)'],
      ['', '', ''],
    ]
    expect(csvToGrid(gridToCSV(grid))).toEqual(grid)
    expect(gridToCSV([['a', 'b'], ['', ''], ['1', '2'], ['', '']])).toBe('a,b\n,\n1,2\n,')
    const single = [['a'], [''], ['b'], ['']]
    expect(toCSV(single)).toBe('a\n""\nb\n""')
    expect(csvToGrid(toCSV(single))).toEqual(single)
  })

  it('builds rectangular grids and a blank 3×3 grid for empty text', () => {
    const blank = [['', '', ''], ['', '', ''], ['', '', '']]
    expect(csvToGrid('')).toEqual(blank)
    expect(csvToGrid('  \n ')).toEqual(blank)
    expect(csvToGrid(undefined)).toEqual(blank)
    expect(csvToGrid('a,b,c\n1')).toEqual([['a', 'b', 'c'], ['1', '', '']])
  })
})

describe('clipboard TSV', () => {
  it('parses Excel clipboard text with quoted multi-line cells', () => {
    const text = 'Name\tNote\r\nAsha\t"Line 1\nLine 2"\r\nRavi\t"Said ""ok"""\r\n'
    expect(parseTSV(text)).toEqual([['Name', 'Note'], ['Asha', 'Line 1\nLine 2'], ['Ravi', 'Said "ok"']])
  })

  it('takes stray quotes literally, keeps spaces and pads ragged rows', () => {
    expect(parseTSV('5\'10"\tx')).toEqual([['5\'10"', 'x']])
    expect(parseTSV('"abc" def\tx')).toEqual([['"abc" def', 'x']])
    expect(parseTSV(' a \t b')).toEqual([[' a ', ' b']])
    expect(parseTSV('a\tb\tc\nd')).toEqual([['a', 'b', 'c'], ['d', '', '']])
    expect(parseTSV('a\t')).toEqual([['a', '']])
    expect(parseTSV('hello')).toEqual([['hello']])
    expect(parseTSV('')).toEqual([])
    expect(parseTSV('\r\n')).toEqual([['']])
  })

  it('writes TSV that parses back to the same grid', () => {
    const grid = [['a', 'b\nc'], ['"q"', 'x"y'], ['tab\there', '']]
    const text = toTSV(grid)
    expect(text.split('\n')[0]).toBe('a\t"b')
    expect(text).toContain('\tx"y\n')
    expect(parseTSV(text)).toEqual(grid)
  })
})

describe('addresses', () => {
  it('converts column letters both ways', () => {
    const pairs = [[0, 'A'], [25, 'Z'], [26, 'AA'], [51, 'AZ'], [52, 'BA'], [701, 'ZZ'], [702, 'AAA']]
    for (const [i, name] of pairs) {
      expect(colName(i)).toBe(name)
      expect(colIndex(name)).toBe(i)
    }
    expect(colIndex('ab')).toBe(27)
    expect(colIndex('1')).toBe(-1)
    expect(cellName(2, 1)).toBe('B3')
  })

  it('parses references with $ anchors', () => {
    expect(parseRef('$B$3')).toEqual({ r: 2, c: 1, absR: true, absC: true })
    expect(parseRef('b3')).toEqual({ r: 2, c: 1, absR: false, absC: false })
    expect(parseRef('C$10')).toEqual({ r: 9, c: 2, absR: true, absC: false })
    expect(parseRef('$C10')).toEqual({ r: 9, c: 2, absR: false, absC: true })
    expect(parseRef('A0')).toBeNull()
    expect(parseRef('3B')).toBeNull()
  })

  it('parses and normalises ranges', () => {
    expect(parseRange('D9:B2')).toEqual({ r1: 1, c1: 1, r2: 8, c2: 3 })
    expect(parseRange('C10')).toEqual({ r1: 9, c1: 2, r2: 9, c2: 2 })
    expect(parseRange('A:C', { rows: 10, cols: 5 })).toEqual({ r1: 0, c1: 0, r2: 9, c2: 2 })
    expect(parseRange('3:2', { rows: 10, cols: 5 })).toEqual({ r1: 1, c1: 0, r2: 2, c2: 4 })
    expect(parseRange('A:C')).toBeNull()
    expect(parseRange('nope')).toBeNull()
  })
})

describe('formula language', () => {
  it('follows Excel operator precedence', () => {
    expect(calc('=2+3*4')).toBe(14)
    expect(calc('=(2+3)*4')).toBe(20)
    expect(calc('=10-2-3')).toBe(5)
    expect(calc('=8/2/2')).toBe(2)
    expect(calc('=2^3^2')).toBe(64)
    expect(calc('=-2^2')).toBe(4)
    expect(calc('=2^-1')).toBe(0.5)
    expect(calc('=--3')).toBe(3)
    expect(calc('=1+2&"x"')).toBe('3x')
    expect(calc('="a"&1+1')).toBe('a2')
    expect(calc('=1+1=2')).toBe(true)
    expect(calc('=2*3>5')).toBe(true)
    expect(calc('=3<>3')).toBe(false)
  })

  it('reads postfix percent, and a%b as the remainder older sheets used', () => {
    expect(calc('=50%')).toBe(0.5)
    expect(calc('=200*18%')).toBe(36)
    expect(calc('=-5%')).toBe(-0.05)
    expect(calc('=10%-3')).toBeCloseTo(-2.9)
    expect(calc('=10%3')).toBe(1)
    expect(calc('=10%0')).toBe('#DIV/0!')
  })

  it('compares like Excel: case-insensitive text, numbers before text, tolerant floats', () => {
    expect(calc('="A"="a"')).toBe(true)
    expect(calc('="b">"A"')).toBe(true)
    expect(calc('=1<"a"')).toBe(true)
    expect(calc('="a"<TRUE')).toBe(true)
    expect(calc('=0.1+0.2=0.3')).toBe(true)
    expect(calc('=A1=0', [['']])).toBe(true)
    expect(calc('=A1=""', [['']])).toBe(true)
  })

  it('handles strings, booleans and escaped quotes', () => {
    expect(calc('="He said ""hi"""')).toBe('He said "hi"')
    expect(calc('=TRUE')).toBe(true)
    expect(calc('=true+1')).toBe(2)
    expect(calc('=""')).toBe('')
  })

  it('resolves relative, absolute and mixed references, ranges, whole columns and rows', () => {
    const data = [['1', '2'], ['3', '4']]
    expect(calc('=$A$1+A$2+$B1+B2', data)).toBe(10)
    expect(calc('=SUM(A1:B2)', data)).toBe(10)
    expect(calc('=SUM(B2:A1)', data)).toBe(10)
    expect(calc('=SUM(B:B)', data)).toBe(6)
    expect(calc('=SUM($A:$B)', data)).toBe(10)
    expect(calc('=SUM(2:2)', data)).toBe(7)
    expect(calc('=SUM(A1 : A2)', data)).toBe(4)
    expect(calc('=A1:A1', data)).toBe(1)
    expect(calc('=A1:A2', data)).toBe('#VALUE!')
    expect(calc('=Y99', data)).toBe(0)
  })

  it('treats empty cells as 0 in arithmetic and "" in text, and coerces numeric text', () => {
    const data = [['', '1,20,000', '₹1,200', '12abc', '15/10/2026']]
    expect(calc('=A1')).toBe(0)
    expect(calc('=A1+1', data)).toBe(1)
    expect(calc('=A1&"x"', data)).toBe('x')
    expect(calc('=B1*2', data)).toBe(240000)
    expect(calc('=C1+1', data)).toBe(1201)
    expect(calc('="(500)"+0')).toBe(-500)
    expect(calc('=D1+1', data)).toBe(1)
    expect(calc('=E1+1', data)).toBe(46311)
  })

  it('is case-insensitive for function names and tolerates spaces', () => {
    expect(calc('=sum(1, 2)')).toBe(3)
    expect(calc('= Sum ( 1 ,2 ) ')).toBe(3)
    expect(calc(' =1+1')).toBe(2)
  })

  it('reports the documented errors', () => {
    expect(calc('=1/0')).toBe('#DIV/0!')
    expect(calc('=FOO(1)')).toBe('#NAME?')
    expect(calc('=foo')).toBe('#NAME?')
    expect(calc('=SUM(1,')).toBe('#ERROR!')
    expect(calc('=(1+2')).toBe('#ERROR!')
    expect(calc('=1 2')).toBe('#ERROR!')
    expect(calc('=')).toBe('#ERROR!')
    expect(calc('="abc"+1')).toBe('#VALUE!')
    expect(calc('=#REF!+1')).toBe('#REF!')
    expect(calc('=SUM(#REF!)')).toBe('#REF!')
    expect(calc('=IF(1)')).toBe('#VALUE!')
    expect(calc('=A1+1', [['=1/0']])).toBe('#DIV/0!')
    expect(calc('=POWER(10, 400)')).toBe('#VALUE!')
    expect(Object.keys(ERROR_HELP).sort()).toEqual(['#CIRC!', '#DIV/0!', '#ERROR!', '#N/A', '#NAME?', '#REF!', '#VALUE!'])
    expect(isErrorValue('#N/A')).toBe(true)
    expect(isErrorValue('N/A')).toBe(false)
  })

  it('marks circular references and their dependents with #CIRC!', () => {
    const ev = createEvaluator([['=B1', '=A1', '=A1+1'], ['=A2+1', '=SUM(A3:A4)', '5'], ['=B2', '', '=C2*2']])
    expect(ev.value(0, 0)).toBe('#CIRC!')
    expect(ev.value(0, 1)).toBe('#CIRC!')
    expect(ev.value(0, 2)).toBe('#CIRC!')
    expect(ev.value(1, 0)).toBe('#CIRC!')
    expect(ev.value(1, 1)).toBe('#CIRC!')
    expect(ev.value(2, 0)).toBe('#CIRC!')
    expect(ev.value(2, 2)).toBe(10)
    expect(calc('=SUM(Z:Z)', [['1'], ['2']])).toBe('#CIRC!')
    expect(calc('=SUM(A:A)', [['1'], ['2']])).toBe(3)
  })

  it('evaluates 5,000-deep dependency chains in either direction without overflowing the stack', () => {
    const down = [['1']]
    for (let r = 1; r < 5000; r++) down.push([`=A${r}+1`])
    expect(createEvaluator(down).value(4999, 0)).toBe(5000)
    const up = []
    for (let r = 0; r < 5000; r++) up.push([r === 4999 ? '1' : `=A${r + 2}+1`])
    expect(createEvaluator(up).value(0, 0)).toBe(5000)
    const loop = []
    for (let r = 0; r < 5000; r++) loop.push([`=A${((r + 1) % 5000) + 1}+1`])
    const ev = createEvaluator(loop)
    expect(ev.value(0, 0)).toBe('#CIRC!')
    expect(ev.value(4999, 0)).toBe('#CIRC!')
  })

  it('returns values and display text for literals and formulas', () => {
    const grid = [['1,20,000', 'TRUE', ' text ', '', '=1/3', '=2>1', '=DATE(2026,10,15)', '=DATE(2026,10,15)+1']]
    const ev = createEvaluator(grid)
    expect(ev.value(0, 0)).toBe(120000)
    expect(ev.value(0, 1)).toBe(true)
    expect(ev.value(0, 2)).toBe(' text ')
    expect(ev.value(0, 3)).toBe('')
    expect(ev.value(9, 9)).toBe('')
    expect(ev.display(0, 0)).toBe('1,20,000')
    expect(ev.display(0, 4)).toBe('0.3333333333')
    expect(ev.display(0, 5)).toBe('TRUE')
    expect(ev.display(0, 6)).toBe('15 Oct 2026')
    expect(ev.display(0, 7)).toBe('46311')
    expect(ev.rows).toBe(1)
    expect(ev.cols).toBe(8)
  })

  it('applies column formats in display', () => {
    const grid = [['Amount'], ['1200'], ['=A2*2'], ['abc'], ['2026-10-15'], ['=1/0']]
    const ev = createEvaluator(grid)
    const inr = { type: 'inr' }
    expect(ev.display(1, 0, inr)).toBe('₹1,200.00')
    expect(ev.display(2, 0, inr)).toBe('₹2,400.00')
    expect(ev.display(3, 0, inr)).toBe('abc')
    expect(ev.display(0, 0, inr)).toBe('Amount')
    expect(ev.display(5, 0, inr)).toBe('#DIV/0!')
    expect(ev.display(1, 0, { type: 'text' })).toBe('1200')
    expect(ev.display(1, 0, { type: 'auto' })).toBe('1200')
    expect(ev.display(4, 0, { type: 'date' })).toBe('15 Oct 2026')
    expect(ev.display(1, 0, { type: 'number', decimals: 1 })).toBe('1,200.0')
  })

  it('keeps cellDisplay working for older callers', () => {
    const grid = [['2', '=A1*3']]
    expect(cellDisplay(grid, 0, 1)).toBe('6')
    expect(cellDisplay(grid, 0, 0)).toBe('2')
    expect(cellDisplay(grid, 5, 5)).toBe('')
    expect(cellDisplay(null, 0, 0)).toBe('')
  })

  it('lists formula references with their positions', () => {
    expect(formulaRefs('=SUM(A1:B2)+$C$3')).toEqual([
      { start: 5, end: 10, text: 'A1:B2', r1: 0, c1: 0, r2: 1, c2: 1 },
      { start: 12, end: 16, text: '$C$3', r1: 2, c1: 2, r2: 2, c2: 2 },
    ])
    expect(formulaRefs('=SUM(A1:').map(r => r.text)).toEqual(['A1'])
    expect(formulaRefs('=SUM(B:B)')[0]).toMatchObject({ c1: 1, c2: 1, r1: 0, r2: Infinity })
    expect(formulaRefs('="A1"&B1').map(r => r.text)).toEqual(['B1'])
    expect(formulaRefs('plain')).toEqual([])
    expect(isFormula(' =1')).toBe(true)
    expect(isFormula('a=1')).toBe(false)
    expect(isFormula(5)).toBe(false)
  })
})

describe('functions', () => {
  const DATA = [
    ['Name', 'Amount', 'Status', 'Date'],
    ['Asha', '1200', 'Paid', '2026-01-15'],
    ['Ravi', '450', 'Due', '15/02/2026'],
    ['Meera', '1,20,000', 'Paid', '15 Mar 2026'],
    ['Dev', '', 'Due', ''],
    ['Ira', '75.5', 'paid', '2026-04-01'],
  ]
  const f = formula => calc(formula, DATA)

  it('lists every function, sorted, with help text', () => {
    const required = ['SUM', 'AVERAGE', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTBLANK', 'PRODUCT', 'MEDIAN', 'ROUND', 'ROUNDUP',
      'ROUNDDOWN', 'INT', 'MOD', 'ABS', 'SQRT', 'POWER', 'IF', 'IFERROR', 'AND', 'OR', 'NOT', 'SUMIF', 'COUNTIF', 'AVERAGEIF',
      'SUMPRODUCT', 'CONCAT', 'CONCATENATE', 'TEXTJOIN', 'LEN', 'UPPER', 'LOWER', 'TRIM', 'LEFT', 'RIGHT', 'MID', 'PROPER',
      'VLOOKUP', 'XLOOKUP', 'INDEX', 'MATCH', 'TODAY', 'NOW', 'DATE', 'YEAR', 'MONTH', 'DAY', 'DAYS', 'EDATE']
    for (const name of required) expect(FORMULA_FUNCTIONS).toContain(name)
    expect(FORMULA_FUNCTIONS).toEqual([...FORMULA_FUNCTIONS].sort())
    expect(Object.keys(FUNCTION_HELP).sort()).toEqual(FORMULA_FUNCTIONS)
    for (const name of FORMULA_FUNCTIONS) {
      expect(FUNCTION_HELP[name].sig.startsWith(name + '(')).toBe(true)
      expect(FUNCTION_HELP[name].desc.length).toBeGreaterThan(5)
    }
    expect(FUNCTION_HELP.SUMIF).toEqual({ sig: 'SUMIF(range, criteria, [sum_range])', desc: 'Adds the cells that meet a condition.' })
  })

  it('aggregates numbers and skips text and blanks in ranges', () => {
    expect(f('=SUM(B2:B6)')).toBe(121725.5)
    expect(f('=SUM(B2:B3, 10, "5", TRUE)')).toBe(1666)
    expect(f('=AVERAGE(B2:B6)')).toBe(30431.375)
    expect(f('=AVG(B2:B3)')).toBe(825)
    expect(f('=MIN(B2:B6)')).toBe(75.5)
    expect(f('=MAX(B2:B6)')).toBe(120000)
    expect(f('=COUNT(B2:B6)')).toBe(4)
    expect(f('=COUNT(A1:D1)')).toBe(0)
    expect(f('=COUNTA(B2:B6)')).toBe(4)
    expect(f('=COUNTA(A1:D6)')).toBe(22)
    expect(f('=COUNTBLANK(B2:B6)')).toBe(1)
    expect(f('=COUNTBLANK(B2:B10)')).toBe(5)
    expect(f('=PRODUCT(B2:B3)')).toBe(540000)
    expect(f('=MEDIAN(B2:B6)')).toBe(825)
    expect(f('=MEDIAN(1, 3, 2)')).toBe(2)
    expect(f('=SUM("abc")')).toBe('#VALUE!')
    expect(f('=SUM(B2:B3, 1/0)')).toBe('#DIV/0!')
  })

  it('keeps the old engine results for empty input', () => {
    expect(f('=AVERAGE(Z1:Z5)')).toBe(0)
    expect(f('=MIN(Z1:Z5)')).toBe(0)
    expect(f('=MAX(Z1:Z5)')).toBe(0)
    expect(f('=MEDIAN(Z1:Z5)')).toBe(0)
    expect(f('=PRODUCT(Z1:Z5)')).toBe(1)
    expect(f('=SUM(Z1:Z5)')).toBe(0)
  })

  it('rounds like Excel', () => {
    expect(calc('=ROUND(2.345, 2)')).toBe(2.35)
    expect(calc('=ROUND(1.005, 2)')).toBe(1.01)
    expect(calc('=ROUND(-2.5, 0)')).toBe(-3)
    expect(calc('=ROUND(2.5)')).toBe(3)
    expect(calc('=ROUND(1234.5678, -2)')).toBe(1200)
    expect(calc('=ROUNDUP(3.21, 1)')).toBe(3.3)
    expect(calc('=ROUNDUP(1.1*3, 1)')).toBe(3.3)
    expect(calc('=ROUNDUP(-3.21, 0)')).toBe(-4)
    expect(calc('=ROUNDDOWN(3.99)')).toBe(3)
    expect(calc('=ROUNDDOWN(-3.99, 0)')).toBe(-3)
    expect(calc('=ROUNDDOWN(1234.5, -2)')).toBe(1200)
  })

  it('does integer and power maths with error cases', () => {
    expect(calc('=INT(-3.5)')).toBe(-4)
    expect(calc('=INT(3.9)')).toBe(3)
    expect(calc('=MOD(10, 3)')).toBe(1)
    expect(calc('=MOD(-1, 3)')).toBe(2)
    expect(calc('=MOD(5, 0)')).toBe('#DIV/0!')
    expect(calc('=ABS(-4)')).toBe(4)
    expect(calc('=SQRT(16)')).toBe(4)
    expect(calc('=SQRT(-1)')).toBe('#VALUE!')
    expect(calc('=POWER(2, 10)')).toBe(1024)
    expect(calc('=POWER(0, -1)')).toBe('#DIV/0!')
    expect(calc('=ABS("x")')).toBe('#VALUE!')
  })

  it('evaluates logic lazily', () => {
    expect(f('=IF(B2>1000, "high", "low")')).toBe('high')
    expect(f('=IF(B3>1000, "high")')).toBe(false)
    expect(f('=IF(TRUE, 1, 1/0)')).toBe(1)
    expect(f('=IF(B5, "x", "empty")')).toBe('empty')
    expect(f('=IF(A2, 1, 2)')).toBe('#VALUE!')
    expect(f('=IF(1/0, 1, 2)')).toBe('#DIV/0!')
    expect(f('=IF(B2>0,,1)')).toBe(0)
    expect(f('=IFERROR(1/0, "n/a")')).toBe('n/a')
    expect(f('=IFERROR(5, 0)')).toBe(5)
    expect(f('=IFERROR(VLOOKUP("Zed", A2:B6, 2, FALSE), "missing")')).toBe('missing')
    expect(f('=AND(TRUE, 1>0)')).toBe(true)
    expect(f('=AND(TRUE, FALSE)')).toBe(false)
    expect(f('=OR(FALSE, 0)')).toBe(false)
    expect(f('=OR(1=1, FALSE)')).toBe(true)
    expect(f('=AND(B2:B3)')).toBe(true)
    expect(f('=AND(A2:A3)')).toBe('#VALUE!')
    expect(f('=AND()')).toBe('#VALUE!')
    expect(f('=NOT(TRUE)')).toBe(false)
    expect(f('=NOT(0)')).toBe(true)
    expect(f('=ISBLANK(B5)')).toBe(true)
    expect(f('=ISBLANK(B4)')).toBe(false)
    expect(f('=ISNUMBER(B4)')).toBe(true)
    expect(f('=ISTEXT(A2)')).toBe(true)
    expect(f('=ISERROR(1/0)')).toBe(true)
    expect(f('=ISERROR(1)')).toBe(false)
  })

  it('sums, counts and averages by condition', () => {
    expect(f('=SUMIF(C2:C6, "Paid", B2:B6)')).toBe(121275.5)
    expect(f('=SUMIF(B2:B6, ">1000")')).toBe(121200)
    expect(f('=SUMIF(B2:B6, ">=450")')).toBe(121650)
    expect(f('=SUMIF(C2:C6, "<>Paid", B2:B6)')).toBe(450)
    expect(f('=SUMIF(D2:D6, ">=2026-02-15", B2:B6)')).toBe(120525.5)
    expect(f('=COUNTIF(C2:C6, "Due")')).toBe(2)
    expect(f('=COUNTIF(C2:C6, "=due")')).toBe(2)
    expect(f('=COUNTIF(B2:B6, ">1000")')).toBe(2)
    expect(f('=COUNTIF(B2:B6, 450)')).toBe(1)
    expect(f('=COUNTIF(B2:B6, "<>1200")')).toBe(4)
    expect(f('=COUNTIF(B2:B6, "")')).toBe(1)
    expect(f('=COUNTIF(B2:B6, "<>")')).toBe(4)
    expect(f('=COUNTIF(A2:A6, "?a*")')).toBe(1)
    expect(f('=COUNTIF(A2:A6, "*a")')).toBe(3)
    expect(f('=COUNTIF(A2:A6, "<m")')).toBe(3)
    expect(calc('=COUNTIF(A1:A3, "a~*")', [['a*'], ['ab'], ['A*']])).toBe(2)
    expect(f('=AVERAGEIF(C2:C6, "Due", B2:B6)')).toBe(450)
    expect(f('=AVERAGEIF(B2:B6, "<1000")')).toBe(262.75)
    expect(f('=AVERAGEIF(C2:C6, "Nope", B2:B6)')).toBe('#DIV/0!')
    expect(f('=SUMIFS(B2:B6, C2:C6, "Paid", B2:B6, ">1000")')).toBe(121200)
    expect(f('=COUNTIFS(C2:C6, "Paid", D2:D6, "<2026-03-01")')).toBe(1)
    expect(f('=SUMIFS(B2:B6, C2:C4, "Paid")')).toBe('#VALUE!')
    expect(f('=SUMIF("x", "x")')).toBe('#VALUE!')
  })

  it('multiplies ranges with SUMPRODUCT', () => {
    expect(f('=SUMPRODUCT(B2:B3, B2:B3)')).toBe(1642500)
    expect(f('=SUMPRODUCT(B2:B6)')).toBe(121725.5)
    expect(calc('=SUMPRODUCT(A1:A3, B1:B3)', [['2', '3'], ['4', 'x'], ['5', '10']])).toBe(56)
    expect(f('=SUMPRODUCT(B2:B3, B2:B4)')).toBe('#VALUE!')
    expect(f('=SUMPRODUCT(2, 3)')).toBe(6)
  })

  it('joins and slices text', () => {
    expect(f('=CONCAT(A2, "-", B2)')).toBe('Asha-1200')
    expect(f('=CONCAT(A2:A3)')).toBe('AshaRavi')
    expect(f('=CONCATENATE("a", 1, TRUE)')).toBe('a1TRUE')
    expect(f('=TEXTJOIN(", ", TRUE, A2:A6)')).toBe('Asha, Ravi, Meera, Dev, Ira')
    expect(f('=TEXTJOIN("|", TRUE, B2:B6)')).toBe('1200|450|120000|75.5')
    expect(f('=TEXTJOIN("|", FALSE, B4:B5)')).toBe('120000|')
    expect(f('=LEN("hello")')).toBe(5)
    expect(f('=LEN(B2)')).toBe(4)
    expect(f('=UPPER("Paid")')).toBe('PAID')
    expect(f('=LOWER("Paid")')).toBe('paid')
    expect(f('=TRIM("  a   b  ")')).toBe('a b')
    expect(f('=LEFT("Invoice", 3)')).toBe('Inv')
    expect(f('=LEFT("abc")')).toBe('a')
    expect(f('=RIGHT("Invoice", 4)')).toBe('oice')
    expect(f('=RIGHT("abc", 0)')).toBe('')
    expect(f('=MID("Invoice", 3, 3)')).toBe('voi')
    expect(f('=MID("abc", 0, 1)')).toBe('#VALUE!')
    expect(f('=LEFT("abc", -1)')).toBe('#VALUE!')
    expect(f('=PROPER("hello wORLD o\'neil")')).toBe("Hello World O'Neil")
    expect(f('=CONCAT(A2, 1/0)')).toBe('#DIV/0!')
  })

  it('looks values up exactly and approximately', () => {
    const slabs = [['0', '0%'], ['250000', '5%'], ['500000', '20%'], ['1000000', '30%']]
    expect(f('=VLOOKUP("ravi", A2:C6, 2, FALSE)')).toBe(450)
    expect(f('=VLOOKUP("M*", A2:C6, 3, FALSE)')).toBe('Paid')
    expect(f('=VLOOKUP("Zed", A2:C6, 2, FALSE)')).toBe('#N/A')
    expect(f('=VLOOKUP("Ravi", A2:C6, 5, FALSE)')).toBe('#REF!')
    expect(f('=VLOOKUP("Ravi", A2:C6, 0, FALSE)')).toBe('#VALUE!')
    expect(f('=VLOOKUP("Dev", A2:C6, 2, FALSE)')).toBe(0)
    expect(calc('=VLOOKUP(600000, A1:B4, 2)', slabs)).toBe(0.2)
    expect(calc('=VLOOKUP(1000000, A1:B4, 2, TRUE)', slabs)).toBe(0.3)
    expect(calc('=VLOOKUP(100, A1:B4, 2)', slabs)).toBe(0)
    expect(calc('=VLOOKUP(-5, A1:B4, 2)', slabs)).toBe('#N/A')
    expect(calc('=VLOOKUP(600000, A:B, 2)', slabs)).toBe(0.2)
    expect(calc('=MATCH(600000, A1:A4, 1)', slabs)).toBe(3)
    expect(calc('=MATCH(600000, A1:A4)', slabs)).toBe(3)
    expect(calc('=MATCH(250000, A1:A4, 0)', slabs)).toBe(2)
    expect(calc('=MATCH(1, A1:A4, 0)', slabs)).toBe('#N/A')
    expect(calc('=MATCH(25, A1:A4, -1)', [['100'], ['50'], ['20'], ['10']])).toBe(2)
    expect(f('=MATCH("meera", A1:A6, 0)')).toBe(4)
    expect(f('=MATCH("Asha", A1:D6, 0)')).toBe('#N/A')
  })

  it('finds values with XLOOKUP and INDEX', () => {
    expect(f('=XLOOKUP("Meera", A2:A6, B2:B6)')).toBe(120000)
    expect(f('=XLOOKUP("Zed", A2:A6, B2:B6, "none")')).toBe('none')
    expect(f('=XLOOKUP("Zed", A2:A6, B2:B6)')).toBe('#N/A')
    expect(f('=XLOOKUP("m*", A2:A6, C2:C6, , 2)')).toBe('Paid')
    expect(f('=XLOOKUP("m*", A2:A6, C2:C6)')).toBe('#N/A')
    expect(f('=XLOOKUP(500, B2:B6, A2:A6, "-", -1)')).toBe('Ravi')
    expect(f('=XLOOKUP(500, B2:B6, A2:A6, "-", 1)')).toBe('Asha')
    expect(f('=XLOOKUP("Amount", A1:D1, A3:D3)')).toBe(450)
    expect(f('=XLOOKUP("Ravi", A2:A6, B2:B5)')).toBe('#VALUE!')
    expect(f('=INDEX(A2:D6, 3, 2)')).toBe(120000)
    expect(f('=INDEX(A2:A6, 2)')).toBe('Ravi')
    expect(f('=INDEX(A1:D1, 3)')).toBe('Status')
    expect(f('=INDEX(A2:D6, 9, 1)')).toBe('#REF!')
    expect(f('=INDEX(A2:D6, 0, 1)')).toBe('#VALUE!')
    expect(f('=INDEX(B:B, MATCH("Ira", A:A, 0))')).toBe(75.5)
  })

  it('works with dates as Excel serial numbers', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 17, 6, 0, 0))
    expect(calc('=DATE(2026, 10, 15)')).toBe(46310)
    expect(calc('=DATE(2026, 13, 1)')).toBe(dateSerial('2027-01-01'))
    expect(calc('=DATE(26, 1, 1)')).toBe(dateSerial('1926-01-01'))
    expect(calc('=TODAY()')).toBe(46312)
    expect(calc('=NOW()')).toBe(46312.25)
    expect(f('=YEAR(D3)')).toBe(2026)
    expect(f('=MONTH(D4)')).toBe(3)
    expect(f('=DAY(D2)')).toBe(15)
    expect(f('=DAYS(D4, D2)')).toBe(59)
    expect(calc('=DAYS(TODAY(), "2026-10-01")')).toBe(16)
    expect(formatDate(calc('=EDATE("2026-01-31", 1)'))).toBe('28 Feb 2026')
    expect(formatDate(calc('=EDATE("15/03/2026", -3)'))).toBe('15 Dec 2025')
    expect(formatDate(calc('=EOMONTH("2026-02-10", 0)'))).toBe('28 Feb 2026')
    expect(calc('=YEAR("not a date")')).toBe('#VALUE!')
    expect(calc('=DATE(2026, 10, 15) - DATE(2026, 10, 1)')).toBe(14)
    expect(calc('="2026-10-15" + 1')).toBe(46311)
  })
})

describe('back-compat with the previous engine', () => {
  const SAMPLE = [
    'Item,Qty,Price,Total,Notes',
    'Pens,10,12.5,=B2*C2,',
    'Paper,3,250,=B3*C3,bulk',
    'Ink,2,899.99,"=ROUND(B4*C4,1)",',
    'Tape,,40,=B5*C5,',
    'Totals,=SUM(B2:B5),=AVERAGE(C2:C5),=SUM(D2:D5),',
    'Stats,=MIN(C2:C5),=MAX(C2:C5),=COUNT(B2:B5),=COUNTA(E2:E5)',
    'More,=PRODUCT(B2:B3),=MEDIAN(C2:C5),=AVG(B2:B4),=ABS(-5)',
    'Math,=SQRT(16),"=POWER(2,10)",=(D2+D3)*2-D5/4,=B2%3',
    'Nested,"=ROUND(C3/7,2)",=MAX(B2:B5)-MIN(B2:B5),"=SUM(B2:B5,C2)",=sum(b2:b3)',
    'Refs,=$B$2*2,=D6/B6,=-B3+C3/2,=1-2-3',
    'Div,=10/4,=7%2,=((1+2)*3)/4,=ROUND(C4)',
  ].join('\n')

  it('gives the same display text for every cell of an existing sheet', () => {
    const old = legacyEngine()
    const oldGrid = old.csvToGrid(SAMPLE)
    const expected = oldGrid.map((row, r) => row.map((_, c) => old.cellDisplay(oldGrid, r, c)))
    expect(expected.flat()).not.toContain('#ERR')
    expect(displayAll(csvToGrid(SAMPLE))).toEqual(expected)
    const grid = csvToGrid(SAMPLE)
    expect(grid.map((row, r) => row.map((_, c) => cellDisplay(grid, r, c)))).toEqual(expected)
  })

  it('fixes nested calls the old engine got wrong', () => {
    const grid = csvToGrid(SAMPLE)
    grid[9][1] = '=ROUND(AVERAGE(C2:C5),2)'
    const old = legacyEngine()
    expect(old.cellDisplay(grid, 9, 1)).toBe('2')
    expect(createEvaluator(grid).display(9, 1)).toBe('300.62')
  })

  it('still supports every old function name', () => {
    for (const name of legacyEngine().FORMULA_FUNCTIONS) expect(FORMULA_FUNCTIONS).toContain(name)
  })

  it('reads placeholder text such as "-" or "N/A" as 0 in arithmetic, as before', () => {
    const csv = 'a,b,c\n10,-,=A2*B2\n10,N/A,=A3+B3\nTBD,5,=-A4+B4\n4,x,=A5/2-B5'
    const old = legacyEngine()
    const oldGrid = old.csvToGrid(csv)
    const expected = oldGrid.map((row, r) => row.map((_, c) => old.cellDisplay(oldGrid, r, c)))
    expect(expected.slice(1).map(r => r[2])).toEqual(['0', '10', '5', '2'])
    expect(displayAll(csvToGrid(csv))).toEqual(expected)
    expect(calc('="abc"+1')).toBe('#VALUE!')
    expect(calc('=ABS(A1)', [['x']])).toBe('#VALUE!')
  })
})

describe('dates typed as text', () => {
  const data = [['When'], ['2020-01-15'], ['2099-01-01'], ['10/01/2026'], [''], ['2026-02-10']]

  it('compare with date serials from TODAY() and DATE()', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 17, 6, 0, 0))
    expect(calc('=IF(A2<TODAY(),1,0)', data)).toBe(1)
    expect(calc('=A3>TODAY()', data)).toBe(true)
    expect(calc('=A2>TODAY()', data)).toBe(false)
    expect(calc('=IF("2020-01-15"<TODAY(),1,0)')).toBe(1)
    expect(calc('=A4=DATE(2026,1,10)', data)).toBe(true)
    expect(calc('=A4<A6', data)).toBe(true)
    expect(calc('="2026-01-10"="10/01/2026"')).toBe(true)
    expect(calc('="abc"<5')).toBe(false)
  })

  it('match numeric criteria in COUNTIF and SUMIF', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 17, 6, 0, 0))
    const dates = [['D', 'N'], ['2026-01-10', '1'], ['2026-02-10', '2'], ['2026-03-10', '4'], ['', '8'], ['15/03/2026', '16']]
    expect(calc('=COUNTIF(A2:A6,"<"&DATE(2026,3,1))', dates)).toBe(2)
    expect(calc('=COUNTIF(A2:A6,">=2026-02-01")', dates)).toBe(3)
    expect(calc('=SUMIF(A2:A6,"<"&TODAY(),B2:B6)', dates)).toBe(23)
    expect(calc('=COUNTIF(A1:A6,"<"&TODAY())', data)).toBe(3)
  })

  it('give MIN and MAX the earliest and latest date, shown as a date', () => {
    const grid = [...data, ['=MAX(A2:A6)'], ['=MIN(A2:A6)'], ['=MAX(B1:B3)']]
    const ev = createEvaluator(grid)
    expect(ev.value(6, 0)).toBe(dateSerial('2099-01-01'))
    expect(ev.value(7, 0)).toBe(dateSerial('2020-01-15'))
    expect(ev.display(6, 0)).toBe('01 Jan 2099')
    expect(ev.display(8, 0)).toBe('0')
    expect(calc('=MAX(A1:A2)', [['5'], ['2026-01-01']])).toBe(dateSerial('2026-01-01'))
    expect(createEvaluator([['5'], ['2026-01-01'], ['=MAX(A1:A2)']]).display(2, 0)).toBe(String(dateSerial('2026-01-01')))
  })
})

describe('ranges that run past the sheet', () => {
  const data = [['1', ''], ['5', ''], ['x', '']]

  it('count the cells past the edge as blank in COUNTIF and COUNTIFS', () => {
    expect(calc('=COUNTBLANK(A1:A10)', data)).toBe(7)
    expect(calc('=COUNTIF(A1:A10,"")', data)).toBe(7)
    expect(calc('=COUNTIF(A1:A10,"<>5")', data)).toBe(9)
    expect(calc('=COUNTIF(A1:A10,">0")', data)).toBe(2)
    expect(calc('=COUNTIFS(A1:A10,"",B1:B10,"")', data)).toBe(7)
    expect(calc('=COUNTIFS(A1:A10,"<>5",B1:B10,"")', data)).toBe(9)
  })

  it('sum against criteria cells past the edge', () => {
    const grid = [['', '1'], ['', '2'], ['', '4']]
    expect(calc('=SUMIF(A3:A6,"",B1:B4)', grid)).toBe(7)
    expect(calc('=AVERAGEIF(A3:A6,"",B1:B4)', grid)).toBeCloseTo(7 / 3)
  })
})

describe('columns formatted as Text', () => {
  const grid = [['ID', 'Len', 'Left', 'Find', 'Plus'], ['00123', '=LEN(A2)', '=LEFT(A2,2)', '=VLOOKUP("00123",A2:B2,2,FALSE)', '=A2+1'], ['007', '', '', '', '=SUM(A2:A3)']]

  it('keep typed values as text for formulas', () => {
    const ev = createEvaluator(grid, { textCols: [0], header: true })
    expect(ev.value(1, 1)).toBe(5)
    expect(ev.value(1, 2)).toBe('00')
    expect(ev.value(1, 3)).toBe(5)
    expect(ev.value(1, 4)).toBe(124)
    expect(ev.value(2, 4)).toBe(0)
    expect(ev.display(1, 0, { type: 'text' })).toBe('00123')
  })

  it('leave other columns and the default evaluator alone', () => {
    const ev = createEvaluator(grid)
    expect(ev.value(1, 1)).toBe(3)
    expect(ev.value(2, 4)).toBe(130)
  })
})

describe('moveRange', () => {
  const grid = csvToGrid('Item,Qty,Price,Total,,\nPens,2,10,=B2*C2,,\nInk,1,5,"=SUM(B2:B3)",=$B$2,=F2')

  it('moves cells and makes the formulas that pointed at them follow', () => {
    const out = moveRange(grid, { r1: 1, c1: 1, r2: 1, c2: 1 }, 1, 5)
    expect(toCSV(out).split('\n')).toEqual(['Item,Qty,Price,Total,,', 'Pens,,10,=F2*C2,,2', 'Ink,1,5,=SUM(B2:B3),=$F$2,=#REF!'])
    expect(createEvaluator(out).value(1, 3)).toBe(20)
  })

  it('moves whole ranges, keeps the moved formulas\' own text and grows the grid', () => {
    const out = moveRange(grid, { r1: 1, c1: 1, r2: 2, c2: 1 }, 3, 1)
    expect(toCSV(out).split('\n')).toEqual(['Item,Qty,Price,Total,,', 'Pens,,10,=B4*C2,,', 'Ink,,5,=SUM(B4:B5),=$B$4,=F2', ',2,,,,', ',1,,,,'])
    const formula = moveRange(grid, { r1: 1, c1: 3, r2: 1, c2: 3 }, 4, 7)
    expect(formula[4][7]).toBe('=B2*C2')
    expect(formula[1][3]).toBe('')
    expect(formula[0]).toHaveLength(8)
    expect(moveRange(grid, { r1: 1, c1: 1, r2: 1, c2: 1 }, 1, 1)).toBe(grid)
  })
})

describe('toNumber', () => {
  it.each([
    ['1200', 1200], ['-12.5', -12.5], ['1,20,000', 120000], ['1,200,000.50', 1200000.5], ['12,34,567', 1234567],
    ['₹1,200', 1200], ['$ 1,200', 1200], ['Rs. 500', 500], ['-₹1,200', -1200], ['₹-1,200', -1200],
    ['12%', 0.12], ['-12.5%', -0.125], ['(500)', -500], [' 42 ', 42], ['1e3', 1000], ['.5', 0.5],
    [true, 1], [false, 0], [7, 7],
  ])('reads %j as %j', (input, expected) => {
    expect(toNumber(input)).toBe(expected)
  })

  it.each([['1,2'], ['1,2345'], ['123,45,678'], ['12abc'], [''], ['   '], ['-'], ['%'], ['abc'], [null], [undefined], [NaN], [Infinity], ['1e999'], ['1.2.3']])(
    'rejects %j', (input) => {
      expect(toNumber(input)).toBeNull()
    })

  it('says what is numeric', () => {
    expect(isNumeric('1,200')).toBe(true)
    expect(isNumeric(5)).toBe(true)
    expect(isNumeric('abc')).toBe(false)
    expect(isNumeric(true)).toBe(false)
    expect(isNumeric(NaN)).toBe(false)
  })
})

describe('dates', () => {
  it.each([
    ['2026-10-15', 46310], ['15/10/2026', 46310], ['5/1/2026', 46027], ['15-10-2026', 46310], ['15/10/26', 46310],
    ['15 Oct 2026', 46310], ['15-Oct-2026', 46310], ['15 October 2026', 46310], ['Oct 15, 2026', 46310],
    ['2026-10-15T18:00:00', 46310.75], [46310, 46310],
  ])('reads %j', (input, serial) => {
    expect(dateSerial(input)).toBe(serial)
  })

  it.each([['31/02/2026'], ['hello'], ['2026-13-01'], ['15 Foo 2026'], ['1.2.26'], [''], [null]])('rejects %j', (input) => {
    expect(dateSerial(input)).toBeNull()
  })

  it('formats serials as dates', () => {
    expect(formatDate(46310)).toBe('15 Oct 2026')
    expect(formatDate(46300)).toBe('05 Oct 2026')
    expect(formatDate(46310.75)).toBe('15 Oct 2026')
  })
})

describe('formatValue', () => {
  it('lists the column formats', () => {
    expect(FORMATS.map(f => f.type)).toEqual(['auto', 'text', 'number', 'inr', 'percent', 'date'])
    expect(FORMATS.find(f => f.type === 'inr').label).toBe('Indian rupee (₹)')
  })

  it.each([
    [120000, { type: 'inr' }, '₹1,20,000.00'],
    [-1234.5, { type: 'inr' }, '-₹1,234.50'],
    [1234.5678, { type: 'inr', decimals: 0 }, '₹1,235'],
    ['1,20,000', { type: 'inr' }, '₹1,20,000.00'],
    [-0.001, { type: 'inr' }, '₹0.00'],
    [1234567.891, { type: 'number' }, '12,34,567.89'],
    [1234.5, { type: 'number' }, '1,234.5'],
    [1234, { type: 'number' }, '1,234'],
    [1234.5, { type: 'number', decimals: 3 }, '1,234.500'],
    [-0.001, { type: 'number' }, '0'],
    [0.125, { type: 'percent' }, '12.5%'],
    [0.125, { type: 'percent', decimals: 0 }, '13%'],
    ['18%', { type: 'percent' }, '18%'],
    [46310, { type: 'date' }, '15 Oct 2026'],
    ['15/10/2026', { type: 'date' }, '15 Oct 2026'],
    ['abc', { type: 'inr' }, 'abc'],
    ['not a date', { type: 'date' }, 'not a date'],
    ['#DIV/0!', { type: 'inr' }, '#DIV/0!'],
    [5, { type: 'text' }, '5'],
    [true, { type: 'number' }, 'TRUE'],
    ['', { type: 'inr' }, ''],
    [null, undefined, ''],
    [0.1 + 0.2, undefined, '0.3'],
    [1 / 3, { type: 'auto' }, '0.3333333333'],
    ['raw text', { type: 'auto' }, 'raw text'],
    [1200, { type: 'mystery' }, '1200'],
  ])('formats %j with %j as %j', (value, fmt, expected) => {
    expect(formatValue(value, fmt)).toBe(expected)
  })
})

describe('shiftFormula', () => {
  it('moves relative parts and keeps $ parts', () => {
    expect(shiftFormula('=A1+B2', 1, 0)).toBe('=A2+B3')
    expect(shiftFormula('=$A$1+A$1+$A1', 2, 3)).toBe('=$A$1+D$1+$A3')
    expect(shiftFormula('=SUM(A1:B2)', 1, 1)).toBe('=SUM(B2:C3)')
    expect(shiftFormula('=SUM(A:A)', 5, 1)).toBe('=SUM(B:B)')
    expect(shiftFormula('=SUM(2:2)', 1, 3)).toBe('=SUM(3:3)')
    expect(shiftFormula('=sum(a1)*2', 1, 0)).toBe('=sum(A2)*2')
  })

  it('turns references pushed off the sheet into #REF!', () => {
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!')
    expect(shiftFormula('=SUM(A1:A3)+B5', -1, 0)).toBe('=SUM(#REF!)+B4')
    expect(shiftFormula('=B1', 0, -2)).toBe('=#REF!')
    expect(calc(shiftFormula('=A1', -1, 0))).toBe('#REF!')
  })

  it('leaves strings, plain text and zero moves alone', () => {
    expect(shiftFormula('="A1"&A1', 1, 0)).toBe('="A1"&A2')
    expect(shiftFormula('plain A1', 1, 0)).toBe('plain A1')
    expect(shiftFormula('=A1', 0, 0)).toBe('=A1')
    expect(shiftFormula('=$A$1', 4, 4)).toBe('=$A$1')
  })
})

describe('insert and delete', () => {
  const sheet = () => [
    ['Item', 'Amt'],
    ['a', '10'],
    ['b', '20'],
    ['Total', '=SUM(B2:B3)'],
    ['Share', '=B2/$B$4'],
  ]

  it('inserts rows and rewrites formulas so they keep pointing at the same cells', () => {
    const inside = insertRows(sheet(), 2, 1)
    expect(inside.map(r => r[0])).toEqual(['Item', 'a', '', 'b', 'Total', 'Share'])
    expect(inside[4][1]).toBe('=SUM(B2:B4)')
    expect(inside[5][1]).toBe('=B2/$B$5')
    const before = insertRows(sheet(), 1, 2)
    expect(before[5][1]).toBe('=SUM(B4:B5)')
    expect(before[6][1]).toBe('=B4/$B$6')
    const ev = createEvaluator(before)
    expect(ev.value(5, 1)).toBe(30)
    expect(ev.value(6, 1)).toBe(10 / 30)
    expect(insertRows(sheet(), 99, 1)).toHaveLength(6)
    expect(insertRows([['1', '2'], ['=SUM(1:1)', '']], 0, 1)).toEqual([['', ''], ['1', '2'], ['=SUM(2:2)', '']])
  })

  it('deletes rows, shrinking ranges and turning lost references into #REF!', () => {
    const one = deleteRows(sheet(), 1, 1)
    expect(one.map(r => r[0])).toEqual(['Item', 'b', 'Total', 'Share'])
    expect(one[2][1]).toBe('=SUM(B2:B2)')
    expect(one[3][1]).toBe('=#REF!/$B$3')
    const ev = createEvaluator(one)
    expect(ev.value(2, 1)).toBe(20)
    expect(ev.value(3, 1)).toBe('#REF!')
    const both = deleteRows(sheet(), 1, 2)
    expect(both[1][1]).toBe('=SUM(#REF!)')
    expect(createEvaluator(both).value(1, 1)).toBe('#REF!')
    expect(deleteRows([['a', 'b']], 0, 1)).toEqual([['', '']])
    expect(deleteRows([['1'], ['2'], ['3'], ['=SUM(A1:A3)']], 2, 1)[2][0]).toBe('=SUM(A1:A2)')
  })

  it('inserts and deletes columns the same way', () => {
    const grid = [['1', '2', '=A1+B1', '=SUM(A1:B1)']]
    expect(insertCols(grid, 1, 1)).toEqual([['1', '', '2', '=A1+C1', '=SUM(A1:C1)']])
    expect(insertCols(grid, 0, 1)).toEqual([['', '1', '2', '=B1+C1', '=SUM(B1:C1)']])
    const deleted = deleteCols(grid, 0, 1)
    expect(deleted).toEqual([['2', '=#REF!+A1', '=SUM(A1:A1)']])
    const ev = createEvaluator(deleted)
    expect(ev.value(0, 1)).toBe('#REF!')
    expect(ev.value(0, 2)).toBe(2)
    expect(insertCols([['5', '=SUM(A:A)']], 0, 1)).toEqual([['', '5', '=SUM(B:B)']])
    expect(deleteCols([['a', 'b'], ['c', 'd']], 0, 2)).toEqual([[''], ['']])
    expect(insertCols([['a'], ['b', 'c']], 1, 1)).toEqual([['a', '', ''], ['b', '', 'c']])
  })

  it('shifts column metadata maps', () => {
    const map = { 0: 100, 2: 200, 3: 300 }
    expect(shiftColMeta(map, 1, 2)).toEqual({ 0: 100, 4: 200, 5: 300 })
    expect(shiftColMeta(map, 2, -1)).toEqual({ 0: 100, 2: 300 })
    expect(shiftColMeta(map, 0, -2)).toEqual({ 0: 200, 1: 300 })
    expect(shiftColMeta(map, 1, 0)).toBe(map)
    expect(shiftColMeta(undefined, 1, 1)).toBeUndefined()
  })
})

describe('sortRows', () => {
  it('sorts just a block when given a range, using values from the whole sheet', () => {
    const g = [['Item', 'Amt', 'Rate'], ['x', '1', '=B2*$E$1'], ['y', '3', '=B3*$E$1'], ['z', '2', '=B4*$E$1'], ['Total', '=SUM(B2:B4)', '']]
    g[0].push('', '10')
    for (const row of g.slice(1)) row.push('', '')
    const out = sortRows(g, 2, false, { header: false, range: { r1: 1, c1: 0, r2: 3, c2: 2 } })
    expect(out.map(r => r.slice(0, 3))).toEqual([['Item', 'Amt', 'Rate'], ['y', '3', '=B2*$E$1'], ['z', '2', '=B3*$E$1'], ['x', '1', '=B4*$E$1'], ['Total', '=SUM(B2:B4)', '']])
    expect(out[0][4]).toBe('10')
    const head = sortRows([['N', 'x'], ['b', 'keep'], ['a', 'keep2']], 0, true, { header: true, range: { r1: 0, c1: 0, r2: 2, c2: 0 } })
    expect(head).toEqual([['N', 'x'], ['a', 'keep'], ['b', 'keep2']])
  })

  const grid = () => [
    ['Name', 'Amt', 'Double'],
    ['b', '20', '=B2*2'],
    ['a', '5', '=B3*2'],
    ['c', '', '=B4*2'],
    ['d', '1,20,000', '=B5*2'],
    ['e', 'abc', 'x'],
    ['f', '20', '=B7*2'],
  ]

  it('sorts numbers before text, blanks last, keeping the header and stable order', () => {
    const asc = sortRows(grid(), 1, true)
    expect(asc.map(r => r[0])).toEqual(['Name', 'a', 'b', 'f', 'd', 'e', 'c'])
    const desc = sortRows(grid(), 1, false)
    expect(desc.map(r => r[0])).toEqual(['Name', 'e', 'd', 'b', 'f', 'a', 'c'])
  })

  it('moves formulas with their rows and keeps them pointing at their own row', () => {
    const asc = sortRows(grid(), 1, true)
    expect(asc[1][2]).toBe('=B2*2')
    expect(asc[2][2]).toBe('=B3*2')
    expect(asc[6][2]).toBe('=B7*2')
    const ev = createEvaluator(asc)
    for (let r = 1; r < asc.length; r++) {
      if (asc[r][2] !== 'x') expect(ev.value(r, 2)).toBe(2 * (toNumber(asc[r][1]) ?? 0))
    }
  })

  it('sorts every row when there is no header, by computed values, dates and natural text', () => {
    expect(sortRows([['3'], ['=1+0'], ['2']], 0, true, { header: false }).map(r => r[0])).toEqual(['=1+0', '2', '3'])
    const dates = sortRows([['Date'], ['15/02/2026'], ['2026-01-15'], ['15 Mar 2026']], 0, true)
    expect(dates.map(r => r[0])).toEqual(['Date', '2026-01-15', '15/02/2026', '15 Mar 2026'])
    expect(sortRows([['Item 10'], ['item 2'], ['Item 1']], 0, true, { header: false }).map(r => r[0])).toEqual(['Item 1', 'item 2', 'Item 10'])
  })
})

describe('fillSeries', () => {
  it.each([
    [['5'], 3, ['5', '5', '5']],
    [['1', '2'], 3, ['3', '4', '5']],
    [['10', '7'], 2, ['4', '1']],
    [['1.5', '2.0'], 2, ['2.5', '3.0']],
    [['10%', '20%'], 2, ['30%', '40%']],
    [['1', '2', '4'], 4, ['1', '2', '4', '1']],
    [['2026-10-15'], 2, ['2026-10-16', '2026-10-17']],
    [['15/10/2026', '22/10/2026'], 2, ['29/10/2026', '05/11/2026']],
    [['31 Jan 2026', '28 Feb 2026'], 2, ['31 Mar 2026', '30 Apr 2026']],
    [['15 Jan 2026', '15 Feb 2026'], 1, ['15 Mar 2026']],
    [['Item 1'], 3, ['Item 2', 'Item 3', 'Item 4']],
    [['Week 2', 'Week 4'], 2, ['Week 6', 'Week 8']],
    [['Q1'], 4, ['Q2', 'Q3', 'Q4', 'Q1']],
    [['INV-009'], 2, ['INV-010', 'INV-011']],
    [['Jan'], 3, ['Feb', 'Mar', 'Apr']],
    [['Nov', 'Dec'], 2, ['Jan', 'Feb']],
    [['MONDAY'], 1, ['TUESDAY']],
    [['=A1*2'], 2, ['=A1*2', '=A1*2']],
    [['a', 'b'], 3, ['a', 'b', 'a']],
    [['x', ''], 2, ['x', '']],
    [[], 3, []],
    [['x'], 0, []],
    [['₹1,000', '₹2,000'], 2, ['₹3,000', '₹4,000']],
    [['1,00,000', '2,00,000'], 2, ['3,00,000', '4,00,000']],
    [['100,000', '200,000'], 9, ['300,000', '400,000', '500,000', '600,000', '700,000', '800,000', '900,000', '1,000,000', '1,100,000']],
    [['(500)', '(400)'], 6, ['(300)', '(200)', '(100)', '0', '100', '200']],
    [['$ 1,200.50', '$ 1,300.50'], 1, ['$ 1,400.50']],
    [['-₹500', '-₹400'], 5, ['-₹300', '-₹200', '-₹100', '₹0', '₹100']],
    [['1.5', '2'], 2, ['2.5', '3']],
  ])('extends %j by %i', (cells, count, expected) => {
    expect(fillSeries(cells, count)).toEqual(expected)
  })
})

describe('performance', () => {
  it('evaluates a 5,000×20 sheet with formula columns well within budget', () => {
    const grid = [Array.from({ length: 20 }, (_, c) => colName(c))]
    let expected = 0
    for (let r = 1; r <= 5000; r++) {
      const row = []
      let rowSum = 0
      for (let c = 0; c < 18; c++) {
        const v = (r * 7 + c * 13) % 1000
        rowSum += v
        row.push(String(v))
      }
      expected += rowSum
      row.push(`=SUM(A${r + 1}:R${r + 1})`)
      row.push(r === 1 ? '=S2' : `=T${r}+S${r + 1}`)
      grid.push(row)
    }
    const share = grid.map((row, r) => [...row.slice(0, 19), r ? `=S${r + 1}/SUM(S:S)` : 'Share'])
    const t0 = performance.now()
    const ev = createEvaluator(grid)
    for (let r = 0; r < grid.length; r++) for (let c = 0; c < 20; c++) ev.display(r, c)
    const ev2 = createEvaluator(share)
    for (let r = 0; r < share.length; r++) ev2.display(r, 19)
    const ms = performance.now() - t0
    expect(ev.value(5000, 19)).toBe(expected)
    expect(ev2.value(1, 19)).toBeCloseTo(ev2.value(1, 18) / expected)
    expect(ms).toBeLessThan(1500)
  })
})
