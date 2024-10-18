import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import LogoMark from './Mark'

describe('LogoMark Component', () => {
  it('renders with default width and height', () => {
    render(<LogoMark />)
    const image = screen.getByAltText('Jan - Logo')
    expect(image).toBeInTheDocument()
    expect(image).toHaveAttribute('width', '24')
    expect(image).toHaveAttribute('height', '24')
  })

  it('renders with provided width and height', () => {
    render(<LogoMark width={48} height={48} />)
    const image = screen.getByAltText('Jan - Logo')
    expect(image).toBeInTheDocument()
    expect(image).toHaveAttribute('width', '48')
    expect(image).toHaveAttribute('height', '48')
  })

  it('applies provided className', () => {
    render(<LogoMark className="custom-class" />)
    const image = screen.getByAltText('Jan - Logo')
    expect(image).toBeInTheDocument()
    expect(image).toHaveClass('custom-class')
  })

  it('renders with the correct src and alt attributes', () => {
    render(<LogoMark />)
    const image = screen.getByAltText('Jan - Logo')
    expect(image).toBeInTheDocument()
    expect(image).toHaveAttribute('src', 'icons/app_icon.svg')
    expect(image).toHaveAttribute('alt', 'Jan - Logo')
  })
})
