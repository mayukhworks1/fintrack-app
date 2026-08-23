import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StreamingDraft from '../components/StreamingDraft'

// The reported gap: "why can't I see the AI agent writing things in real time".
// The generator streamed token by token and the client accumulated every delta
// into state — then rendered none of it. All anyone saw was a spinner and an
// elapsed counter.
describe('StreamingDraft shows the page being written', () => {
  it('renders nothing before the first delta arrives', () => {
    const { container } = render(<StreamingDraft content="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the content as it streams', () => {
    render(<StreamingDraft content={'<h1>Hello</h1>\n<p>World</p>'} />)
    expect(screen.getByText(/<h1>Hello<\/h1>/)).toBeInTheDocument()
  })

  it('reports how much has been written', () => {
    render(<StreamingDraft content={'x'.repeat(1234)} />)
    expect(screen.getByText('1,234 characters')).toBeInTheDocument()
  })

  it('surfaces sections from the tags the generator emits', () => {
    render(<StreamingDraft content={
      '<section data-agent-section="hero">a</section>' +
      '<section data-agent-section="pricing">b</section>'
    } />)
    expect(screen.getByText('hero')).toBeInTheDocument()
    expect(screen.getByText('pricing')).toBeInTheDocument()
  })

  it('renders only the tail of a long document', () => {
    // A landing page runs past 40,000 characters. Re-rendering all of it on
    // every delta makes the browser the bottleneck, and nobody is reading the
    // top of the file while the bottom is still being written.
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n')
    const { container } = render(<StreamingDraft content={long} />)
    const shown = container.querySelector('pre').textContent
    expect(shown).toContain('line 499')
    expect(shown).not.toContain('line 1\n')
  })

  it('announces progress to assistive tech without spamming it', () => {
    const { container } = render(<StreamingDraft content="<h1>x</h1>" />)
    expect(container.querySelector('pre')).toHaveAttribute('aria-live', 'polite')
  })

  it('labels a section rewrite differently from a full generation', () => {
    render(<StreamingDraft content="x" label="Rewriting the section" />)
    expect(screen.getByText('Rewriting the section')).toBeInTheDocument()
  })
})
