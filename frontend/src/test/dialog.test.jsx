import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HelpModal } from '../pages/webinvoices/HelpModal'

describe('hand-rolled dialogs carry dialog semantics', () => {
  it('HelpModal exposes role=dialog with an accessible name', () => {
    render(<HelpModal open onClose={() => {}} />)
    const d = screen.getByRole('dialog')
    expect(d).toHaveAttribute('aria-modal', 'true')
    expect(d).toHaveAccessibleName('Help')
  })

  it('HelpModal closes on Escape when open', () => {
    let closed = 0
    render(<HelpModal open onClose={() => { closed++ }} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closed).toBe(1)
  })

  it('HelpModal does not react to Escape while closed', () => {
    let closed = 0
    render(<HelpModal open={false} onClose={() => { closed++ }} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closed).toBe(0)
  })
})

// The reported crash: /admin?tab=requests died with "onClose is not defined".
// PurgeModal names its dismiss prop onCancel, but the dialog-semantics change
// passed `onClose` — an identifier declared nowhere in that scope. That is not
// a silent no-op like a wrong-but-existing variable would be; it is a
// ReferenceError thrown during render, which takes the whole tab down.
//
// Rendering each dialog once is what catches this class of mistake. A prop-name
// mismatch is invisible to review and to the type-free editor, but it cannot
// survive the component actually being mounted.
describe('admin dialogs render without unresolved identifiers', () => {
  it('PurgeModal mounts and is a labelled dialog', async () => {
    const { PurgeModal } = await import('../pages/admin/ui')
    render(<PurgeModal onConfirm={() => {}} onCancel={() => {}} purging={false} result={null} />)
    const d = screen.getByRole('dialog')
    expect(d).toHaveAttribute('aria-modal', 'true')
    expect(d).toHaveAccessibleName('Purge records')
  })

  it('PurgeModal closes on Escape via its own prop name', () => {
    let cancelled = 0
    return import('../pages/admin/ui').then(({ PurgeModal }) => {
      render(<PurgeModal onConfirm={() => {}} onCancel={() => { cancelled++ }}
                         purging={false} result={null} />)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(cancelled).toBe(1)
    })
  })
})
