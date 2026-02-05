import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Skeleton } from '../skeleton'

describe('Skeleton', () => {
  it('renders skeleton element', () => {
    render(<Skeleton />)
    
    const skeleton = document.querySelector('[data-slot="skeleton"]')
    expect(skeleton).toBeInTheDocument()
  })

  it('renders with custom className', () => {
    render(<Skeleton className="custom-class" />)
    
    const skeleton = document.querySelector('.custom-class')
    expect(skeleton).toBeInTheDocument()
  })

  it('renders with default styling classes', () => {
    render(<Skeleton />)
    
    const skeleton = document.querySelector('[data-slot="skeleton"]')
    expect(skeleton).toHaveClass('bg-main-view-fg/10')
  })

  it('renders with custom width and height', () => {
    render(<Skeleton className="w-32 h-8" />)
    
    const skeleton = document.querySelector('.w-32')
    expect(skeleton).toBeInTheDocument()
    expect(skeleton).toHaveClass('h-8')
  })

  it('renders multiple skeletons', () => {
    render(
      <div>
        <Skeleton className="skeleton-1" />
        <Skeleton className="skeleton-2" />
        <Skeleton className="skeleton-3" />
      </div>
    )
    
    expect(document.querySelector('.skeleton-1')).toBeInTheDocument()
    expect(document.querySelector('.skeleton-2')).toBeInTheDocument()
    expect(document.querySelector('.skeleton-3')).toBeInTheDocument()
  })

  it('renders as div element', () => {
    render(<Skeleton data-testid="skeleton" />)
    
    const skeleton = screen.getByTestId('skeleton')
    expect(skeleton.tagName).toBe('DIV')
  })

  it('merges custom styles with default styles', () => {
    render(<Skeleton className="bg-red-500 w-full" />)
    
    const skeleton = document.querySelector('[data-slot="skeleton"]')
    expect(skeleton).toBeInTheDocument()
    expect(skeleton).toHaveClass('w-full')
    expect(skeleton).toHaveClass('bg-red-500')
  })
})
