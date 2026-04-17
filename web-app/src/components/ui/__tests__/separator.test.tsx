import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Separator } from '../separator'

describe('Separator', () => {
  it('renders with horizontal orientation by default', () => {
    render(<Separator data-testid="sep" />)
    const sep = screen.getByTestId('sep')
    expect(sep).toBeInTheDocument()
    expect(sep).toHaveAttribute('data-orientation', 'horizontal')
  })

  it('renders with vertical orientation', () => {
    render(<Separator data-testid="sep" orientation="vertical" />)
    expect(screen.getByTestId('sep')).toHaveAttribute('data-orientation', 'vertical')
  })

  it('has data-slot attribute', () => {
    render(<Separator data-testid="sep" />)
    expect(screen.getByTestId('sep')).toHaveAttribute('data-slot', 'separator')
  })

  it('accepts custom className', () => {
    render(<Separator data-testid="sep" className="my-sep" />)
    expect(screen.getByTestId('sep')).toHaveClass('my-sep')
  })
})
