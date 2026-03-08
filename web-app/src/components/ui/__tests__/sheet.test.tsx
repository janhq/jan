import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { 
  Sheet, 
  SheetTrigger, 
  SheetClose, 
  SheetContent, 
  SheetHeader, 
  SheetFooter, 
  SheetTitle, 
  SheetDescription 
} from '../sheet'

// Mock the translation hook
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('Sheet Components', () => {
  it('renders Sheet root component', () => {
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent>
          <div>Content</div>
        </SheetContent>
      </Sheet>
    )
    
    // Sheet root might not render until triggered, so check for trigger
    const trigger = document.querySelector('[data-slot="sheet-trigger"]')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent('Open')
  })

  it('renders SheetTrigger', () => {
    render(
      <Sheet>
        <SheetTrigger>Open Sheet</SheetTrigger>
      </Sheet>
    )
    
    const trigger = document.querySelector('[data-slot="sheet-trigger"]')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent('Open Sheet')
  })

  it('renders SheetContent with default side (right)', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>Test Sheet</SheetTitle>
          <SheetDescription>Test description</SheetDescription>
          <div>Sheet Content</div>
        </SheetContent>
      </Sheet>
    )

    const content = document.querySelector('[data-slot="sheet-content"]')
    expect(content).toBeInTheDocument()
    expect(content).toHaveClass('inset-y-0', 'right-0')
  })

  it('renders SheetContent with left side', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="left">
          <SheetTitle>Test Sheet</SheetTitle>
          <SheetDescription>Test description</SheetDescription>
          <div>Sheet Content</div>
        </SheetContent>
      </Sheet>
    )

    const content = document.querySelector('[data-slot="sheet-content"]')
    expect(content).toHaveClass('inset-y-0', 'left-0')
  })

  it('renders SheetContent with top side', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="top">
          <SheetTitle>Test Sheet</SheetTitle>
          <SheetDescription>Test description</SheetDescription>
          <div>Sheet Content</div>
        </SheetContent>
      </Sheet>
    )

    const content = document.querySelector('[data-slot="sheet-content"]')
    expect(content).toHaveClass('inset-x-0', 'top-0')
  })

  it('renders SheetContent with bottom side', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="bottom">
          <SheetTitle>Test Sheet</SheetTitle>
          <SheetDescription>Test description</SheetDescription>
          <div>Sheet Content</div>
        </SheetContent>
      </Sheet>
    )

    const content = document.querySelector('[data-slot="sheet-content"]')
    expect(content).toHaveClass('inset-x-0', 'bottom-0')
  })

  it('renders SheetHeader', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>Test Sheet</SheetTitle>
          <SheetDescription>Test description</SheetDescription>
          <SheetHeader>
            <div>Header Content</div>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    )

    const header = document.querySelector('[data-slot="sheet-header"]')
    expect(header).toBeInTheDocument()
    expect(header).toHaveClass('flex', 'flex-col', 'gap-1.5', 'p-4')
  })

  it('renders SheetFooter', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>Test Sheet</SheetTitle>
          <SheetDescription>Test description</SheetDescription>
          <SheetFooter>
            <div>Footer Content</div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )

    const footer = document.querySelector('[data-slot="sheet-footer"]')
    expect(footer).toBeInTheDocument()
    expect(footer).toHaveClass('mt-auto', 'flex', 'flex-col', 'gap-2', 'p-4')
  })

  it('renders SheetTitle', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>Sheet Title</SheetTitle>
          <SheetDescription>Test description</SheetDescription>
        </SheetContent>
      </Sheet>
    )

    const title = document.querySelector('[data-slot="sheet-title"]')
    expect(title).toBeInTheDocument()
    expect(title).toHaveTextContent('Sheet Title')
    expect(title).toHaveClass('font-semibold')
  })

  it('renders SheetDescription', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>Test Sheet</SheetTitle>
          <SheetDescription>Sheet Description</SheetDescription>
        </SheetContent>
      </Sheet>
    )

    const description = document.querySelector('[data-slot="sheet-description"]')
    expect(description).toBeInTheDocument()
    expect(description).toHaveTextContent('Sheet Description')
    expect(description).toHaveClass('text-muted-foreground', 'text-sm')
  })

  it('renders close button with proper styling', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>Test Sheet</SheetTitle>
          <SheetDescription>Test description</SheetDescription>
          <div>Content</div>
        </SheetContent>
      </Sheet>
    )

    const closeButton = document.querySelector('.absolute.top-4.right-4')
    expect(closeButton).toBeInTheDocument()
    expect(closeButton).toHaveClass('rounded-xs', 'opacity-70', 'transition-opacity')
  })

  it('renders overlay with proper styling', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>Test Sheet</SheetTitle>
          <SheetDescription>Test description</SheetDescription>
          <div>Content</div>
        </SheetContent>
      </Sheet>
    )

    const overlay = document.querySelector('[data-slot="sheet-overlay"]')
    expect(overlay).toBeInTheDocument()
    expect(overlay).toHaveClass('fixed', 'inset-0', 'z-50', 'bg-black/50', 'backdrop-blur')
  })

  it('renders SheetClose component', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>Test Sheet</SheetTitle>
          <SheetDescription>Test description</SheetDescription>
          <SheetClose>Close</SheetClose>
        </SheetContent>
      </Sheet>
    )

    const close = document.querySelector('[data-slot="sheet-close"]')
    expect(close).toBeInTheDocument()
    expect(close).toHaveTextContent('Close')
  })

  it('renders with custom className', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent className="custom-sheet">
          <SheetTitle>Test Sheet</SheetTitle>
          <SheetDescription>Test description</SheetDescription>
          <div>Content</div>
        </SheetContent>
      </Sheet>
    )

    const content = document.querySelector('[data-slot="sheet-content"]')
    expect(content).toHaveClass('custom-sheet')
  })

  it('renders complete sheet structure', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Test Sheet</SheetTitle>
            <SheetDescription>Test Description</SheetDescription>
          </SheetHeader>
          <div>Main Content</div>
          <SheetFooter>
            <SheetClose>Close</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )

    expect(screen.getByText('Test Sheet')).toBeInTheDocument()
    expect(screen.getByText('Test Description')).toBeInTheDocument()
    expect(screen.getByText('Main Content')).toBeInTheDocument()
    // There are two "Close" elements: the SheetClose button and the sr-only span in the X close button
    expect(screen.getAllByText('Close').length).toBeGreaterThan(0)
  })
})
