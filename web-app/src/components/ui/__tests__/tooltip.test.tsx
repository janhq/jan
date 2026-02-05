import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../tooltip'

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  global.ResizeObserver = MockResizeObserver
  
  // Mock getBoundingClientRect for Radix Tooltip positioning
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 100,
    height: 20,
    top: 0,
    left: 0,
    bottom: 20,
    right: 100,
    x: 0,
    y: 0,
    toJSON: () => ({})
  }))
})

describe('Tooltip Components', () => {
  it('renders TooltipProvider', () => {
    render(
      <TooltipProvider>
        <div>Content</div>
      </TooltipProvider>
    )
    
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('renders Tooltip with provider', () => {
    render(
      <Tooltip>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Tooltip content</TooltipContent>
      </Tooltip>
    )
    
    expect(screen.getByText('Hover me')).toBeInTheDocument()
  })

  it('renders TooltipTrigger', () => {
    render(
      <Tooltip>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Tooltip content</TooltipContent>
      </Tooltip>
    )
    
    expect(screen.getByText('Hover me')).toBeInTheDocument()
  })

  it('renders basic tooltip structure', () => {
    render(
      <Tooltip>
        <TooltipTrigger>Trigger</TooltipTrigger>
        <TooltipContent>Content</TooltipContent>
      </Tooltip>
    )
    
    expect(screen.getByText('Trigger')).toBeInTheDocument()
  })

  it('renders with custom className', () => {
    render(
      <Tooltip>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent className="custom-tooltip">Tooltip content</TooltipContent>
      </Tooltip>
    )
    
    expect(screen.getByText('Hover me')).toBeInTheDocument()
  })

  it('handles custom delayDuration', () => {
    render(
      <TooltipProvider delayDuration={500}>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip content</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
    
    expect(screen.getByText('Hover me')).toBeInTheDocument()
  })

  it('renders multiple tooltips', () => {
    render(
      <div>
        <Tooltip>
          <TooltipTrigger>First</TooltipTrigger>
          <TooltipContent>First tooltip</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>Second</TooltipTrigger>
          <TooltipContent>Second tooltip</TooltipContent>
        </Tooltip>
      </div>
    )
    
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })
})
