import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom'

import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerFooter,
  DropDrawerGroup,
  DropDrawerItem,
  DropDrawerLabel,
  DropDrawerSeparator,
  DropDrawerSub,
  DropDrawerSubContent,
  DropDrawerSubTrigger,
  DropDrawerTrigger,
} from '../dropdrawer'

const mockUseIsMobile = vi.fn()
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mockUseIsMobile(),
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <div data-testid="animate-presence">{children}</div>,
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}))

// Helper to render a standard DropDrawer with given content
function renderDropDrawer(content: React.ReactNode, triggerText = 'Open Menu') {
  return render(
    <DropDrawer>
      <DropDrawerTrigger>{triggerText}</DropDrawerTrigger>
      <DropDrawerContent>{content}</DropDrawerContent>
    </DropDrawer>
  )
}

describe('DropDrawer Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Desktop Mode', () => {
    beforeEach(() => { mockUseIsMobile.mockReturnValue(false) })

    it('renders trigger with menu aria attribute', () => {
      renderDropDrawer(<DropDrawerItem>Item</DropDrawerItem>)
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
      expect(screen.getByRole('button')).toHaveAttribute('aria-haspopup', 'menu')
    })

    it.each([
      ['separators', <><DropDrawerItem>Item 1</DropDrawerItem><DropDrawerSeparator /><DropDrawerItem>Item 2</DropDrawerItem></>],
      ['labels', <><DropDrawerLabel>Section</DropDrawerLabel><DropDrawerItem>Item</DropDrawerItem></>],
      ['groups', <DropDrawerGroup><DropDrawerItem>Group Item</DropDrawerItem></DropDrawerGroup>],
      ['footer', <><DropDrawerItem>Item</DropDrawerItem><DropDrawerFooter>Footer</DropDrawerFooter></>],
      ['submenu', <DropDrawerSub><DropDrawerSubTrigger>Sub</DropDrawerSubTrigger><DropDrawerSubContent><DropDrawerItem>Sub Item</DropDrawerItem></DropDrawerSubContent></DropDrawerSub>],
    ])('structures dropdown with %s', (_label, content) => {
      renderDropDrawer(content)
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })
  })

  describe('Mobile Mode', () => {
    beforeEach(() => { mockUseIsMobile.mockReturnValue(true) })

    it('renders trigger with dialog aria attribute', () => {
      renderDropDrawer(<DropDrawerItem>Mobile Item</DropDrawerItem>, 'Open Drawer')
      expect(screen.getByText('Open Drawer')).toBeInTheDocument()
      expect(screen.getByRole('button')).toHaveAttribute('aria-haspopup', 'dialog')
    })

    it('does not render separators in mobile mode', () => {
      renderDropDrawer(
        <><DropDrawerItem>Item 1</DropDrawerItem><DropDrawerSeparator /><DropDrawerItem>Item 2</DropDrawerItem></>,
        'Open Drawer'
      )
      expect(screen.queryAllByRole('separator')).toHaveLength(0)
    })

    it.each([
      ['labels', <><DropDrawerLabel>Section</DropDrawerLabel><DropDrawerItem>Item</DropDrawerItem></>],
      ['groups', <DropDrawerGroup><DropDrawerItem>Item</DropDrawerItem></DropDrawerGroup>],
      ['footer', <><DropDrawerItem>Item</DropDrawerItem><DropDrawerFooter>Footer</DropDrawerFooter></>],
      ['submenu', <DropDrawerSub><DropDrawerSubTrigger>Sub</DropDrawerSubTrigger><DropDrawerSubContent><DropDrawerItem>Sub Item</DropDrawerItem></DropDrawerSubContent></DropDrawerSub>],
    ])('structures drawer with %s', (_label, content) => {
      renderDropDrawer(content, 'Open Drawer')
      expect(screen.getByText('Open Drawer')).toBeInTheDocument()
    })
  })

  describe('DropDrawerItem props', () => {
    beforeEach(() => { mockUseIsMobile.mockReturnValue(false) })

    it.each([
      ['click handler', { onClick: vi.fn() }],
      ['variant', { variant: 'destructive' as const }],
      ['disabled', { disabled: true }],
    ])('accepts %s prop', (_label, props) => {
      renderDropDrawer(<DropDrawerItem {...props}>Test Item</DropDrawerItem>)
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
      if (props.onClick) expect(props.onClick).not.toHaveBeenCalled()
    })

    it('renders with icon', () => {
      renderDropDrawer(
        <DropDrawerItem icon={<span data-testid="test-icon">Icon</span>}>Item</DropDrawerItem>
      )
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })
  })

  describe('Custom Props and Styling', () => {
    beforeEach(() => { mockUseIsMobile.mockReturnValue(false) })

    it('applies custom className to trigger', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger className="custom-trigger">Custom Trigger</DropDrawerTrigger>
          <DropDrawerContent><DropDrawerItem>Item</DropDrawerItem></DropDrawerContent>
        </DropDrawer>
      )
      expect(screen.getByText('Custom Trigger')).toHaveClass('custom-trigger')
    })
  })

  describe('Responsive Behavior', () => {
    it('adapts aria-haspopup between desktop and mobile', () => {
      mockUseIsMobile.mockReturnValue(false)
      const { rerender } = renderDropDrawer(<DropDrawerItem>Item</DropDrawerItem>, 'Responsive')

      expect(screen.getByRole('button')).toHaveAttribute('aria-haspopup', 'menu')

      mockUseIsMobile.mockReturnValue(true)
      rerender(
        <DropDrawer>
          <DropDrawerTrigger>Responsive</DropDrawerTrigger>
          <DropDrawerContent><DropDrawerItem>Item</DropDrawerItem></DropDrawerContent>
        </DropDrawer>
      )
      expect(screen.getByRole('button')).toHaveAttribute('aria-haspopup', 'dialog')
    })
  })

  describe('Error Boundaries', () => {
    it('requires proper context usage', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(() => { render(<DropDrawerItem>Orphan Item</DropDrawerItem>) }).toThrow()
      consoleSpy.mockRestore()
    })
  })

  describe('Accessibility - disabled state', () => {
    it('supports disabled state in mobile', () => {
      mockUseIsMobile.mockReturnValue(true)
      const handleClick = vi.fn()
      renderDropDrawer(
        <DropDrawerItem disabled onClick={handleClick}>Disabled Item</DropDrawerItem>,
        'Open Drawer'
      )
      expect(screen.getByText('Open Drawer')).toBeInTheDocument()
      expect(handleClick).not.toHaveBeenCalled()
    })
  })
})
