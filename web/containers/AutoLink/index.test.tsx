import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import AutoLink from './index'

describe('AutoLink Component', () => {
  it('renders text without links correctly', () => {
    const text = 'This is a test without links.'
    render(<AutoLink text={text} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('renders text with a single link correctly', () => {
    const text = 'Check this link: https://example.com'
    render(<AutoLink text={text} />)
    const link = screen.getByText('https://example.com')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', 'blank')
  })

  it('renders text with multiple links correctly', () => {
    const text = 'Visit https://example.com and http://test.com'
    render(<AutoLink text={text} />)
    const link1 = screen.getByText('https://example.com')
    const link2 = screen.getByText('http://test.com')
    expect(link1).toBeInTheDocument()
    expect(link1).toHaveAttribute('href', 'https://example.com')
    expect(link1).toHaveAttribute('target', 'blank')
    expect(link2).toBeInTheDocument()
    expect(link2).toHaveAttribute('href', 'http://test.com')
    expect(link2).toHaveAttribute('target', 'blank')
  })

  it('renders text with a link without protocol correctly', () => {
    const text = 'Visit example.com for more info.'
    render(<AutoLink text={text} />)
    const link = screen.getByText('example.com')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'http://example.com')
    expect(link).toHaveAttribute('target', 'blank')
  })
})
