import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useAvatarSrc, _clearAvatarCache } from '../hooks/useAvatarSrc'

vi.mock('../services/api', () => ({ getAuthToken: () => 't', API_BASE_URL: '' }))

function Pic({ url }) {
  const src = useAvatarSrc(url)
  return <img alt="" data-src={src || ''} />
}

beforeEach(() => {
  _clearAvatarCache()
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:${++n}`)
})

describe('useAvatarSrc', () => {
  it('downloads one avatar once however many rows show it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<>{Array.from({ length: 78 }, (_, i) => <Pic key={i} url="/api/storage/file/me/avatar.png?v=1" />)}</>)
    await waitFor(() => expect(container.querySelectorAll('img[data-src="blob:1"]')).toHaveLength(78))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries after a failed download', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) })
    vi.stubGlobal('fetch', fetchMock)
    const first = render(<Pic url="/api/a.png" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    first.unmount()
    await new Promise(r => setTimeout(r, 0))
    const { container } = render(<Pic url="/api/a.png" />)
    await waitFor(() => expect(container.querySelector('img').dataset.src).toBe('blob:1'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('passes external URLs straight through', () => {
    const { container } = render(<Pic url="https://lh3.googleusercontent.com/x" />)
    expect(container.querySelector('img').dataset.src).toBe('https://lh3.googleusercontent.com/x')
  })
})
