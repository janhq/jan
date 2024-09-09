import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from './index'
import '@testing-library/jest-dom'

// Mock the styles
jest.mock('./styles.scss', () => ({}))

jest.mock('tailwind-merge', () => ({
  twMerge: (...classes: string[]) => classes.filter(Boolean).join(' '),
}))

const mockOnValueChange = jest.fn()
jest.mock('@radix-ui/react-select', () => ({
  Root: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode
    onValueChange?: (value: string) => void
  }) => {
    mockOnValueChange.mockImplementation(onValueChange)
    return <div data-testid="select-root">{children}</div>
  },
  Trigger: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => (
    <button data-testid="select-trigger" className={className}>
      {children}
    </button>
  ),
  Value: ({ placeholder }: { placeholder?: string }) => (
    <span data-testid="select-value">{placeholder}</span>
  ),
  Icon: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="select-icon">{children}</span>
  ),
  Portal: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-portal">{children}</div>
  ),
  Content: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-content">{children}</div>
  ),
  Viewport: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-viewport">{children}</div>
  ),
  Item: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div
      data-testid={`select-item-${value}`}
      onClick={() => mockOnValueChange(value)}
    >
      {children}
    </div>
  ),
  ItemText: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="select-item-text">{children}</span>
  ),
  ItemIndicator: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="select-item-indicator">{children}</span>
  ),
  Arrow: () => <div data-testid="select-arrow" />,
}))
describe('@joi/core/Select', () => {
  const options = [
    { name: 'Option 1', value: 'option1' },
    { name: 'Option 2', value: 'option2' },
  ]

  it('renders with placeholder', () => {
    render(<Select placeholder="Select an option" options={options} />)
    expect(screen.getByTestId('select-value')).toHaveTextContent(
      'Select an option'
    )
  })

  it('renders options', () => {
    render(<Select options={options} />)
    expect(screen.getByTestId('select-item-option1')).toBeInTheDocument()
    expect(screen.getByTestId('select-item-option2')).toBeInTheDocument()
  })

  it('calls onValueChange when an option is selected', async () => {
    const user = userEvent.setup()
    const onValueChange = jest.fn()
    render(<Select options={options} onValueChange={onValueChange} />)

    await user.click(screen.getByTestId('select-trigger'))
    await user.click(screen.getByTestId('select-item-option1'))

    expect(onValueChange).toHaveBeenCalledWith('option1')
  })

  it('applies disabled class when disabled prop is true', () => {
    render(<Select options={options} disabled />)
    expect(screen.getByTestId('select-trigger')).toHaveClass('select__disabled')
  })

  it('applies block class when block prop is true', () => {
    render(<Select options={options} block />)
    expect(screen.getByTestId('select-trigger')).toHaveClass('w-full')
  })
})
