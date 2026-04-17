import { render, screen, waitFor } from '@testing-library/react'
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

// Helper: render a dropdown and open it
async function renderAndOpen(content: React.ReactNode, triggerText = 'Open') {
  const user = userEvent.setup()
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>{triggerText}</DropdownMenuTrigger>
      <DropdownMenuContent>{content}</DropdownMenuContent>
    </DropdownMenu>
  )
  await user.click(screen.getByRole('button'))
  return user
}

describe('DropdownMenu Components', () => {
  describe('DropdownMenu basics', () => {
    it('renders trigger and supports modal={false}', () => {
      render(
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
    })
  })

  describe('DropdownMenuPortal', () => {
    it('renders with portal wrapper', () => {
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
      expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
    })
  })

  describe('DropdownMenuTrigger', () => {
    it('has correct data-slot and opens menu on click', async () => {
      const user = await renderAndOpen(<DropdownMenuItem>Menu Item</DropdownMenuItem>, 'Open Menu')

      const trigger = screen.getByText('Open Menu')
      expect(trigger).toHaveAttribute('data-slot', 'dropdown-menu-trigger')
      await waitFor(() => {
        expect(screen.getByText('Menu Item')).toBeInTheDocument()
      })
    })
  })

  describe('DropdownMenuContent', () => {
    it('renders with correct styling, custom className, and sideOffset', async () => {
      const user = userEvent.setup()
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent className="custom-class" sideOffset={10}>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
      await user.click(screen.getByRole('button'))
      await waitFor(() => {
        const content = document.querySelector('[data-slot="dropdown-menu-content"]')
        expect(content).toBeInTheDocument()
        expect(content).toHaveClass('bg-popover', 'text-popover-foreground', 'custom-class')
      })
    })
  })

  describe('DropdownMenuGroup', () => {
    it('renders with correct data-slot', async () => {
      await renderAndOpen(
        <DropdownMenuGroup>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuGroup>
      )
      await waitFor(() => {
        expect(document.querySelector('[data-slot="dropdown-menu-group"]')).toBeInTheDocument()
      })
    })
  })

  describe('DropdownMenuItem', () => {
    it('renders with data-slot, supports inset/className, and handles click', async () => {
      const handleClick = vi.fn()
      const user = await renderAndOpen(
        <>
          <DropdownMenuItem onClick={handleClick} className="custom-item">Menu Item</DropdownMenuItem>
          <DropdownMenuItem inset>Inset Item</DropdownMenuItem>
        </>
      )

      await waitFor(() => {
        const item = screen.getByText('Menu Item')
        expect(item).toHaveAttribute('data-slot', 'dropdown-menu-item')
        expect(item).toHaveClass('custom-item')
        const insetItem = screen.getByText('Inset Item')
        expect(insetItem).toHaveAttribute('data-inset', 'true')
      })

      await user.click(screen.getByText('Menu Item'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('DropdownMenuCheckboxItem', () => {
    it('renders with data-slot, check icon when checked, and custom className', async () => {
      await renderAndOpen(
        <>
          <DropdownMenuCheckboxItem checked={true}>Checked Item</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem className="custom-checkbox" checked={false}>Custom Checkbox</DropdownMenuCheckboxItem>
        </>
      )

      await waitFor(() => {
        const item = screen.getByText('Checked Item')
        expect(item).toHaveAttribute('data-slot', 'dropdown-menu-checkbox-item')
        expect(item).toHaveAttribute('data-state', 'checked')
        expect(item.parentElement?.querySelector('svg')).toBeInTheDocument()
        expect(screen.getByText('Custom Checkbox')).toHaveClass('custom-checkbox')
      })
    })
  })

  describe('DropdownMenuRadioGroup and DropdownMenuRadioItem', () => {
    it('renders radio group/items with data-slot, circle icon, and custom className', async () => {
      await renderAndOpen(
        <DropdownMenuRadioGroup value="option1">
          <DropdownMenuRadioItem value="option1">Option 1</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="option2" className="custom-radio">Custom Radio</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      )

      await waitFor(() => {
        expect(document.querySelector('[data-slot="dropdown-menu-radio-group"]')).toBeInTheDocument()
        const item = screen.getByText('Option 1')
        expect(item).toHaveAttribute('data-slot', 'dropdown-menu-radio-item')
        expect(item).toHaveAttribute('data-state', 'checked')
        expect(item.parentElement?.querySelector('svg')).toBeInTheDocument()
        expect(screen.getByText('Custom Radio')).toHaveClass('custom-radio')
      })
    })
  })

  describe('DropdownMenuLabel', () => {
    it('renders with data-slot, supports inset and custom className', async () => {
      await renderAndOpen(
        <>
          <DropdownMenuLabel className="custom-label">Custom Label</DropdownMenuLabel>
          <DropdownMenuLabel inset>Inset Label</DropdownMenuLabel>
        </>
      )

      await waitFor(() => {
        const label = screen.getByText('Custom Label')
        expect(label).toHaveAttribute('data-slot', 'dropdown-menu-label')
        expect(label).toHaveClass('custom-label')
        expect(screen.getByText('Inset Label')).toHaveAttribute('data-inset', 'true')
      })
    })
  })

  describe('DropdownMenuSeparator', () => {
    it('renders with data-slot, styling, and custom className', async () => {
      await renderAndOpen(
        <>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
          <DropdownMenuSeparator className="custom-separator" />
          <DropdownMenuItem>Item 2</DropdownMenuItem>
        </>
      )

      await waitFor(() => {
        const separator = document.querySelector('[data-slot="dropdown-menu-separator"]')
        expect(separator).toBeInTheDocument()
        expect(separator).toHaveClass('h-px', 'bg-border', 'custom-separator')
      })
    })
  })

  describe('DropdownMenuShortcut', () => {
    it('renders with data-slot, styling, and custom className', async () => {
      await renderAndOpen(
        <DropdownMenuItem>
          Menu Item
          <DropdownMenuShortcut className="custom-shortcut">Ctrl+K</DropdownMenuShortcut>
        </DropdownMenuItem>
      )

      await waitFor(() => {
        const shortcut = screen.getByText('Ctrl+K')
        expect(shortcut).toHaveAttribute('data-slot', 'dropdown-menu-shortcut')
        expect(shortcut).toHaveClass('ml-auto', 'text-xs', 'custom-shortcut')
      })
    })
  })

  describe('DropdownMenuSub', () => {
    const renderSubMenu = (props: { inset?: boolean; className?: string } = {}) =>
      renderAndOpen(
        <DropdownMenuSub>
          <DropdownMenuSubTrigger {...props}>Sub Menu</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="custom-sub-content">
            <DropdownMenuItem>Sub Item</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )

    it('renders sub trigger with data-slot, chevron, inset, and className', async () => {
      await renderSubMenu({ inset: false, className: 'custom-sub-trigger' })

      await waitFor(() => {
        const subTrigger = screen.getByText('Sub Menu')
        expect(subTrigger).toHaveAttribute('data-slot', 'dropdown-menu-sub-trigger')
        expect(subTrigger.querySelector('svg')).toBeInTheDocument()
        expect(subTrigger).toHaveClass('custom-sub-trigger')
      })
    })

    it('supports inset on sub trigger', async () => {
      await renderSubMenu({ inset: true })

      await waitFor(() => {
        expect(screen.getByText('Sub Menu')).toHaveAttribute('data-inset', 'true')
      })
    })

    it('renders sub content with styling on hover', async () => {
      const user = await renderSubMenu()

      await waitFor(() => {
        expect(screen.getByText('Sub Menu')).toBeInTheDocument()
      })
      await user.hover(screen.getByText('Sub Menu'))
      await waitFor(() => {
        const subContent = document.querySelector('[data-slot="dropdown-menu-sub-content"]')
        expect(subContent).toBeInTheDocument()
        expect(subContent).toHaveClass('bg-popover', 'text-popover-foreground', 'custom-sub-content')
      })
    })
  })

  describe('Integration Tests', () => {
    it('renders a complete dropdown menu with all components', async () => {
      const handleItemClick = vi.fn()
      const user = userEvent.setup()

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
            <DropdownMenuCheckboxItem checked={true}>Show toolbar</DropdownMenuCheckboxItem>
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
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      )

      await user.click(screen.getByText('Open Menu'))

      await waitFor(() => {
        expect(screen.getByText('Actions')).toBeInTheDocument()
        expect(screen.getByText('Edit')).toBeInTheDocument()
        expect(screen.getByText('Ctrl+E')).toBeInTheDocument()
        expect(screen.getByText('Show toolbar')).toBeInTheDocument()
        expect(screen.getByText('Light')).toBeInTheDocument()
        expect(screen.getByText('Dark')).toBeInTheDocument()
        expect(screen.getByText('More options')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Edit'))
      expect(handleItemClick).toHaveBeenCalledTimes(1)
    })
  })
})
