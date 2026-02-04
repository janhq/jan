import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Progress } from '../progress'

describe('Progress', () => {
  it('renders progress element', () => {
    render(<Progress value={50} />)
    
    const progress = document.querySelector('[data-slot="progress"]')
    expect(progress).toBeInTheDocument()
  })

  it('renders with correct value', () => {
    render(<Progress value={75} />)
    
    const indicator = document.querySelector('[data-slot="progress-indicator"]')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveStyle('transform: translateX(-25%)')
  })

  it('renders with zero value', () => {
    render(<Progress value={0} />)
    
    const indicator = document.querySelector('[data-slot="progress-indicator"]')
    expect(indicator).toHaveStyle('transform: translateX(-100%)')
  })

  it('renders with full value', () => {
    render(<Progress value={100} />)
    
    const indicator = document.querySelector('[data-slot="progress-indicator"]')
    expect(indicator).toHaveStyle('transform: translateX(-0%)')
  })

  it('renders with custom className', () => {
    render(<Progress value={50} className="custom-progress" />)
    
    const progress = document.querySelector('[data-slot="progress"]')
    expect(progress).toHaveClass('custom-progress')
  })

  it('renders with default styling classes', () => {
    render(<Progress value={50} />)
<<<<<<< HEAD
    
    const progress = document.querySelector('[data-slot="progress"]')
    expect(progress).toHaveClass('bg-accent/30')
=======

    const progress = document.querySelector('[data-slot="progress"]')
    expect(progress).toHaveClass('bg-secondary')
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    expect(progress).toHaveClass('relative')
    expect(progress).toHaveClass('h-2')
    expect(progress).toHaveClass('w-full')
    expect(progress).toHaveClass('overflow-hidden')
    expect(progress).toHaveClass('rounded-full')
  })

  it('renders indicator with correct styling', () => {
    render(<Progress value={50} />)
<<<<<<< HEAD
    
    const indicator = document.querySelector('[data-slot="progress-indicator"]')
    expect(indicator).toHaveClass('bg-accent')
=======

    const indicator = document.querySelector('[data-slot="progress-indicator"]')
    expect(indicator).toHaveClass('bg-primary')
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    expect(indicator).toHaveClass('h-full')
    expect(indicator).toHaveClass('w-full')
    expect(indicator).toHaveClass('flex-1')
    expect(indicator).toHaveClass('transition-all')
  })

  it('handles undefined value', () => {
    render(<Progress />)
    
    const indicator = document.querySelector('[data-slot="progress-indicator"]')
    expect(indicator).toHaveStyle('transform: translateX(-100%)')
  })

  it('handles negative values', () => {
    render(<Progress value={-10} />)
    
    const indicator = document.querySelector('[data-slot="progress-indicator"]')
    expect(indicator).toHaveStyle('transform: translateX(-110%)')
  })

  it('handles values over 100', () => {
    render(<Progress value={150} />)
    
    const indicator = document.querySelector('[data-slot="progress-indicator"]')
    expect(indicator).toBeInTheDocument()
    // For values over 100, the transform should be positive
    expect(indicator?.style.transform).toContain('translateX(--50%)')
  })
})
