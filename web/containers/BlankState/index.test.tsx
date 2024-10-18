import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import BlankState from './index'

describe('BlankState Component', () => {
  it('renders title correctly', () => {
    const title = 'Test Title'
    render(<BlankState title={title} />)
    expect(screen.getByText(title)).toBeInTheDocument()
  })

  it('renders description correctly when provided', () => {
    const title = 'Test Title'
    const description = 'Test Description'
    render(<BlankState title={title} description={description} />)
    expect(screen.getByText(description)).toBeInTheDocument()
  })

  it('does not render description when not provided', () => {
    const title = 'Test Title'
    render(<BlankState title={title} />)
    expect(screen.queryByText('Test Description')).not.toBeInTheDocument()
  })

  it('renders action correctly when provided', () => {
    const title = 'Test Title'
    const action = <button>Test Action</button>
    render(<BlankState title={title} action={action} />)
    expect(screen.getByText('Test Action')).toBeInTheDocument()
  })

  it('does not render action when not provided', () => {
    const title = 'Test Title'
    render(<BlankState title={title} />)
    expect(screen.queryByText('Test Action')).not.toBeInTheDocument()
  })
})
