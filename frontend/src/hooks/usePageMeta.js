import { useEffect } from 'react'

/**
 * Per-page <title>, description, canonical and structured data.
 *
 * A single-page app only ever ships one static <title>, so every tab, every
 * bookmark and every history entry reads the same thing, and a screen reader
 * announces nothing at all when the route changes. This sets them per page.
 *
 * Values are restored rather than deleted on cleanup. An earlier version of
 * this logic in PageViewer removed the meta nodes outright, which also took out
 * the app's own og:title/og:description/og:url from index.html — so leaving a
 * published page left the whole app with no share metadata until a reload.
 *
 * Twitter's tags are written alongside the Open Graph ones. They were left at
 * the index.html defaults, so a link to any route shared on Twitter or a client
 * that reads those tags showed the site-wide blurb rather than the page's.
 */
const SITE = 'https://twfintracker.worksmayukh.space'

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

export function usePageMeta({ title, description, path, jsonLd } = {}) {
  useEffect(() => {
    if (!title && !description && !path && !jsonLd) return

    const prev = {
      title: document.title,
      desc: readMeta('meta[name="description"]'),
      ogTitle: readMeta('meta[property="og:title"]'),
      ogDesc: readMeta('meta[property="og:description"]'),
      ogUrl: readMeta('meta[property="og:url"]'),
      twTitle: readMeta('meta[name="twitter:title"]'),
      twDesc: readMeta('meta[name="twitter:description"]'),
    }

    if (title) {
      document.title = title
      writeMeta('meta[property="og:title"]', 'property', 'og:title', title)
      writeMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title)
    }
    if (description) {
      writeMeta('meta[name="description"]', 'name', 'description', description)
      writeMeta('meta[property="og:description"]', 'property', 'og:description', description)
      writeMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description)
    }

    // Canonical. Client-side routes are all served from one HTML file, so
    // without this every public route presents itself to a crawler as the
    // same URL the index was fetched from.
    let link = null
    if (path) {
      const href = `${SITE}${path}`
      link = document.head.querySelector('link[rel="canonical"]')
      if (!link) {
        link = document.createElement('link')
        link.setAttribute('rel', 'canonical')
        document.head.appendChild(link)
      }
      link.setAttribute('href', href)
      writeMeta('meta[property="og:url"]', 'property', 'og:url', href)
    }

    // Structured data, as its own node keyed to this hook so removing it on
    // cleanup cannot take out a block some other page added.
    let script = null
    if (jsonLd) {
      script = document.createElement('script')
      script.type = 'application/ld+json'
      script.dataset.pageMeta = 'true'
      script.textContent = JSON.stringify(jsonLd)
      document.head.appendChild(script)
    }

    return () => {
      document.title = prev.title
      writeMeta('meta[name="description"]', 'name', 'description', prev.desc)
      writeMeta('meta[property="og:title"]', 'property', 'og:title', prev.ogTitle)
      writeMeta('meta[property="og:description"]', 'property', 'og:description', prev.ogDesc)
      writeMeta('meta[name="twitter:title"]', 'name', 'twitter:title', prev.twTitle)
      writeMeta('meta[name="twitter:description"]', 'name', 'twitter:description', prev.twDesc)
      if (path) writeMeta('meta[property="og:url"]', 'property', 'og:url', prev.ogUrl)
      script?.remove()
    }
  }, [title, description, path, jsonLd])
}
