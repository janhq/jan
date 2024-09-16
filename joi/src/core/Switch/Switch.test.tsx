import React from 'react'
import { render, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Switch } from './index'

// Mock the styles
jest.mock('./styles.scss', () => ({}))

describe('@joi/core/Switch', () => {
  it('renders correctly', () => {
    const { getByRole } = render(<Switch />)
    const checkbox = getByRole('checkbox')
    expect(checkbox).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<Switch className="custom-class" />)
    expect(container.firstChild).toHaveClass('switch custom-class')
  })

  it('can be checked and unchecked', () => {
    const { getByRole } = render(<Switch />)
    const checkbox = getByRole('checkbox') as HTMLInputElement

    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(false)
  })

  it('can be disabled', () => {
    const { getByRole } = render(<Switch disabled />)
    const checkbox = getByRole('checkbox') as HTMLInputElement
    expect(checkbox).toBeDisabled()
  })

  it('calls onChange when clicked', () => {
    const handleChange = jest.fn()
    const { getByRole } = render(<Switch onChange={handleChange} />)
    const checkbox = getByRole('checkbox')

    fireEvent.click(checkbox)
    expect(handleChange).toHaveBeenCalledTimes(1)
  })

  it('can have a default checked state', () => {
    const { getByRole } = render(<Switch defaultChecked />)
    const checkbox = getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })
})
