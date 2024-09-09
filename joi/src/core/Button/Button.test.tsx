import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Button, buttonConfig } from './index'

// Mock the styles
jest.mock('./styles.scss', () => ({}))

describe('Button', () => {
  it('renders with default props', () => {
    render(<Button>Click me</Button>)
    const button = screen.getByRole('button', { name: /click me/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass('btn btn--primary btn--medium btn--solid')
  })

  it('renders as a child component when asChild is true', () => {
    render(
      <Button asChild>
        <a href="/">Link Button</a>
      </Button>
    )
    const link = screen.getByRole('link', { name: /link button/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveClass('btn btn--primary btn--medium btn--solid')
  })

  it.each(Object.keys(buttonConfig.variants.theme))(
    'renders with theme %s',
    (theme) => {
      render(<Button theme={theme as any}>Theme Button</Button>)
      const button = screen.getByRole('button', { name: /theme button/i })
      expect(button).toHaveClass(`btn btn--${theme}`)
    }
  )

  it.each(Object.keys(buttonConfig.variants.variant))(
    'renders with variant %s',
    (variant) => {
      render(<Button variant={variant as any}>Variant Button</Button>)
      const button = screen.getByRole('button', { name: /variant button/i })
      expect(button).toHaveClass(`btn btn--${variant}`)
    }
  )

  it.each(Object.keys(buttonConfig.variants.size))(
    'renders with size %s',
    (size) => {
      render(<Button size={size as any}>Size Button</Button>)
      const button = screen.getByRole('button', { name: /size button/i })
      expect(button).toHaveClass(`btn btn--${size}`)
    }
  )

  it('renders with block prop', () => {
    render(<Button block>Block Button</Button>)
    const button = screen.getByRole('button', { name: /block button/i })
    expect(button).toHaveClass('btn btn--block')
  })

  it('merges custom className with generated classes', () => {
    render(<Button className="custom-class">Custom Class Button</Button>)
    const button = screen.getByRole('button', { name: /custom class button/i })
    expect(button).toHaveClass(
      'btn btn--primary btn--medium btn--solid custom-class'
    )
  })
})
