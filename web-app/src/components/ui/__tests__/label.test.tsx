import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Label } from '../label'

describe('Label', () => {
  it('renders label text', () => {
    render(<Label>Username</Label>)
    expect(screen.getByText('Username')).toBeInTheDocument()
  })

  it('accepts custom className', () => {
    render(<Label data-testid="label" className="custom">X</Label>)
    expect(screen.getByTestId('label')).toHaveClass('custom')
  })

  it('has data-slot attribute', () => {
    render(<Label data-testid="label">X</Label>)
    expect(screen.getByTestId('label')).toHaveAttribute('data-slot', 'label')
  })
})
