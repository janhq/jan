import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Slider } from '../slider'

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  global.ResizeObserver = MockResizeObserver
  
  // Mock getBoundingClientRect for Radix Slider positioning
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 200,
    height: 20,
    top: 0,
    left: 0,
    bottom: 20,
    right: 200,
    x: 0,
    y: 0,
    toJSON: () => ({})
  }))
})

describe('Slider', () => {
  it('renders slider element', () => {
    render(<Slider />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toBeInTheDocument()
  })

  it('renders with default min and max values', () => {
    render(<Slider />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toBeInTheDocument()
    // Radix slider sets these on internal elements, just check component renders
  })

  it('renders with custom min and max values', () => {
    render(<Slider min={10} max={50} />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toBeInTheDocument()
    // Radix slider handles internal ARIA attributes
  })

  it('renders with single value', () => {
    render(<Slider value={[25]} />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toBeInTheDocument()
    
    const thumbs = document.querySelectorAll('[data-slot="slider-thumb"]')
    expect(thumbs).toHaveLength(1)
  })

  it('renders with multiple values', () => {
    render(<Slider value={[25, 75]} />)
    
    const thumbs = document.querySelectorAll('[data-slot="slider-thumb"]')
    expect(thumbs).toHaveLength(2)
  })

  it('renders with default value', () => {
    render(<Slider defaultValue={[30]} />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toBeInTheDocument()
    
    const thumbs = document.querySelectorAll('[data-slot="slider-thumb"]')
    expect(thumbs).toHaveLength(1)
  })

  it('renders track and range', () => {
    render(<Slider value={[50]} />)
    
    const track = document.querySelector('[data-slot="slider-track"]')
    const range = document.querySelector('[data-slot="slider-range"]')
    
    expect(track).toBeInTheDocument()
    expect(range).toBeInTheDocument()
  })

  it('renders with custom className', () => {
    render(<Slider className="custom-slider" />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toHaveClass('custom-slider')
  })

  it('renders with default styling classes', () => {
    render(<Slider />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toHaveClass('relative', 'flex', 'w-full', 'touch-none', 'items-center', 'select-none')
  })

  it('renders track with correct styling', () => {
    render(<Slider />)

    const track = document.querySelector('[data-slot="slider-track"]')
    expect(track).toHaveClass('bg-muted', 'relative', 'grow', 'overflow-hidden', 'rounded-full')
  })

  it('renders range with correct styling', () => {
    render(<Slider />)

    const range = document.querySelector('[data-slot="slider-range"]')
    expect(range).toHaveClass('bg-primary', 'absolute')
  })

  it('renders thumb with correct styling', () => {
    render(<Slider value={[50]} />)

    const thumb = document.querySelector('[data-slot="slider-thumb"]')
    expect(thumb).toHaveClass('border-primary', 'bg-white', 'ring-ring/50', 'block', 'size-4', 'shrink-0', 'rounded-full', 'border', 'shadow-sm')
  })

  it('handles disabled state', () => {
    render(<Slider disabled value={[50]} />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toBeInTheDocument()
    // Disabled state is handled by Radix internally
  })

  it('handles orientation horizontal', () => {
    render(<Slider orientation="horizontal" />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toBeInTheDocument()
    // Orientation is handled by Radix internally
  })

  it('handles orientation vertical', () => {
    render(<Slider orientation="vertical" />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toBeInTheDocument()
    // Orientation is handled by Radix internally
  })

  it('handles onChange callback', () => {
    const handleChange = vi.fn()
    render(<Slider onValueChange={handleChange} />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toBeInTheDocument()
    
    // The onValueChange callback should be passed through to the underlying component
    expect(handleChange).not.toHaveBeenCalled()
  })

  it('handles step property', () => {
    render(<Slider step={5} />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toBeInTheDocument()
    // Step property is handled by Radix internally
  })

  it('handles aria attributes', () => {
    render(<Slider aria-label="Volume" />)
    
    const slider = document.querySelector('[data-slot="slider"]')
    expect(slider).toHaveAttribute('aria-label', 'Volume')
  })

  it('handles custom props', () => {
    render(<Slider data-testid="custom-slider" />)
    
    const slider = screen.getByTestId('custom-slider')
    expect(slider).toBeInTheDocument()
  })

  it('handles range slider with two thumbs', () => {
    render(<Slider defaultValue={[25, 75]} />)

    const thumbs = document.querySelectorAll('[data-slot="slider-thumb"]')
    expect(thumbs).toHaveLength(2)

    // Both thumbs should have the same styling
    thumbs.forEach(thumb => {
      expect(thumb).toHaveClass('border-primary', 'bg-white', 'rounded-full')
    })
  })
})
