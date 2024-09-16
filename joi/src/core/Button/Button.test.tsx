import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Button, buttonConfig } from './index'

// Mock the styles
jest.mock('./styles.scss', () => ({}))

describe('@joi/core/Button', () => {
  it('renders with default props', () => {
    render(<Button>Click me</Button>)
    const button = screen.getByRole('button', { name: /click me/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass('btn btn--primary btn--medium btn--solid')
  })

  it('applies custom className', () => {
    render(<Button className="custom-class">Test Button</Button>)
    const badge = screen.getByText('Test Button')
    expect(badge).toHaveClass('custom-class')
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

  it('fails when a new theme is added without updating the test', () => {
    const expectedThemes = ['primary', 'ghost', 'icon', 'destructive']
    const actualThemes = Object.keys(buttonConfig.variants.theme)
    expect(actualThemes).toEqual(expectedThemes)
  })

  it('fails when a new variant is added without updating the test', () => {
    const expectedVariant = ['solid', 'soft', 'outline']
    const actualVariants = Object.keys(buttonConfig.variants.variant)
    expect(actualVariants).toEqual(expectedVariant)
  })

  it('fails when a new size is added without updating the test', () => {
    const expectedSizes = ['small', 'medium', 'large']
    const actualSizes = Object.keys(buttonConfig.variants.size)
    expect(actualSizes).toEqual(expectedSizes)
  })

  it('fails when a new variant CVA is added without updating the test', () => {
    const expectedVariantsCVA = ['theme', 'variant', 'size', 'block']
    const actualVariant = Object.keys(buttonConfig.variants)
    expect(actualVariant).toEqual(expectedVariantsCVA)
  })
})
