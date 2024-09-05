import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Badge, badgeConfig } from './index'

// Mock the styles
jest.mock('./styles.scss', () => ({}))

describe('@joi/core/Badge', () => {
  it('renders with default props', () => {
    render(<Badge>Test Badge</Badge>)
    const badge = screen.getByText('Test Badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('badge')
    expect(badge).toHaveClass('badge--primary')
    expect(badge).toHaveClass('badge--medium')
    expect(badge).toHaveClass('badge--solid')
  })

  it('applies custom className', () => {
    render(<Badge className="custom-class">Test Badge</Badge>)
    const badge = screen.getByText('Test Badge')
    expect(badge).toHaveClass('custom-class')
  })

  it('renders with different themes', () => {
    const themes = Object.keys(badgeConfig.variants.theme)
    themes.forEach((theme) => {
      render(<Badge theme={theme as any}>Test Badge {theme}</Badge>)
      const badge = screen.getByText(`Test Badge ${theme}`)
      expect(badge).toHaveClass(`badge--${theme}`)
    })
  })

  it('renders with different variants', () => {
    const variants = Object.keys(badgeConfig.variants.variant)
    variants.forEach((variant) => {
      render(<Badge variant={variant as any}>Test Badge {variant}</Badge>)
      const badge = screen.getByText(`Test Badge ${variant}`)
      expect(badge).toHaveClass(`badge--${variant}`)
    })
  })

  it('renders with different sizes', () => {
    const sizes = Object.keys(badgeConfig.variants.size)
    sizes.forEach((size) => {
      render(<Badge size={size as any}>Test Badge {size}</Badge>)
      const badge = screen.getByText(`Test Badge ${size}`)
      expect(badge).toHaveClass(`badge--${size}`)
    })
  })

  it('fails when a new theme is added without updating the test', () => {
    const expectedThemes = [
      'primary',
      'secondary',
      'warning',
      'success',
      'info',
      'destructive',
    ]
    const actualThemes = Object.keys(badgeConfig.variants.theme)
    expect(actualThemes).toEqual(expectedThemes)
  })

  it('fails when a new variant is added without updating the test', () => {
    const expectedVariant = ['solid', 'soft', 'outline']
    const actualVariants = Object.keys(badgeConfig.variants.variant)
    expect(actualVariants).toEqual(expectedVariant)
  })

  it('fails when a new size is added without updating the test', () => {
    const expectedSizes = ['small', 'medium', 'large']
    const actualSizes = Object.keys(badgeConfig.variants.size)
    expect(actualSizes).toEqual(expectedSizes)
  })

  it('fails when a new variant CVA is added without updating the test', () => {
    const expectedVariantsCVA = ['theme', 'variant', 'size']
    const actualVariant = Object.keys(badgeConfig.variants)
    expect(actualVariant).toEqual(expectedVariantsCVA)
  })
})
