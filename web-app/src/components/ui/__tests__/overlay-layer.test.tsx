import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../dialog'
import { Sheet, SheetContent, SheetTitle } from '../sheet'
import { Drawer, DrawerContent, DrawerTitle } from '../drawer'
import { Popover, PopoverContent, PopoverTrigger } from '../popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip'
import { useFloatingLayer } from '../overlay-layer'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../hover-card'

// Real Radix portals, not mocks: these assert ownership survives the DOM move.
// jsdom does not paint stacking contexts; computed browser layering needs UI QA.
afterEach(cleanup)

function Popup() {
  return (
    <Popover defaultOpen>
      <PopoverTrigger>Anchor</PopoverTrigger>
      <PopoverContent data-testid="popup">Popup</PopoverContent>
    </Popover>
  )
}

describe('shared overlay layer contract', () => {
  it('portals ordinary floating content outside a panel without making it modal', () => {
    render(<aside data-testid="panel" className="z-(--layer-panel)"><Popup /></aside>)
    const popup = screen.getByTestId('popup')
    expect(popup).toHaveClass('z-(--layer-floating)')
    expect(screen.getByTestId('panel')).not.toContainElement(popup)
  })

  it.each(['dialog', 'sheet', 'drawer'] as const)('promotes body-portaled popovers inside %s content', (kind) => {
    const children = <><Popup /></>
    if (kind === 'dialog') render(<Dialog defaultOpen><DialogContent><DialogTitle>Modal</DialogTitle>{children}</DialogContent></Dialog>)
    if (kind === 'sheet') render(<Sheet defaultOpen><SheetContent><SheetTitle>Modal</SheetTitle>{children}</SheetContent></Sheet>)
    if (kind === 'drawer') render(<Drawer defaultOpen><DrawerContent><DrawerTitle>Modal</DrawerTitle>{children}</DrawerContent></Drawer>)
    const popup = screen.getByTestId('popup')
    expect(popup).toHaveClass('z-(--layer-modal-floating)')
    const content = document.querySelector(`[data-slot="${kind}-content"]`)
    expect(content).toHaveClass('z-(--layer-modal)')
    expect(content).not.toContainElement(popup)
  })

  it('promotes tooltip and hover card portals in a modal, not unrelated floating roots', () => {
    function SiblingLayer() {
      return <span data-testid="sibling-layer" className={useFloatingLayer()} />
    }
    render(<>
      <SiblingLayer />
      <Dialog defaultOpen><DialogContent><DialogTitle>Modal</DialogTitle>
        <Tooltip defaultOpen><TooltipTrigger>Tip anchor</TooltipTrigger><TooltipContent data-testid="tip">Tip</TooltipContent></Tooltip>
        <HoverCard defaultOpen><HoverCardTrigger>Card anchor</HoverCardTrigger><HoverCardContent data-testid="card">Card</HoverCardContent></HoverCard>
      </DialogContent></Dialog>
    </>)
    expect(screen.getByTestId('sibling-layer')).toHaveClass('z-(--layer-floating)')
    expect(screen.getByTestId('tip')).toHaveClass('z-(--layer-modal-floating)')
    expect(screen.getByTestId('card')).toHaveClass('z-(--layer-modal-floating)')
  })

  it('keeps dialog-owned menu above modal and Escape dismisses menu before dialog', async () => {
    render(<Dialog defaultOpen><DialogContent><DialogTitle>Modal</DialogTitle>
      <DropdownMenu defaultOpen><DropdownMenuTrigger>Menu anchor</DropdownMenuTrigger>
        <DropdownMenuContent data-testid="menu"><DropdownMenuItem>Action</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    </DialogContent></Dialog>)
    expect(screen.getByTestId('menu')).toHaveClass('z-(--layer-modal-floating)')
    fireEvent.keyDown(screen.getByTestId('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('menu')).not.toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('dismisses nested dialog before parent, retaining portal order at the modal tier', async () => {
    render(<Dialog defaultOpen><DialogContent data-testid="parent"><DialogTitle>Parent</DialogTitle>
      <Dialog defaultOpen><DialogTrigger>Open nested</DialogTrigger><DialogContent data-testid="nested"><DialogTitle>Nested</DialogTitle><Popup /></DialogContent></Dialog>
    </DialogContent></Dialog>)
    const parent = screen.getByTestId('parent')
    const nested = screen.getByTestId('nested')
    expect(parent).toHaveClass('z-(--layer-modal)')
    expect(nested).toHaveClass('z-(--layer-modal)')
    expect(parent.compareDocumentPosition(nested) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('popup')).toHaveClass('z-(--layer-modal-floating)')
    fireEvent.keyDown(screen.getByTestId('popup'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('popup')).not.toBeInTheDocument())
    fireEvent.keyDown(nested, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('nested')).not.toBeInTheDocument())
    expect(parent).toBeInTheDocument()
  })
})
