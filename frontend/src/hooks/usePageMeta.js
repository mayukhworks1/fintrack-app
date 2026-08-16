import { useEffect } from 'react'

/**
 * Per-page <title> and description.
 *
 * A single-page app only ever ships one static <title>, so every tab, every
 * bookmark and every history entry reads the same thing, and a screen reader
 * announces nothing at all when the route changes. This sets both per page.
 *
 * Values are restored rather than deleted on cleanup. An earlier version of
 * this logic in PageViewer removed the meta nodes outright, which also took out
 * the app's own og:title/og:description/og:url from index.html — so leaving a
 * published page left the whole app with no share metadata until a reload.
 */
function readMeta(selector) {
  return document.head.querySelector(selector)?.getAttribute('content') ?? null
}

function writeMeta(selector, attr, key, value) {
  let el = document.head.querySelector(selector)
  if (!el) {
    if (value === null) return
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  if (value === null) el.remove()
  else el.setAttribute('content', value)
}

export function usePageMeta({ title, description } = {}) {
  useEffect(() => {
    if (!title && !description) return

    const prevTitle = document.title
    const prevDesc = readMeta('meta[name="description"]')
    const prevOgTitle = readMeta('meta[property="og:title"]')
    const prevOgDesc = readMeta('meta[property="og:description"]')

    if (title) {
      document.title = title
      writeMeta('meta[property="og:title"]', 'property', 'og:title', title)
    }
    if (description) {
      writeMeta('meta[name="description"]', 'name', 'description', description)
      writeMeta('meta[property="og:description"]', 'property', 'og:description', description)
    }

    return () => {
      document.title = prevTitle
      writeMeta('meta[name="description"]', 'name', 'description', prevDesc)
      writeMeta('meta[property="og:title"]', 'property', 'og:title', prevOgTitle)
      writeMeta('meta[property="og:description"]', 'property', 'og:description', prevOgDesc)
    }
  }, [title, description])
}
