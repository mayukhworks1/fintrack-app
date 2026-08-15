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
