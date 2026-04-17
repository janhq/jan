import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../card'

describe('Card components', () => {
  it('renders Card', () => {
    render(<Card data-testid="card">Content</Card>)
    expect(screen.getByTestId('card')).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('renders CardHeader', () => {
    render(<CardHeader data-testid="header">Header</CardHeader>)
    expect(screen.getByTestId('header')).toBeInTheDocument()
  })

  it('renders CardTitle', () => {
    render(<CardTitle>Title</CardTitle>)
    expect(screen.getByText('Title')).toBeInTheDocument()
  })

  it('renders CardDescription', () => {
    render(<CardDescription>Description</CardDescription>)
    expect(screen.getByText('Description')).toBeInTheDocument()
  })

  it('renders CardContent', () => {
    render(<CardContent data-testid="content">Body</CardContent>)
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('renders CardFooter', () => {
    render(<CardFooter data-testid="footer">Footer</CardFooter>)
    expect(screen.getByTestId('footer')).toBeInTheDocument()
  })

  it('accepts custom className', () => {
    render(<Card data-testid="card" className="my-class">X</Card>)
    expect(screen.getByTestId('card')).toHaveClass('my-class')
  })
})
