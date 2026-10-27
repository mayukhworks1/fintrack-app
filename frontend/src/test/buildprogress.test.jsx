/**
 * The build screen reads real steps from the streamed document, shows a
 * progress bar and how much is written, and swaps in a live preview once the
 * screen has started to take shape.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
  api: { pages: { preview: vi.fn().mockResolvedValue({ token: 'live-tok', expires_in: 900 }), artifactToken: vi.fn() } },
  API_BASE_URL: '',
}))

import { api } from '../services/api'
import BuildProgress, { BUILD_STEPS, buildPercent, currentStep, previewableDraft } from '../components/artifacts/BuildProgress'

const HEAD = '<!DOCTYPE html><html><head><style>body{font:16px sans-serif}</style></head>'
const BODY = HEAD + '<body><h1>SIP planner</h1>' + '<p>row</p>'.repeat(200)

describe('build steps', () => {
  it('moves through the steps as the document is written', () => {
    const at = (d) => BUILD_STEPS[currentStep(d)].key
    expect(at('')).toBe('read')
    expect(at('<!DOCTYPE html><html><head>')).toBe('setup')
    expect(at(HEAD)).toBe('style')
    expect(at(BODY)).toBe('layout')
    expect(at(BODY + '<script>let a = 1')).toBe('logic')
    expect(at(BODY + '<script>let a = 1</script></body></html>')).toBe('finish')
  })

  it('grows the bar and never reaches 100% before the build is done', () => {
    const steps = ['', HEAD, BODY, BODY + '<script>' + 'x'.repeat(20000) + '</script></body></html>'].map(buildPercent)
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1])
    expect(Math.max(...steps)).toBeLessThanOrEqual(95)
  })

  it('leaves an unfinished script out of the live preview', () => {
    expect(previewableDraft(HEAD)).toBe('')
    const half = BODY + '<script>function total(){ return'
    expect(previewableDraft(half)).toBe(BODY)
    const whole = BODY + '<script>let a=1</script><p>after</p>'
    expect(previewableDraft(whole)).toBe(whole)
  })
})

describe('BuildProgress', () => {
  it('shows the step, size and an accessible progress bar before the screen exists', () => {
    render(<BuildProgress title="Building your artifact" draft={HEAD} thought="" elapsed={4} onCancel={() => {}} />)
    const bar = screen.getByRole('progressbar', { name: 'Build progress' })
    expect(bar.getAttribute('aria-valuetext')).toMatch(/Designing the look/)
    expect(screen.getByText(/written · 1 lines/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(api.pages.preview).not.toHaveBeenCalled()
  })

  it('swaps in a live preview once the body has started', async () => {
    render(<BuildProgress title="Building your artifact" draft={BODY} thought="" elapsed={12} onCancel={() => {}} />)
    await waitFor(() => expect(api.pages.preview).toHaveBeenCalledWith(BODY))
    expect(await screen.findByText(/Live preview, still being built/)).toBeTruthy()
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  it('says so when a build is taking longer than usual', () => {
    render(<BuildProgress title="Building your artifact" draft="" thought="Planning the layout" elapsed={75} onCancel={() => {}} />)
    expect(screen.getByText(/Taking a little longer than usual/)).toBeTruthy()
    expect(screen.getByText('Planning the layout')).toBeTruthy()
  })
})
