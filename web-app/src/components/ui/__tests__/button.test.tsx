import React from 'react'
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
      'text-primary-foreground',
      'hover:bg-primary/90'
    )
  })

  it('applies destructive variant classes', () => {
    render(<Button variant="destructive">Destructive Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass(
      'bg-destructive',
      'text-white',
      'hover:bg-destructive/90'
    )
  })

  it('applies link variant classes', () => {
    render(<Button variant="link">Link Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('underline-offset-4', 'hover:underline')
  })

  it('applies default size classes', () => {
    render(<Button>Default Size</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('h-9', 'px-4', 'py-2')
  })

  it('applies small size classes', () => {
    render(<Button size="sm">Small Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('h-8', 'px-3')
  })

  it('applies large size classes', () => {
    render(<Button size="lg">Large Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('h-10', 'rounded-md', 'px-6')
  })

  it('applies icon size classes', () => {
    render(<Button size="icon">Icon</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('size-9')
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
    expect(link).toHaveClass('bg-primary', 'text-primary-foreground') // Should inherit button classes
  })

  it('combines variant and size classes correctly', () => {
    render(
      <Button variant="destructive" size="lg">
        Large Destructive Button
      </Button>
    )

    const button = screen.getByRole('button')
    expect(button).toHaveClass('bg-destructive', 'text-white') // destructive variant
    expect(button).toHaveClass('h-10', 'rounded-md', 'px-6') // large size
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
      'focus-visible:border-ring',
      'focus-visible:ring-[3px]',
      'focus-visible:ring-ring/50'
    )
  })
})
