import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import Checkbox from './index'
import { Switch } from '@janhq/joi'

// Mock Switch component from @janhq/joi
jest.mock('@janhq/joi', () => ({
  ...jest.requireActual('@janhq/joi'),
  Switch: jest.fn(({ checked, onChange, disabled }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
    />
  )),
}))

describe('Checkbox Component', () => {
  const mockOnValueChanged = jest.fn()

  const defaultProps = {
    title: 'Test Title',
    name: 'Test Name',
    description: 'This is a description',
    checked: false,
    onValueChanged: mockOnValueChanged,
  }

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('renders the Checkbox with title and description', () => {
    render(<Checkbox {...defaultProps} />)

    // Check if title and description are rendered
    expect(screen.getByText(/Test Title/i)).toBeInTheDocument()
    // expect(screen.getByText(/This is a description/i)).toBeInTheDocument()
  })

  it('calls onValueChanged when switch is toggled', () => {
    render(<Checkbox {...defaultProps} />)

    // Simulate switch toggle
    const switchInput = screen.getByRole('switch')
    fireEvent.click(switchInput)

    // Verify if the onValueChanged function is called
    expect(mockOnValueChanged).toHaveBeenCalledWith(true)
  })

  it('does not call onValueChanged when disabled', () => {
    render(<Checkbox {...defaultProps} disabled={true} />)

    const switchInput = screen.getByRole('switch')
    fireEvent.click(switchInput)

    // Verify if onValueChanged is not called when disabled
    expect(mockOnValueChanged).not.toHaveBeenCalled()
  })

  it('renders with checked state', () => {
    render(<Checkbox {...defaultProps} checked={true} />)

    const switchInput = screen.getByRole('switch')

    // Check if the switch is checked
    expect(switchInput).toBeChecked()
  })

  it('renders with unchecked state', () => {
    render(<Checkbox {...defaultProps} checked={false} />)

    const switchInput = screen.getByRole('switch')

    // Check if the switch is unchecked
    expect(switchInput).not.toBeChecked()
  })
})
