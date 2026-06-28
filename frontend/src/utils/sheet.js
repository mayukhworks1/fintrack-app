// ---------------------------------------------------------------------------
// Shared spreadsheet helpers + Excel-like formula engine.
// Used by both the Pages editor (PagesManager) and the public viewer (PageViewer).
// No eval, no dependencies. Supports cell refs (A1), ranges (A1:B3), + - * / ( )
// and functions: SUM AVERAGE/AVG MIN MAX COUNT COUNTA PRODUCT ROUND ABS SQRT
// POWER MEDIAN.
// ---------------------------------------------------------------------------

export const FORMULA_FUNCTIONS = ['SUM','AVERAGE','AVG','MIN','MAX','COUNT','COUNTA','PRODUCT','ROUND','ABS','SQRT','POWER','MEDIAN']

export function parseLine(line) {
  const r=[]; let c=''; let q=false
  for(let i=0;i<line.length;i++){
    if(line[i]==='"'){if(q&&line[i+1]==='"'){c+='"';i++}else q=!q}
    else if(line[i]===','&&!q){r.push(c.trim());c=''}
    else c+=line[i]
  }
  r.push(c.trim()); return r
}

export function csvToGrid(text) {
  if (!text?.trim()) return [['','',''],['','',''],['','','']]
  const lines = text.trim().split('\n').filter(Boolean)
  const rows = lines.map(parseLine)
  const cols = Math.max(...rows.map(r=>r.length), 1)
  return rows.map(r => { while(r.length<cols) r.push(''); return r })
}

export function gridToCSV(grid) {
  return grid.map(row => row.map(cell => {
    const s = String(cell ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s
  }).join(',')).join('\n')
}

export function colToIdx(s) { let n=0; for (const ch of s.toUpperCase()) n=n*26+(ch.charCodeAt(0)-64); return n-1 }
export function idxToCol(i) { let s=''; i++; while(i>0){ s=String.fromCharCode(64+((i-1)%26+1))+s; i=Math.floor((i-1)/26) } return s }

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

export function evalFormula(raw, grid, visiting = new Set()) {
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

export function cellDisplay(grid, r, c) {
  const raw = cellRaw(grid, r, c)
  if (typeof raw === 'string' && raw.trim().startsWith('=')) return evalFormula(raw, grid, new Set([r+':'+c]))
  return raw
}
