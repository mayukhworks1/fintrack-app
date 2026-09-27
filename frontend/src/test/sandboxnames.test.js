/**
 * The sandbox is a replica, so its words must be the product's words.
 *
 * Four of the eleven tabs did not match the signed-in app: the demo said
 * "Receivables" for a module the product calls Invoices, "Reports" for
 * Report, "Delivery" for Status Board, and lower-cased AI Assistant. A
 * visitor drives the demo, decides, signs in, and then cannot find the
 * module they were just using.
 *
 * Nothing catches that by looking — both sides read fine on their own. So it
 * is asserted: every label the sandbox shows must be a label the app's own
 * navigation shows.
 */
import { describe, it, expect } from 'vitest'
import { TABS } from '../components/DemoWorkspace'
import { NAV_ITEMS } from '../components/Layout'

/* Aging bands are part of Invoices in the product, not a module of their own.
   The sandbox surfaces them as an entry point because a band is the quickest
   way in, and clicking one lands you in Invoices with the filter applied —
   which is where the feature actually lives. Declared here so the exception
   is a decision on the record rather than a gap in the check. */
const SUBVIEWS = new Set(['Ageing'])

describe('the sandbox uses the product’s names', () => {
  const appLabels = new Set(NAV_ITEMS.map(i => i.label))

  it('exposes both lists', () => {
    expect(TABS.length).toBeGreaterThan(0)
    expect(appLabels.size).toBeGreaterThan(0)
  })

  it('gives every tab a label the signed-in app also uses', () => {
    const wrong = TABS
      .filter(t => !SUBVIEWS.has(t.label))
      .filter(t => !appLabels.has(t.label))
      .map(t => t.label)
    expect(wrong, `not in the app's navigation: ${wrong.join(', ')}`).toEqual([])
  })

  it('does not drift back to the old names', () => {
    const labels = TABS.map(t => t.label)
    for (const gone of ['Receivables', 'Reports', 'Delivery', 'AI assistant']) {
      expect(labels, `${gone} is not what the product calls it`).not.toContain(gone)
    }
  })
})
