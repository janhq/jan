import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import React from 'react'
import '@testing-library/jest-dom'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../dialog'

describe('Dialog Components', () => {
  it('renders dialog trigger', () => {
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
      </Dialog>
    )
    
    expect(screen.getByText('Open Dialog')).toBeInTheDocument()
  })

  it('opens dialog when trigger is clicked', async () => {
    const user = userEvent.setup()
    
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
    
    await user.click(screen.getByText('Open Dialog'))
    
    expect(screen.getByText('Dialog Title')).toBeInTheDocument()
  })

  it('renders dialog content with proper structure', async () => {
    const user = userEvent.setup()
    
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
            <DialogDescription>Dialog description</DialogDescription>
          </DialogHeader>
          <div>Dialog body content</div>
          <DialogFooter>
            <button>Footer button</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
    
    await user.click(screen.getByText('Open Dialog'))
    
    expect(screen.getByText('Dialog Title')).toBeInTheDocument()
    expect(screen.getByText('Dialog description')).toBeInTheDocument()
    expect(screen.getByText('Dialog body content')).toBeInTheDocument()
    expect(screen.getByText('Footer button')).toBeInTheDocument()
  })

  it('closes dialog when close button is clicked', async () => {
    const user = userEvent.setup()
    
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
    
    await user.click(screen.getByText('Open Dialog'))
    expect(screen.getByText('Dialog Title')).toBeInTheDocument()
    
    // Click the close button (X)
    const closeButton = screen.getByRole('button', { name: /close/i })
    await user.click(closeButton)
    
    expect(screen.queryByText('Dialog Title')).not.toBeInTheDocument()
  })

  it('closes dialog when escape key is pressed', async () => {
    const user = userEvent.setup()
    
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
    
    await user.click(screen.getByText('Open Dialog'))
    expect(screen.getByText('Dialog Title')).toBeInTheDocument()
    
    await user.keyboard('{Escape}')
    
    expect(screen.queryByText('Dialog Title')).not.toBeInTheDocument()
  })

  it('applies proper classes to dialog content', async () => {
    const user = userEvent.setup()

    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )

    await user.click(screen.getByText('Open Dialog'))

    const dialogContent = screen.getByRole('dialog')
    expect(dialogContent).toHaveClass(
<<<<<<< HEAD
      'bg-main-view',
      'max-h-[calc(100%-80px)]',
      'overflow-auto',
      'border-main-view-fg/10',
      'text-main-view-fg',
      'fixed',
      'top-[50%]',
      'left-[50%]',
      'z-[90]',
=======
      'bg-background',
      'max-h-[85vh]',
      'overflow-y-auto',
      'fixed',
      'top-[50%]',
      'left-[50%]',
      'z-50',
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      'grid',
      'w-full',
      'max-w-[calc(100%-2rem)]',
      'translate-x-[-50%]',
      'translate-y-[-50%]',
      'gap-4',
      'rounded-lg',
      'border',
      'p-6',
      'shadow-lg',
      'duration-200',
      'sm:max-w-lg'
    )
  })

  it('applies proper classes to dialog header', async () => {
    const user = userEvent.setup()

    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )

    await user.click(screen.getByText('Open Dialog'))

    const dialogHeader = screen.getByText('Dialog Title').closest('div')
    expect(dialogHeader).toHaveClass('flex', 'flex-col', 'gap-2', 'text-center', 'sm:text-left')
  })

  it('applies proper classes to dialog title', async () => {
    const user = userEvent.setup()
    
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
    
    await user.click(screen.getByText('Open Dialog'))
    
    const dialogTitle = screen.getByText('Dialog Title')
    expect(dialogTitle).toHaveClass('text-lg', 'leading-none', 'font-medium')
  })

  it('applies proper classes to dialog description', async () => {
    const user = userEvent.setup()
<<<<<<< HEAD
    
=======

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
            <DialogDescription>Dialog description</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
<<<<<<< HEAD
    
    await user.click(screen.getByText('Open Dialog'))
    
    const dialogDescription = screen.getByText('Dialog description')
    expect(dialogDescription).toHaveClass('text-main-view-fg/80', 'text-sm')
=======

    await user.click(screen.getByText('Open Dialog'))

    const dialogDescription = screen.getByText('Dialog description')
    expect(dialogDescription).toHaveClass('text-muted-foreground', 'text-sm')
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  })

  it('applies proper classes to dialog footer', async () => {
    const user = userEvent.setup()
    
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <button>Footer button</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
    
    await user.click(screen.getByText('Open Dialog'))
    
    const dialogFooter = screen.getByText('Footer button').closest('div')
    expect(dialogFooter).toHaveClass('flex', 'flex-col-reverse', 'gap-2', 'sm:flex-row', 'sm:justify-end')
  })

  it('can be controlled externally', () => {
    const TestComponent = () => {
      const [open, setOpen] = React.useState(false)
      
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>Open Dialog</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dialog Title</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )
    }
    
    render(<TestComponent />)
    
    expect(screen.queryByText('Dialog Title')).not.toBeInTheDocument()
  })

  it('prevents background interaction when open', async () => {
    const user = userEvent.setup()
    const backgroundClickHandler = vi.fn()
    
    render(
      <div>
        <button onClick={backgroundClickHandler}>Background Button</button>
        <Dialog>
          <DialogTrigger>Open Dialog</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dialog Title</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
    )
    
    await user.click(screen.getByText('Open Dialog'))
    
    // Check that background button has pointer-events: none due to modal overlay
    const backgroundButton = screen.getByText('Background Button')
    expect(backgroundButton).toHaveStyle('pointer-events: none')
  })

  it('accepts custom className for content', async () => {
    const user = userEvent.setup()
    
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent className="custom-dialog-class">
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
    
    await user.click(screen.getByText('Open Dialog'))
    
    const dialogContent = screen.getByRole('dialog')
    expect(dialogContent).toHaveClass('custom-dialog-class')
  })

  it('supports onOpenChange callback', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <Dialog onOpenChange={onOpenChange}>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )

    await user.click(screen.getByText('Open Dialog'))

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('can hide close button when showCloseButton is false', async () => {
    const user = userEvent.setup()

    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )

    await user.click(screen.getByText('Open Dialog'))

    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
  })

  it('shows close button by default', async () => {
    const user = userEvent.setup()

    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )

    await user.click(screen.getByText('Open Dialog'))

    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('accepts aria-describedby prop', async () => {
    const user = userEvent.setup()

    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent aria-describedby="custom-description">
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
          </DialogHeader>
          <p id="custom-description">Custom description text</p>
        </DialogContent>
      </Dialog>
    )

    await user.click(screen.getByText('Open Dialog'))

    const dialogContent = screen.getByRole('dialog')
    expect(dialogContent).toHaveAttribute('aria-describedby', 'custom-description')
  })

  it('applies data-slot attributes to components', async () => {
    const user = userEvent.setup()

    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
            <DialogDescription>Dialog description</DialogDescription>
          </DialogHeader>
          <div>Dialog body content</div>
          <DialogFooter>
            <button>Footer button</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )

    expect(screen.getByText('Open Dialog')).toHaveAttribute('data-slot', 'dialog-trigger')

    await user.click(screen.getByText('Open Dialog'))

    expect(screen.getByRole('dialog')).toHaveAttribute('data-slot', 'dialog-content')
    expect(screen.getByText('Dialog Title').closest('div')).toHaveAttribute('data-slot', 'dialog-header')
    expect(screen.getByText('Dialog Title')).toHaveAttribute('data-slot', 'dialog-title')
    expect(screen.getByText('Dialog description')).toHaveAttribute('data-slot', 'dialog-description')
    expect(screen.getByText('Footer button').closest('div')).toHaveAttribute('data-slot', 'dialog-footer')
  })
})
