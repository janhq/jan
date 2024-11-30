import '@testing-library/jest-dom'
import React from 'react'
import { render, fireEvent } from '@testing-library/react'
import ModelConfigInput from './index'

// Mocking the Tooltip component to simplify testing
jest.mock('@janhq/joi', () => ({
  ...jest.requireActual('@janhq/joi'),
  Tooltip: ({
    trigger,
    content,
  }: {
    trigger: React.ReactNode
    content: string
  }) => (
    <div data-testid="tooltip">
      {trigger}
      <span>{content}</span>
    </div>
  ),
}))

describe('ModelConfigInput', () => {
  it('renders correctly with given props', () => {
    const { getByText, getByPlaceholderText } = render(
      <ModelConfigInput
        title="Test Title"
        description="This is a description."
        placeholder="Enter text here"
        value=""
        name={''}
      />
    )

    // Check if title is rendered
    expect(getByText('Test Title')).toBeInTheDocument()

    // Check if the description tooltip content is rendered
    expect(getByText('This is a description.')).toBeInTheDocument()

    // Check if the placeholder is rendered
    expect(getByPlaceholderText('Enter text here')).toBeInTheDocument()
  })

  it('calls onValueChanged when value changes', () => {
    const onValueChangedMock = jest.fn()
    const { getByPlaceholderText } = render(
      <ModelConfigInput
        title="Test Title"
        description="This is a description."
        placeholder="Enter text here"
        value=""
        onValueChanged={onValueChangedMock}
        name={''}
      />
    )

    const textArea = getByPlaceholderText('Enter text here')

    // Simulate typing in the textarea
    fireEvent.change(textArea, { target: { value: 'New Value' } })

    // Check if onValueChanged was called with the new value
    expect(onValueChangedMock).toHaveBeenCalledWith('New Value')
  })

  it('disables the textarea when disabled prop is true', () => {
    const { getByPlaceholderText } = render(
      <ModelConfigInput
        title="Test Title"
        description="This is a description."
        placeholder="Enter text here"
        value=""
        disabled={true}
        name={''}
      />
    )

    const textArea = getByPlaceholderText('Enter text here')

    // Check if the textarea is disabled
    expect(textArea).toBeDisabled()
  })
})
