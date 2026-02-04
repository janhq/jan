<<<<<<< HEAD
import React from 'react'
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { Button } from '../button'

describe('Button', () => {
  it('renders button with children', () => {
    render(<Button>Click me</Button>)

    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('applies default variant classes', () => {
    render(<Button>Default Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass(
      'bg-primary',
<<<<<<< HEAD
      'text-primary-fg',
=======
      'text-primary-foreground',
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      'hover:bg-primary/90'
    )
  })

  it('applies destructive variant classes', () => {
    render(<Button variant="destructive">Destructive Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass(
      'bg-destructive',
<<<<<<< HEAD
      'text-destructive-fg',
=======
      'text-white',
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      'hover:bg-destructive/90'
    )
  })

  it('applies link variant classes', () => {
    render(<Button variant="link">Link Button</Button>)

    const button = screen.getByRole('button')
<<<<<<< HEAD
    expect(button).toHaveClass('underline-offset-4', 'hover:no-underline')
=======
    expect(button).toHaveClass('underline-offset-4', 'hover:underline')
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  })

  it('applies default size classes', () => {
    render(<Button>Default Size</Button>)

    const button = screen.getByRole('button')
<<<<<<< HEAD
    expect(button).toHaveClass('h-7', 'px-3', 'py-2')
=======
    expect(button).toHaveClass('h-9', 'px-4', 'py-2')
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  })

  it('applies small size classes', () => {
    render(<Button size="sm">Small Button</Button>)

    const button = screen.getByRole('button')
<<<<<<< HEAD
    expect(button).toHaveClass('h-6', 'px-2')
=======
    expect(button).toHaveClass('h-8', 'px-3')
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  })

  it('applies large size classes', () => {
    render(<Button size="lg">Large Button</Button>)

    const button = screen.getByRole('button')
<<<<<<< HEAD
    expect(button).toHaveClass('h-9', 'rounded-md', 'px-4')
=======
    expect(button).toHaveClass('h-10', 'px-6')
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  })

  it('applies icon size classes', () => {
    render(<Button size="icon">Icon</Button>)

    const button = screen.getByRole('button')
<<<<<<< HEAD
    expect(button).toHaveClass('size-8')
=======
    expect(button).toHaveClass('size-9')
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  })

  it('handles click events', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()

    render(<Button onClick={handleClick}>Click me</Button>)

    await user.click(screen.getByRole('button'))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('can be disabled', () => {
    render(<Button disabled>Disabled Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveClass(
      'disabled:pointer-events-none',
      'disabled:opacity-50'
    )
  })

  it('does not trigger click when disabled', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()

    render(
      <Button disabled onClick={handleClick}>
        Disabled Button
      </Button>
    )

    await user.click(screen.getByRole('button'))

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('forwards ref correctly', () => {
    const ref = vi.fn()

    render(<Button ref={ref}>Button with ref</Button>)

    expect(ref).toHaveBeenCalledWith(expect.any(HTMLButtonElement))
  })

  it('accepts custom className', () => {
    render(<Button className="custom-class">Custom Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('custom-class')
  })

  it('accepts custom props', () => {
    render(
      <Button data-testid="custom-button" type="submit">
        Custom Button
      </Button>
    )

    const button = screen.getByTestId('custom-button')
    expect(button).toHaveAttribute('type', 'submit')
  })

  it('renders as different element when asChild is true', () => {
    render(
      <Button asChild>
        <a href="/test">Link Button</a>
      </Button>
    )

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/test')
<<<<<<< HEAD
    expect(link).toHaveClass('bg-primary', 'text-primary-fg') // Should inherit button classes
=======
    expect(link).toHaveClass('bg-primary', 'text-primary-foreground') // Should inherit button classes
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  })

  it('combines variant and size classes correctly', () => {
    render(
      <Button variant="destructive" size="lg">
        Large Destructive Button
      </Button>
    )

    const button = screen.getByRole('button')
<<<<<<< HEAD
    expect(button).toHaveClass('bg-destructive', 'text-destructive-fg') // destructive variant
    expect(button).toHaveClass('h-9', 'rounded-md', 'px-4') // large size
=======
    expect(button).toHaveClass('bg-destructive', 'text-white') // destructive variant
    expect(button).toHaveClass('h-10', 'px-6') // large size
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  })

  it('handles keyboard events', () => {
    const handleKeyDown = vi.fn()

    render(<Button onKeyDown={handleKeyDown}>Keyboard Button</Button>)

    const button = screen.getByRole('button')
    fireEvent.keyDown(button, { key: 'Enter' })

    expect(handleKeyDown).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'Enter',
      })
    )
  })

  it('supports focus events', () => {
    const handleFocus = vi.fn()
    const handleBlur = vi.fn()

    render(
      <Button onFocus={handleFocus} onBlur={handleBlur}>
        Focus Button
      </Button>
    )

    const button = screen.getByRole('button')
    fireEvent.focus(button)
    fireEvent.blur(button)

    expect(handleFocus).toHaveBeenCalledTimes(1)
    expect(handleBlur).toHaveBeenCalledTimes(1)
  })

  it('applies focus-visible styling', () => {
    render(<Button>Focus Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass(
<<<<<<< HEAD
      'focus-visible:border-primary',
      'focus-visible:ring-2',
      'focus-visible:ring-primary/60'
=======
      'focus-visible:border-ring',
      'focus-visible:ring-[3px]',
      'focus-visible:ring-ring/50'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    )
  })
})
