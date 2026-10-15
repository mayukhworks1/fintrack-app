/**
 * The shared escaping helpers.
 *
 * escapeHtml is what the AI answer renderers (AIAssistant, Report) escape text
 * with before they strip stray markdown characters — `#` among them — so its
 * output must not contain a numeric entity such as &#39;, or an apostrophe in
 * an answer would reach the page as "&39;".
 */
import { describe, it, expect } from 'vitest'
import { escapeAttr, escapeHtml } from '../utils/sanitize'

describe('escapeHtml', () => {
  it('neutralises tags and ampersands', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)> & co')).toBe('&lt;img src=x onerror=alert(1)&gt; &amp; co')
  })

  it('leaves quotes as text, so the markdown strip cannot mangle an entity', () => {
    const out = escapeHtml(`Client's "Q3" invoice`)
    expect(out).toBe(`Client's "Q3" invoice`)
    expect(out.replace(/[`#*_]/g, '')).toBe(`Client's "Q3" invoice`)
  })

  it('treats null and undefined as empty', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('escapeAttr', () => {
  it('also escapes both quote characters for attribute values', () => {
    expect(escapeAttr(`a"b'c<d>&`)).toBe('a&quot;b&#39;c&lt;d&gt;&amp;')
  })
})
