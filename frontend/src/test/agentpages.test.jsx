import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AgentInterviewCard from '../components/AgentInterviewCard'
import { api } from '../services/api'

describe('AgentInterviewCard', () => {
  const sampleQuestions = [
    {
      id: 'theme',
      text: 'What visual style should the page have?',
      type: 'single',
      options: ['Dark glassmorphic', 'Clean modern', 'Warm editorial'],
    },
    {
      id: 'sections',
      text: 'Which sections should the page include?',
      type: 'multi',
      options: ['Hero banner', 'Pricing cards', 'Contact form'],
    },
  ]

  it('renders interview questions and options', () => {
    render(<AgentInterviewCard questions={sampleQuestions} onSkip={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByText('What visual style should the page have?')).toBeInTheDocument()
    expect(screen.getByText('Which sections should the page include?')).toBeInTheDocument()
    expect(screen.getByText('Dark glassmorphic')).toBeInTheDocument()
    expect(screen.getByText('Clean modern')).toBeInTheDocument()
    expect(screen.getByText('Hero banner')).toBeInTheDocument()
    expect(screen.getByText('Pricing cards')).toBeInTheDocument()
  })

  it('handles single selection and multi selection, then submits answers', () => {
    const handleSubmit = vi.fn()
    render(<AgentInterviewCard questions={sampleQuestions} onSkip={vi.fn()} onSubmit={handleSubmit} />)

    // Select single option
    fireEvent.click(screen.getByText('Dark glassmorphic'))

    // Select multi options
    fireEvent.click(screen.getByText('Hero banner'))
    fireEvent.click(screen.getByText('Pricing cards'))

    // Submit
    fireEvent.click(screen.getByText('✨ Generate with preferences'))

    expect(handleSubmit).toHaveBeenCalledTimes(1)
    expect(handleSubmit).toHaveBeenCalledWith({
      theme: 'Dark glassmorphic',
      sections: 'Hero banner, Pricing cards',
    })
  })

  it('allows deselecting a multi-option item', () => {
    const handleSubmit = vi.fn()
    render(<AgentInterviewCard questions={sampleQuestions} onSkip={vi.fn()} onSubmit={handleSubmit} />)

    // Select both, then deselect one
    fireEvent.click(screen.getByText('Hero banner'))
    fireEvent.click(screen.getByText('Pricing cards'))
    fireEvent.click(screen.getByText('Hero banner'))

    // Submit
    fireEvent.click(screen.getByText('✨ Generate with preferences'))

    expect(handleSubmit).toHaveBeenCalledWith({
      theme: '',
      sections: 'Pricing cards',
    })
  })

  it('calls onSkip when skip button is clicked', () => {
    const handleSkip = vi.fn()
    render(<AgentInterviewCard questions={sampleQuestions} onSkip={handleSkip} onSubmit={vi.fn()} />)

    fireEvent.click(screen.getByText('Skip — use prompt as-is'))
    expect(handleSkip).toHaveBeenCalledTimes(1)
  })

  it('returns null when questions list is empty', () => {
    const { container } = render(<AgentInterviewCard questions={[]} onSkip={vi.fn()} onSubmit={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('api.pages agent endpoints', () => {
  it('exposes aiStream, aiInterview, aiSectionEdit, and aiFixError', () => {
    expect(typeof api.pages.aiStream).toBe('function')
    expect(typeof api.pages.aiInterview).toBe('function')
    expect(typeof api.pages.aiSectionEdit).toBe('function')
    expect(typeof api.pages.aiFixError).toBe('function')
  })
})
