import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Input } from './index'

// Mock the styles import
jest.mock('./styles.scss', () => ({}))

describe('@joi/core/Input', () => {
  it('renders correctly', () => {
    render(<Input placeholder="Test input" />)
    expect(screen.getByPlaceholderText('Test input')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(<Input className="custom-class" />)
    expect(screen.getByRole('textbox')).toHaveClass('custom-class')
  })

  it('aligns text to the right when textAlign prop is set', () => {
    render(<Input textAlign="right" />)
    expect(screen.getByRole('textbox')).toHaveClass('text-right')
  })

  it('renders prefix icon when provided', () => {
    render(<Input prefixIcon={<span data-testid="prefix-icon">Prefix</span>} />)
    expect(screen.getByTestId('prefix-icon')).toBeInTheDocument()
  })

  it('renders suffix icon when provided', () => {
    render(<Input suffixIcon={<span data-testid="suffix-icon">Suffix</span>} />)
    expect(screen.getByTestId('suffix-icon')).toBeInTheDocument()
  })

  it('renders clear icon when clearable is true', () => {
    render(<Input clearable />)
    expect(screen.getByTestId('cross-2-icon')).toBeInTheDocument()
  })

  it('calls onClick when input is clicked', () => {
    const onClick = jest.fn()
    render(<Input onClick={onClick} />)
    fireEvent.click(screen.getByRole('textbox'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('calls onClear when clear icon is clicked', () => {
    const onClear = jest.fn()
    render(<Input clearable onClear={onClear} />)
    fireEvent.click(screen.getByTestId('cross-2-icon'))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
