/**
 * Login page: feedback that moves.
 *
 * The card shakes once when an answer is refused, the heading swaps with the
 * mode, a password being set gets a four-segment strength meter, and a
 * masked password field says when Caps Lock is on. Each is pinned by the
 * attribute or class the CSS keys on, plus the pure scoring function.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../services/api', () => ({
  api: {
    auth: {
      providers: vi.fn().mockResolvedValue({ google: true, zoho: false }),
      googleStartUrl: vi.fn(() => '/api/auth/google/start'),
      zohoStartUrl: vi.fn(() => '/api/auth/zoho/start'),
      emailRegister: vi.fn(),
      forgotPassword: vi.fn(),
      resetPassword: vi.fn(),
    },
  },
  getAuthToken: () => '',
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn(), acceptToken: vi.fn() }),
}))

import Login, { scorePassword } from '../pages/Login'

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('scorePassword', () => {
  it.each([
    ['', 0], ['short', 0], ['longenoughpw', 1], ['LongEnoughPw', 2],
    ['LongEnoughPw1', 3], ['LongEnoughPw1!', 4], ['Ab1!', 3],
  ])('%s → %i', (pw, score) => expect(scorePassword(pw)).toBe(score))
})

describe('Login motion', () => {
  it('the column enters in order and the card tilts', () => {
    const { container } = wrap(<Login />)
    expect(container.querySelector('.ft-login-enter')).not.toBeNull()
    expect(container.querySelector('.tilt.tilt-sheen')).not.toBeNull()
    expect(container.querySelector('form.ft-stagger-in')).not.toBeNull()
    expect(screen.getByText(/back to overview/i).closest('a').getAttribute('href')).toBe('/')
  })

  it('shakes the card once when an answer is refused, then settles', () => {
    const { container } = wrap(<Login />)
    fireEvent.click(screen.getByText(/create account/i))
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'LongEnoughPw1!' } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'different' } })
    fireEvent.submit(container.querySelector('form'))
    const card = container.querySelector('.tilt.tilt-sheen')
    expect(screen.getByRole('alert')).toHaveTextContent(/do not match/i)
    expect(card.classList.contains('ft-shake')).toBe(true)
    act(() => { fireEvent.animationEnd(card, { animationName: 'ft-shake' }) })
    expect(card.classList.contains('ft-shake')).toBe(false)
  })

  it('shows a strength meter only where a password is being set', () => {
    const { container } = wrap(<Login />)
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'LongEnoughPw1!' } })
    expect(container.querySelector('.ft-strength')).toBeNull()         // sign-in: no meter
    fireEvent.click(screen.getByText(/create account/i))
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'LongEnoughPw' } })
    const meter = container.querySelector('.ft-strength')
    expect(meter.getAttribute('data-score')).toBe('2')
    expect(meter.querySelectorAll('i.on').length).toBe(2)
    expect(screen.getByText(/^Fair/)).toBeInTheDocument()
  })

  it('says when Caps Lock is on, only while the password is masked', () => {
    wrap(<Login />)
    const pw = screen.getByLabelText(/^password$/i)
    const caps = new KeyboardEvent('keyup', { bubbles: true })
    Object.defineProperty(caps, 'getModifierState', { value: (k) => k === 'CapsLock' })
    fireEvent(pw, caps)
    expect(screen.getByText(/caps lock is on/i)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/show password/i))        // unmasked: the hint is moot
    expect(screen.queryByText(/caps lock is on/i)).toBeNull()
    fireEvent.blur(pw)
  })

  it('swaps the heading with the mode', () => {
    wrap(<Login />)
    expect(screen.getByText(/sign in to your workspace/i).classList.contains('ft-swap')).toBe(true)
    fireEvent.click(screen.getByText(/use legacy password/i))
    expect(screen.getByText(/temporary legacy access/i)).toBeInTheDocument()
  })
})
