import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Checkbox } from './index'

// Mock the styles
jest.mock('./styles.scss', () => ({}))

describe('@joi/core/Checkbox', () => {
  it('renders correctly with label', () => {
    render(<Checkbox id="test-checkbox" label="Test Checkbox" />)
    expect(screen.getByLabelText('Test Checkbox')).toBeInTheDocument()
  })

  it('renders with helper description', () => {
    render(<Checkbox id="test-checkbox" helperDescription="Helper text" />)
    expect(screen.getByText('Helper text')).toBeInTheDocument()
  })

  it('renders error message when provided', () => {
    render(<Checkbox id="test-checkbox" errorMessage="Error occurred" />)
    expect(screen.getByText('Error occurred')).toBeInTheDocument()
  })

  it('calls onChange when clicked', () => {
    const mockOnChange = jest.fn()
    render(
      <Checkbox
        id="test-checkbox"
        label="Test Checkbox"
        onChange={mockOnChange}
      />
    )

    fireEvent.click(screen.getByLabelText('Test Checkbox'))
    expect(mockOnChange).toHaveBeenCalledTimes(1)
  })

  it('applies custom className', () => {
    render(<Checkbox id="test-checkbox" className="custom-class" />)
    expect(screen.getByRole('checkbox').parentElement).toHaveClass(
      'custom-class'
    )
  })

  it('disables the checkbox when disabled prop is true', () => {
    render(<Checkbox id="test-checkbox" label="Disabled Checkbox" disabled />)
    expect(screen.getByLabelText('Disabled Checkbox')).toBeDisabled()
  })
})
