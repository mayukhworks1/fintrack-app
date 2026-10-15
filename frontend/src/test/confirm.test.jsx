import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ConfirmProvider, useConfirm } from '../context/ConfirmContext'
import Modal from '../components/Modal'

/**
 * The confirm dialog replaced window.confirm on destructive admin actions —
 * delete user, revoke sessions, delete share link. The property that matters is
 * that a dismissed dialog resolves false. If it ever resolved true, or hung
 * unresolved, a caller written as `if (!(await confirm(...))) return` would fall
 * straight through into the destructive branch.
 */
function Harness({ onResult, options }) {
  const confirm = useConfirm()
  return (
    <button onClick={async () => onResult(await confirm(options ?? { message: 'Delete this?' }))}>
      trigger
    </button>
  )
}

function setup(options) {
  const results = []
  render(
    <ConfirmProvider>
      <Harness onResult={(r) => results.push(r)} options={options} />
    </ConfirmProvider>
  )
  return results
}

async function open() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }))
  })
  return screen.findByText('Delete this?')
}

const click = async (name) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

describe('confirm dialog', () => {
  it('resolves true when confirmed', async () => {
    const results = setup()
    await open()
    await click('Confirm')
    await waitFor(() => expect(results).toEqual([true]))
  })

  it('resolves false when cancelled', async () => {
    const results = setup()
    await open()
    await click('Cancel')
    await waitFor(() => expect(results).toEqual([false]))
  })

  it('resolves false on Escape, so a dismissed dialog never proceeds', async () => {
    const results = setup()
    await open()
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await waitFor(() => expect(results).toEqual([false]))
  })

  it('runs onConfirm before resolving, for actions that need the user gesture', async () => {
    const onConfirm = vi.fn()
    const results = setup({ message: 'Delete this?', onConfirm })
    await open()
    await click('Confirm')
    await waitFor(() => expect(results).toEqual([true]))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('still resolves when onConfirm throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const results = setup({
      message: 'Delete this?',
      onConfirm: () => { throw new Error('boom') },
    })
    await open()
    await click('Confirm')
    await waitFor(() => expect(results).toEqual([true]))
    spy.mockRestore()
  })

  it('accepts a bare string, matching the window.confirm call shape', async () => {
    const results = setup('Delete this?')
    await open()
    await click('Confirm')
    await waitFor(() => expect(results).toEqual([true]))
  })

  it('exposes the dialog with an accessible name', async () => {
    setup({ message: 'Delete this?', title: 'Delete user' })
    await open()
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Delete user')
  })

  it('uses a custom confirm label', async () => {
    setup({ message: 'Delete this?', confirmLabel: 'Delete user' })
    await open()
    expect(screen.getByRole('button', { name: 'Delete user' })).toBeInTheDocument()
  })
})

describe('confirm dialog stacking', () => {
  it('sits above the Pages analytics drawer and other full-screen overlays', async () => {
    setup()
    await open()
    const z = Number(screen.getByRole('dialog').style.zIndex)
    // PagesManager drawers use 1000/2000, InvoiceDetail uses 9999.
    expect(z).toBeGreaterThan(9999)
  })
})

describe('a confirmation opened from another dialog', () => {
  function Stacked({ onOuterClose, onResult }) {
    const confirm = useConfirm()
    return (
      <Modal open onClose={onOuterClose} title="Prompt">
        <button onClick={async () => onResult(await confirm({ message: 'Use the built-in prompt?', confirmLabel: 'Use built-in' }))}>
          ask
        </button>
      </Modal>
    )
  }

  async function openStacked() {
    const onOuterClose = vi.fn()
    const results = []
    render(<ConfirmProvider><Stacked onOuterClose={onOuterClose} onResult={(r) => results.push(r)} /></ConfirmProvider>)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'ask' })) })
    await screen.findByText('Use the built-in prompt?')
    return { onOuterClose, results }
  }

  it('Escape dismisses only the confirmation, not the dialog underneath', async () => {
    const { onOuterClose, results } = await openStacked()
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    await waitFor(() => expect(results).toEqual([false]))
    expect(onOuterClose).not.toHaveBeenCalled()
  })

  it('Tab is handled by the confirmation alone, so its buttons stay reachable', async () => {
    await openStacked()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    await act(async () => { fireEvent.keyDown(cancel, { key: 'Tab' }) })
    expect(document.activeElement).toBe(cancel)
  })
})
