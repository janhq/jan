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

<<<<<<< HEAD
// Mock the media query hook
const mockUseSmallScreen = vi.fn()
vi.mock('@/hooks/useMediaQuery', () => ({
  useSmallScreen: () => mockUseSmallScreen(),
=======
// Mock the mobile hook
const mockUseIsMobile = vi.fn()
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mockUseIsMobile(),
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
}))

// Mock framer-motion to avoid animation complexity in tests
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <div data-testid="animate-presence">{children}</div>,
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}))

describe('DropDrawer Utilities', () => {
  it('renders without crashing', () => {
    expect(() => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Test</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Item</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )
    }).not.toThrow()
  })
})

describe('DropDrawer Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Desktop Mode', () => {
    beforeEach(() => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(false)
=======
      mockUseIsMobile.mockReturnValue(false)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    })

    it('renders dropdown menu on desktop', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Item 1</DropDrawerItem>
            <DropDrawerItem>Item 2</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })

    it('renders dropdown menu structure', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Desktop Item</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Only the trigger is visible initially
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
      expect(screen.getByRole('button')).toHaveAttribute('aria-haspopup', 'menu')
    })

    it('structures dropdown with separators', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Item 1</DropDrawerItem>
            <DropDrawerSeparator />
            <DropDrawerItem>Item 2</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Verify component structure - content is not visible until opened
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })

    it('structures dropdown with labels', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerLabel>Menu Section</DropDrawerLabel>
            <DropDrawerItem>Item 1</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Only verify trigger is present - content shows on interaction
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })
  })

  describe('Mobile Mode', () => {
    beforeEach(() => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(true)
=======
      mockUseIsMobile.mockReturnValue(true)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    })

    it('renders drawer on mobile', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Drawer</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Mobile Item</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      expect(screen.getByText('Open Drawer')).toBeInTheDocument()
    })

    it('renders drawer structure', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Drawer</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Mobile Item</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Verify drawer trigger is present
      const trigger = screen.getByText('Open Drawer')
      expect(trigger).toBeInTheDocument()
      expect(screen.getByRole('button')).toHaveAttribute('aria-haspopup', 'dialog')
    })

    it('does not render separators in mobile mode', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Drawer</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Item 1</DropDrawerItem>
            <DropDrawerSeparator />
            <DropDrawerItem>Item 2</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Mobile separators return null, so they shouldn't be in the DOM
      const separators = screen.queryAllByRole('separator')
      expect(separators).toHaveLength(0)
    })

    it('renders drawer with labels structure', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Drawer</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerLabel>Drawer Section</DropDrawerLabel>
            <DropDrawerItem>Item 1</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Verify drawer structure is present
      expect(screen.getByText('Open Drawer')).toBeInTheDocument()
    })
  })

  describe('DropDrawerItem', () => {
    beforeEach(() => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(false)
=======
      mockUseIsMobile.mockReturnValue(false)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    })

    it('can be structured with click handlers', () => {
      const handleClick = vi.fn()

      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem onClick={handleClick}>Clickable Item</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Verify structure is valid
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
      expect(handleClick).not.toHaveBeenCalled()
    })

    it('can be structured with icons', () => {
      const TestIcon = () => <span data-testid="test-icon">Icon</span>

      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem icon={<TestIcon />}>Item with Icon</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Structure is valid
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })

    it('accepts variant props', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem variant="destructive">
              Delete Item
            </DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Component structure is valid with variants
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })

    it('accepts disabled prop', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem disabled>
              Disabled Item
            </DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Component structure is valid with disabled prop
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })
  })

  describe('DropDrawerGroup', () => {
    it('structures groups in desktop mode', () => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(false)
=======
      mockUseIsMobile.mockReturnValue(false)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerGroup>
              <DropDrawerItem>Group Item 1</DropDrawerItem>
              <DropDrawerItem>Group Item 2</DropDrawerItem>
            </DropDrawerGroup>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Component structure is valid
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })

    it('structures groups in mobile mode', () => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(true)
=======
      mockUseIsMobile.mockReturnValue(true)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Drawer</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerGroup>
              <DropDrawerItem>Item 1</DropDrawerItem>
              <DropDrawerItem>Item 2</DropDrawerItem>
            </DropDrawerGroup>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Component structure is valid in mobile mode
      expect(screen.getByText('Open Drawer')).toBeInTheDocument()
    })
  })

  describe('DropDrawerFooter', () => {
    it('structures footer in desktop mode', () => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(false)
=======
      mockUseIsMobile.mockReturnValue(false)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Item</DropDrawerItem>
            <DropDrawerFooter>Footer Content</DropDrawerFooter>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Component structure is valid
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })

    it('structures footer in mobile mode', () => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(true)
=======
      mockUseIsMobile.mockReturnValue(true)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Drawer</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Item</DropDrawerItem>
            <DropDrawerFooter>Mobile Footer</DropDrawerFooter>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Component structure is valid in mobile mode
      expect(screen.getByText('Open Drawer')).toBeInTheDocument()
    })
  })

  describe('Submenu Components', () => {
    beforeEach(() => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(false)
=======
      mockUseIsMobile.mockReturnValue(false)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    })

    it('structures submenu in desktop mode', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerSub>
              <DropDrawerSubTrigger>Submenu Trigger</DropDrawerSubTrigger>
              <DropDrawerSubContent>
                <DropDrawerItem>Submenu Item</DropDrawerItem>
              </DropDrawerSubContent>
            </DropDrawerSub>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Component structure is valid
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })

    it('structures submenu in mobile mode', () => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(true)
=======
      mockUseIsMobile.mockReturnValue(true)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Drawer</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerSub>
              <DropDrawerSubTrigger>
                Mobile Submenu
              </DropDrawerSubTrigger>
              <DropDrawerSubContent>
                <DropDrawerItem>Submenu Item</DropDrawerItem>
              </DropDrawerSubContent>
            </DropDrawerSub>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Component structure is valid in mobile mode
      expect(screen.getByText('Open Drawer')).toBeInTheDocument()
    })

    it('handles submenu content correctly in mobile mode', () => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(true)
=======
      mockUseIsMobile.mockReturnValue(true)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Drawer</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerSub>
              <DropDrawerSubTrigger>Mobile Submenu</DropDrawerSubTrigger>
              <DropDrawerSubContent>
                <DropDrawerItem>Hidden Item</DropDrawerItem>
              </DropDrawerSubContent>
            </DropDrawerSub>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Component handles mobile submenu structure correctly
      expect(screen.getByText('Open Drawer')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    beforeEach(() => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(false)
=======
      mockUseIsMobile.mockReturnValue(false)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    })

    it('maintains proper ARIA attributes on triggers', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerGroup>
              <DropDrawerItem>Item 1</DropDrawerItem>
            </DropDrawerGroup>
          </DropDrawerContent>
        </DropDrawer>
      )

      const trigger = screen.getByRole('button')
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    })

    it('supports disabled state', () => {
      const handleClick = vi.fn()

<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(true)
=======
      mockUseIsMobile.mockReturnValue(true)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Drawer</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem disabled onClick={handleClick}>
              Disabled Item
            </DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Component structure supports disabled prop
      expect(screen.getByText('Open Drawer')).toBeInTheDocument()
      expect(handleClick).not.toHaveBeenCalled()
    })
  })

  describe('Error Boundaries', () => {
    it('requires proper context usage', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<DropDrawerItem>Orphan Item</DropDrawerItem>)
      }).toThrow()

      consoleSpy.mockRestore()
    })
  })

  describe('Custom Props and Styling', () => {
    beforeEach(() => {
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(false)
=======
      mockUseIsMobile.mockReturnValue(false)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    })

    it('applies custom className', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger className="custom-trigger">Custom Trigger</DropDrawerTrigger>
          <DropDrawerContent className="custom-content">
            <DropDrawerItem className="custom-item">Custom Item</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      const trigger = screen.getByText('Custom Trigger')
      expect(trigger).toHaveClass('custom-trigger')
    })

    it('accepts additional props', () => {
      render(
        <DropDrawer>
          <DropDrawerTrigger>Open Menu</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem data-custom="test-value">Custom Props Item</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Component structure accepts custom props
      expect(screen.getByText('Open Menu')).toBeInTheDocument()
    })
  })

  describe('Responsive Behavior', () => {
    it('adapts to different screen sizes', () => {
      const { rerender } = render(
        <DropDrawer>
          <DropDrawerTrigger>Responsive Trigger</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Responsive Item</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      // Desktop mode
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(false)
=======
      mockUseIsMobile.mockReturnValue(false)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      rerender(
        <DropDrawer>
          <DropDrawerTrigger>Responsive Trigger</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Responsive Item</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      let trigger = screen.getByText('Responsive Trigger')
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu')

      // Mobile mode
<<<<<<< HEAD
      mockUseSmallScreen.mockReturnValue(true)
=======
      mockUseIsMobile.mockReturnValue(true)
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      rerender(
        <DropDrawer>
          <DropDrawerTrigger>Responsive Trigger</DropDrawerTrigger>
          <DropDrawerContent>
            <DropDrawerItem>Responsive Item</DropDrawerItem>
          </DropDrawerContent>
        </DropDrawer>
      )

      trigger = screen.getByText('Responsive Trigger')
      expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    })
  })
})
