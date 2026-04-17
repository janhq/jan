import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MermaidError } from '../MermaidError'

describe('MermaidError', () => {
  const defaultProps = {
    error: 'Syntax error in diagram',
    chart: 'graph TD; A-->B',
    retry: () => {},
    messageId: 'msg-1',
  }

  it('renders error message', () => {
    render(<MermaidError {...defaultProps} />)
    expect(screen.getByText('Syntax error in diagram')).toBeInTheDocument()
  })

  it('renders "Diagram error detected" text', () => {
    render(<MermaidError {...defaultProps} />)
    expect(screen.getByText('Diagram error detected')).toBeInTheDocument()
  })

  it('renders Jan logo', () => {
    render(<MermaidError {...defaultProps} />)
    expect(screen.getByAltText('Jan Logo')).toBeInTheDocument()
  })
})
