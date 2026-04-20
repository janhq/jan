import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Toaster } from '../sonner'

// Mock sonner
vi.mock('sonner', () => ({
  Toaster: ({ className, expand, richColors, closeButton, ...props }: any) => (
    <div 
      data-testid="toaster" 
      className={className} 
      {...props}
      {...(expand !== undefined && { 'data-expand': expand })}
      {...(richColors !== undefined && { 'data-rich-colors': richColors })}
      {...(closeButton !== undefined && { 'data-close-button': closeButton })}
    >
      Toaster Component
    </div>
  ),
}))

describe('Toaster Component', () => {
  it('should render toaster component', () => {
    render(<Toaster />)
    
    const toaster = screen.getByTestId('toaster')
    expect(toaster).toBeDefined()
    expect(screen.getByText('Toaster Component')).toBeDefined()
  })

  it('should apply default className', () => {
    render(<Toaster />)
    
    const toaster = screen.getByTestId('toaster')
    expect(toaster).toHaveClass('toaster', 'group')
  })

  it('should pass through additional props', () => {
    render(<Toaster position="top-right" duration={5000} />)
    
    const toaster = screen.getByTestId('toaster')
    expect(toaster).toHaveAttribute('position', 'top-right')
    expect(toaster).toHaveAttribute('duration', '5000')
  })

  it('should maintain default className with additional props', () => {
    render(<Toaster position="bottom-left" />)
    
    const toaster = screen.getByTestId('toaster')
    expect(toaster).toHaveClass('toaster', 'group')
    expect(toaster).toHaveAttribute('position', 'bottom-left')
  })

  it('should handle custom expand prop', () => {
    render(<Toaster expand />)
    
    const toaster = screen.getByTestId('toaster')
    expect(toaster).toHaveAttribute('data-expand', 'true')
  })

  it('should handle custom richColors prop', () => {
    render(<Toaster richColors />)
    
    const toaster = screen.getByTestId('toaster')
    expect(toaster).toHaveAttribute('data-rich-colors', 'true')
  })

  it('should handle custom closeButton prop', () => {
    render(<Toaster closeButton />)
    
    const toaster = screen.getByTestId('toaster')
    expect(toaster).toHaveAttribute('data-close-button', 'true')
  })

  it('should handle multiple props', () => {
    render(
      <Toaster 
        position="top-center" 
        duration={3000} 
        expand 
        richColors 
        closeButton 
      />
    )
    
    const toaster = screen.getByTestId('toaster')
    expect(toaster).toHaveClass('toaster', 'group')
    expect(toaster).toHaveAttribute('position', 'top-center')
    expect(toaster).toHaveAttribute('duration', '3000')
    expect(toaster).toHaveAttribute('data-expand', 'true')
    expect(toaster).toHaveAttribute('data-rich-colors', 'true')
    expect(toaster).toHaveAttribute('data-close-button', 'true')
  })
})
