import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Progress } from './index'

// Mock the styles
jest.mock('./styles.scss', () => ({}))

describe('@joi/core/Progress', () => {
  it('renders with default props', () => {
    render(<Progress value={50} />)
    const progressElement = screen.getByRole('progressbar')
    expect(progressElement).toBeInTheDocument()
    expect(progressElement).toHaveClass('progress')
    expect(progressElement).toHaveClass('progress--medium')
    expect(progressElement).toHaveAttribute('aria-valuenow', '50')
  })

  it('applies custom className', () => {
    render(<Progress value={50} className="custom-class" />)
    const progressElement = screen.getByRole('progressbar')
    expect(progressElement).toHaveClass('custom-class')
  })

  it('renders with different sizes', () => {
    const { rerender } = render(<Progress value={50} size="small" />)
    let progressElement = screen.getByRole('progressbar')
    expect(progressElement).toHaveClass('progress--small')

    rerender(<Progress value={50} size="large" />)
    progressElement = screen.getByRole('progressbar')
    expect(progressElement).toHaveClass('progress--large')
  })

  it('sets the correct transform style based on value', () => {
    render(<Progress value={75} />)
    const progressElement = screen.getByRole('progressbar')
    const indicatorElement = progressElement.firstChild as HTMLElement
    expect(indicatorElement).toHaveStyle('transform: translateX(-25%)')
  })

  it('handles edge cases for value', () => {
    const { rerender } = render(<Progress value={0} />)
    let progressElement = screen.getByRole('progressbar')
    let indicatorElement = progressElement.firstChild as HTMLElement
    expect(indicatorElement).toHaveStyle('transform: translateX(-100%)')
    expect(progressElement).toHaveAttribute('aria-valuenow', '0')

    rerender(<Progress value={100} />)
    progressElement = screen.getByRole('progressbar')
    indicatorElement = progressElement.firstChild as HTMLElement
    expect(indicatorElement).toHaveStyle('transform: translateX(-0%)')
    expect(progressElement).toHaveAttribute('aria-valuenow', '100')
  })
})
