import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HoverCard, HoverCardTrigger, HoverCardContent } from '../hover-card'

// Mock Radix UI
vi.mock('@radix-ui/react-hover-card', () => ({
  Root: ({ children, ...props }: any) => <div data-testid="hover-card-root" {...props}>{children}</div>,
  Trigger: ({ children, ...props }: any) => <button data-testid="hover-card-trigger" {...props}>{children}</button>,
  Portal: ({ children, ...props }: any) => <div data-testid="hover-card-portal" {...props}>{children}</div>,
  Content: ({ children, className, align, sideOffset, ...props }: any) => (
    <div 
      data-testid="hover-card-content" 
      className={className}
      data-align={align}
      data-side-offset={sideOffset}
      {...props}
    >
      {children}
    </div>
  ),
}))

describe('HoverCard Components', () => {
  describe('HoverCard', () => {
    it('should render HoverCard root component', () => {
      render(
        <HoverCard>
          <div>Test content</div>
        </HoverCard>
      )

      const hoverCard = screen.getByTestId('hover-card-root')
      expect(hoverCard).toBeDefined()
      expect(hoverCard).toHaveAttribute('data-slot', 'hover-card')
      expect(screen.getByText('Test content')).toBeDefined()
    })

    it('should pass through props to root component', () => {
      render(
        <HoverCard openDelay={500}>
          <div>Test content</div>
        </HoverCard>
      )

      const hoverCard = screen.getByTestId('hover-card-root')
      expect(hoverCard).toHaveAttribute('openDelay', '500')
    })
  })

  describe('HoverCardTrigger', () => {
    it('should render trigger component', () => {
      render(
        <HoverCardTrigger>
          <span>Hover me</span>
        </HoverCardTrigger>
      )

      const trigger = screen.getByTestId('hover-card-trigger')
      expect(trigger).toBeDefined()
      expect(trigger).toHaveAttribute('data-slot', 'hover-card-trigger')
      expect(screen.getByText('Hover me')).toBeDefined()
    })

    it('should pass through props to trigger component', () => {
      render(
        <HoverCardTrigger disabled>
          <span>Disabled trigger</span>
        </HoverCardTrigger>
      )

      const trigger = screen.getByTestId('hover-card-trigger')
      expect(trigger).toHaveAttribute('disabled')
    })
  })

  describe('HoverCardContent', () => {
    it('should render content with default props', () => {
      render(
        <HoverCardContent>
          <div>Content here</div>
        </HoverCardContent>
      )

      const portal = screen.getByTestId('hover-card-portal')
      expect(portal).toHaveAttribute('data-slot', 'hover-card-portal')

      const content = screen.getByTestId('hover-card-content')
      expect(content).toBeDefined()
      expect(content).toHaveAttribute('data-slot', 'hover-card-content')
      expect(content).toHaveAttribute('data-align', 'center')
      expect(content).toHaveAttribute('data-side-offset', '4')
      expect(screen.getByText('Content here')).toBeDefined()
    })

    it('should render content with custom props', () => {
      render(
        <HoverCardContent align="start" sideOffset={8} className="custom-class">
          <div>Custom content</div>
        </HoverCardContent>
      )

      const content = screen.getByTestId('hover-card-content')
      expect(content).toHaveAttribute('data-align', 'start')
      expect(content).toHaveAttribute('data-side-offset', '8')
      expect(content.className).toContain('custom-class')
    })

    it('should apply default styling classes', () => {
      render(
        <HoverCardContent>
          <div>Content</div>
        </HoverCardContent>
      )

      const content = screen.getByTestId('hover-card-content')
      expect(content.className).toContain('bg-main-view')
      expect(content.className).toContain('text-main-view-fg/70')
      expect(content.className).toContain('rounded-md')
      expect(content.className).toContain('border')
      expect(content.className).toContain('shadow-md')
    })

    it('should merge custom className with default classes', () => {
      render(
        <HoverCardContent className="my-custom-class">
          <div>Content</div>
        </HoverCardContent>
      )

      const content = screen.getByTestId('hover-card-content')
      expect(content.className).toContain('bg-main-view')
      expect(content.className).toContain('my-custom-class')
    })

    it('should pass through additional props', () => {
      render(
        <HoverCardContent data-testprop="test-value">
          <div>Content</div>
        </HoverCardContent>
      )

      const content = screen.getByTestId('hover-card-content')
      expect(content).toHaveAttribute('data-testprop', 'test-value')
    })
  })

  describe('Integration', () => {
    it('should render complete hover card structure', () => {
      render(
        <HoverCard>
          <HoverCardTrigger>
            <button>Trigger</button>
          </HoverCardTrigger>
          <HoverCardContent>
            <div>Hover content</div>
          </HoverCardContent>
        </HoverCard>
      )

      expect(screen.getByTestId('hover-card-root')).toBeDefined()
      expect(screen.getByTestId('hover-card-trigger')).toBeDefined()
      expect(screen.getByTestId('hover-card-portal')).toBeDefined()
      expect(screen.getByTestId('hover-card-content')).toBeDefined()
      expect(screen.getByText('Trigger')).toBeDefined()
      expect(screen.getByText('Hover content')).toBeDefined()
    })
  })
})
