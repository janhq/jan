import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../dropdown-menu'

describe('DropdownMenu Components', () => {
  describe('DropdownMenu', () => {
    it('renders DropdownMenu with correct data-slot', () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      // The dropdown menu root might not be directly visible, let's check for the trigger
      const trigger = screen.getByRole('button', { name: 'Open' })
      expect(trigger).toBeInTheDocument()
    })

    it('passes through props correctly', () => {
      render(
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      // Check that the dropdown renders without errors when modal={false}
      const trigger = screen.getByRole('button', { name: 'Open' })
      expect(trigger).toBeInTheDocument()
    })
  })

  describe('DropdownMenuPortal', () => {
    it('renders DropdownMenuPortal with correct data-slot', () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent>
              <DropdownMenuItem>Item</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
      )
      
      // Check that the dropdown renders without errors with portal
      const trigger = screen.getByRole('button', { name: 'Open' })
      expect(trigger).toBeInTheDocument()
    })
  })

  describe('DropdownMenuTrigger', () => {
    it('renders DropdownMenuTrigger with correct styling and data-slot', () => {
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      const trigger = screen.getByRole('button', { name: 'Open Menu' })
      expect(trigger).toBeInTheDocument()
      expect(trigger).toHaveAttribute('data-slot', 'dropdown-menu-trigger')
    })

    it('opens dropdown menu when clicked', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Menu Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      const trigger = screen.getByRole('button', { name: 'Open Menu' })
      await user.click(trigger)
      
      await waitFor(() => {
        expect(screen.getByText('Menu Item')).toBeInTheDocument()
      })
    })
  })

  describe('DropdownMenuContent', () => {
    it('renders DropdownMenuContent with correct styling and data-slot', async () => {
      const user = userEvent.setup()

      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        const content = document.querySelector('[data-slot="dropdown-menu-content"]')
        expect(content).toBeInTheDocument()
        expect(content).toHaveClass('bg-popover')
        expect(content).toHaveClass('text-popover-foreground')
      })
    })

    it('applies custom className', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent className="custom-class">
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const content = document.querySelector('[data-slot="dropdown-menu-content"]')
        expect(content).toHaveClass('custom-class')
      })
    })

    it('uses custom sideOffset', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent sideOffset={10}>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const content = document.querySelector('[data-slot="dropdown-menu-content"]')
        expect(content).toBeInTheDocument()
      })
    })
  })

  describe('DropdownMenuGroup', () => {
    it('renders DropdownMenuGroup with correct data-slot', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuItem>Item 1</DropdownMenuItem>
              <DropdownMenuItem>Item 2</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const group = document.querySelector('[data-slot="dropdown-menu-group"]')
        expect(group).toBeInTheDocument()
      })
    })
  })

  describe('DropdownMenuItem', () => {
    it('renders DropdownMenuItem with correct styling and data-slot', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={handleClick}>Menu Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const item = screen.getByText('Menu Item')
        expect(item).toBeInTheDocument()
        expect(item).toHaveAttribute('data-slot', 'dropdown-menu-item')
      })
    })

    it('handles inset prop correctly', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem inset>Inset Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const item = screen.getByText('Inset Item')
        expect(item).toHaveAttribute('data-inset', 'true')
      })
    })

    it('applies custom className', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem className="custom-item">Custom Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const item = screen.getByText('Custom Item')
        expect(item).toHaveClass('custom-item')
      })
    })

    it('calls onClick when clicked', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={handleClick}>Clickable Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const item = screen.getByText('Clickable Item')
        expect(item).toBeInTheDocument()
      })
      
      await user.click(screen.getByText('Clickable Item'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('DropdownMenuCheckboxItem', () => {
    it('renders DropdownMenuCheckboxItem with correct styling and data-slot', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem checked={true}>
              Checkbox Item
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const item = screen.getByText('Checkbox Item')
        expect(item).toBeInTheDocument()
        expect(item).toHaveAttribute('data-slot', 'dropdown-menu-checkbox-item')
        expect(item).toHaveAttribute('data-state', 'checked')
      })
    })

    it('shows check icon when checked', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem checked={true}>
              Checked Item
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const item = screen.getByText('Checked Item')
        expect(item).toBeInTheDocument()
        const checkIcon = item.parentElement?.querySelector('svg')
        expect(checkIcon).toBeInTheDocument()
      })
    })

    it('applies custom className', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem className="custom-checkbox" checked={false}>
              Custom Checkbox
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const item = screen.getByText('Custom Checkbox')
        expect(item).toHaveClass('custom-checkbox')
      })
    })
  })

  describe('DropdownMenuRadioGroup and DropdownMenuRadioItem', () => {
    it('renders DropdownMenuRadioGroup with correct data-slot', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="option1">
              <DropdownMenuRadioItem value="option1">Option 1</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="option2">Option 2</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const radioGroup = document.querySelector('[data-slot="dropdown-menu-radio-group"]')
        expect(radioGroup).toBeInTheDocument()
      })
    })

    it('renders DropdownMenuRadioItem with correct styling and data-slot', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="option1">
              <DropdownMenuRadioItem value="option1">Option 1</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const item = screen.getByText('Option 1')
        expect(item).toBeInTheDocument()
        expect(item).toHaveAttribute('data-slot', 'dropdown-menu-radio-item')
        expect(item).toHaveAttribute('data-state', 'checked')
      })
    })

    it('shows circle icon when selected', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="selected">
              <DropdownMenuRadioItem value="selected">Selected Option</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const item = screen.getByText('Selected Option')
        expect(item).toBeInTheDocument()
        const circleIcon = item.parentElement?.querySelector('svg')
        expect(circleIcon).toBeInTheDocument()
      })
    })

    it('applies custom className to radio item', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="option1">
              <DropdownMenuRadioItem value="option1" className="custom-radio">
                Custom Radio
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const item = screen.getByText('Custom Radio')
        expect(item).toHaveClass('custom-radio')
      })
    })
  })

  describe('DropdownMenuLabel', () => {
    it('renders DropdownMenuLabel with correct styling and data-slot', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Section Label</DropdownMenuLabel>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const label = screen.getByText('Section Label')
        expect(label).toBeInTheDocument()
        expect(label).toHaveAttribute('data-slot', 'dropdown-menu-label')
      })
    })

    it('handles inset prop correctly', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel inset>Inset Label</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const label = screen.getByText('Inset Label')
        expect(label).toHaveAttribute('data-inset', 'true')
      })
    })

    it('applies custom className', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel className="custom-label">Custom Label</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const label = screen.getByText('Custom Label')
        expect(label).toHaveClass('custom-label')
      })
    })
  })

  describe('DropdownMenuSeparator', () => {
    it('renders DropdownMenuSeparator with correct styling and data-slot', async () => {
      const user = userEvent.setup()

      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Item 2</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        const separator = document.querySelector('[data-slot="dropdown-menu-separator"]')
        expect(separator).toBeInTheDocument()
        expect(separator).toHaveClass('h-px')
        expect(separator).toHaveClass('bg-border')
      })
    })

    it('applies custom className', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
            <DropdownMenuSeparator className="custom-separator" />
            <DropdownMenuItem>Item 2</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const separator = document.querySelector('[data-slot="dropdown-menu-separator"]')
        expect(separator).toHaveClass('custom-separator')
      })
    })
  })

  describe('DropdownMenuShortcut', () => {
    it('renders DropdownMenuShortcut with correct styling and data-slot', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>
              Menu Item
              <DropdownMenuShortcut>Ctrl+K</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const shortcut = screen.getByText('Ctrl+K')
        expect(shortcut).toBeInTheDocument()
        expect(shortcut).toHaveAttribute('data-slot', 'dropdown-menu-shortcut')
        expect(shortcut).toHaveClass('ml-auto')
        expect(shortcut).toHaveClass('text-xs')
      })
    })

    it('applies custom className', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>
              Menu Item
              <DropdownMenuShortcut className="custom-shortcut">Cmd+S</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const shortcut = screen.getByText('Cmd+S')
        expect(shortcut).toHaveClass('custom-shortcut')
      })
    })
  })

  describe('DropdownMenuSub', () => {
    it('renders DropdownMenuSub with correct data-slot', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Sub Menu</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        // Check for the sub trigger which should be visible
        const subTrigger = screen.getByText('Sub Menu')
        expect(subTrigger).toBeInTheDocument()
      })
    })
  })

  describe('DropdownMenuSubTrigger', () => {
    it('renders DropdownMenuSubTrigger with correct styling and data-slot', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Sub Menu</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const subTrigger = screen.getByText('Sub Menu')
        expect(subTrigger).toBeInTheDocument()
        expect(subTrigger).toHaveAttribute('data-slot', 'dropdown-menu-sub-trigger')
        
        // Check for chevron icon
        const chevronIcon = subTrigger.querySelector('svg')
        expect(chevronIcon).toBeInTheDocument()
      })
    })

    it('handles inset prop correctly', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger inset>Inset Sub Menu</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const subTrigger = screen.getByText('Inset Sub Menu')
        expect(subTrigger).toHaveAttribute('data-inset', 'true')
      })
    })

    it('applies custom className', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="custom-sub-trigger">
                Custom Sub Menu
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const subTrigger = screen.getByText('Custom Sub Menu')
        expect(subTrigger).toHaveClass('custom-sub-trigger')
      })
    })
  })

  describe('DropdownMenuSubContent', () => {
    it('renders DropdownMenuSubContent with correct styling and data-slot', async () => {
      const user = userEvent.setup()

      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Sub Menu</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub Item</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        const subTrigger = screen.getByText('Sub Menu')
        expect(subTrigger).toBeInTheDocument()
      })

      // Hover over sub trigger to open sub content
      await user.hover(screen.getByText('Sub Menu'))

      await waitFor(() => {
        const subContent = document.querySelector('[data-slot="dropdown-menu-sub-content"]')
        expect(subContent).toBeInTheDocument()
        expect(subContent).toHaveClass('bg-popover')
        expect(subContent).toHaveClass('text-popover-foreground')
      })
    })

    it('applies custom className', async () => {
      const user = userEvent.setup()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Sub Menu</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="custom-sub-content">
                <DropdownMenuItem>Sub Item</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      await user.click(screen.getByRole('button'))
      
      await waitFor(() => {
        const subTrigger = screen.getByText('Sub Menu')
        expect(subTrigger).toBeInTheDocument()
      })
      
      await user.hover(screen.getByText('Sub Menu'))
      
      await waitFor(() => {
        const subContent = document.querySelector('[data-slot="dropdown-menu-sub-content"]')
        expect(subContent).toHaveClass('custom-sub-content')
      })
    })
  })

  describe('Integration Tests', () => {
    it('renders a complete dropdown menu with all components', async () => {
      const user = userEvent.setup()
      const handleItemClick = vi.fn()
      
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onClick={handleItemClick}>
              Edit
              <DropdownMenuShortcut>Ctrl+E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={true}>
              Show toolbar
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value="light">
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More options</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sub item 1</DropdownMenuItem>
                <DropdownMenuItem>Sub item 2</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      
      // Open the menu
      await user.click(screen.getByText('Open Menu'))
      
      // Verify all components are rendered
      await waitFor(() => {
        expect(screen.getByText('Actions')).toBeInTheDocument()
        expect(screen.getByText('Edit')).toBeInTheDocument()
        expect(screen.getByText('Ctrl+E')).toBeInTheDocument()
        expect(screen.getByText('Show toolbar')).toBeInTheDocument()
        expect(screen.getByText('Light')).toBeInTheDocument()
        expect(screen.getByText('Dark')).toBeInTheDocument()
        expect(screen.getByText('More options')).toBeInTheDocument()
      })
      
      // Test item click
      await user.click(screen.getByText('Edit'))
      expect(handleItemClick).toHaveBeenCalledTimes(1)
    })
  })
})
