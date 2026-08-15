import { describe, it, expect } from 'vitest'
import { isChunkLoadError } from '../utils/chunkError'

/**
 * These are the verbatim messages each engine produces when a lazy chunk 404s
 * and the SPA rewrite hands back index.html instead.
 *
 * The bug this guards against: the original matcher only covered Chrome's
 * wording, so on iOS Safari the automatic reload never fired and users saw a
 * raw MIME-type error instead. No two engines share a substring here, so each
 * one needs its own case.
 */
const REAL_MESSAGES = {
  'iOS Safari (reported)':
    "'text/html' is not a valid JavaScript MIME type for module script 'https://twfintracker.worksmayukh.space/assets/Invoices-CoTvz_N1.js'.",
  'Safari — generic':
    'Importing a module script failed.',
  'Chrome — fetch':
    'Failed to fetch dynamically imported module: https://example.com/assets/Invoices-CoTvz_N1.js',
  'Chrome — strict MIME':
    'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec.',
  'Firefox — import':
    'error loading dynamically imported module: https://example.com/assets/Invoices.js',
  'Firefox — MIME':
    'Loading module from “https://example.com/assets/Invoices.js” was blocked because of a disallowed MIME type (“text/html”).',
  'Vite — CSS preload':
    'Unable to preload CSS for /assets/Invoices-CoTvz_N1.css',
}

describe('isChunkLoadError', () => {
  for (const [engine, message] of Object.entries(REAL_MESSAGES)) {
    it(`recognises the failure reported by ${engine}`, () => {
      expect(isChunkLoadError(new Error(message))).toBe(true)
    })
  }

  it('recognises a bundler-tagged ChunkLoadError without reading the message', () => {
    const err = new Error('whatever')
    err.name = 'ChunkLoadError'
    expect(isChunkLoadError(err)).toBe(true)
  })

  it('accepts a bare string as well as an Error', () => {
    expect(isChunkLoadError(REAL_MESSAGES['iOS Safari (reported)'])).toBe(true)
  })

  // The reload is destructive to in-progress work, so a false positive is worse
  // than a miss: an ordinary render bug must never trigger a page reload.
  it.each([
    ['a render bug',        new TypeError("Cannot read properties of undefined (reading 'map')")],
    ['a network failure',   new Error('NetworkError when attempting to fetch resource.')],
    ['an API error',        new Error('Request failed with status code 500')],
    ['null',                null],
    ['undefined',           undefined],
  ])('does not treat %s as a chunk error', (_label, err) => {
    expect(isChunkLoadError(err)).toBe(false)
  })
})
