import React from 'react'
import { render } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import SliderRightPanel from './index'
import '@testing-library/jest-dom'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock

describe('SliderRightPanel', () => {
  const defaultProps = {
    title: 'Test Slider',
    disabled: false,
    min: 0,
    max: 100,
    step: 1,
    description: 'This is a test slider',
    value: 50,
    onValueChanged: jest.fn(),
  }

  it('renders correctly with given props', () => {
    const { getByText, getByRole } = render(
      <SliderRightPanel {...defaultProps} />
    )
    expect(getByText('Test Slider')).toBeInTheDocument()
    expect(getByRole('slider')).toBeInTheDocument()
  })

  it('calls onValueChanged with correct value when input is changed', () => {
    defaultProps.onValueChanged = jest.fn()
    const { getByRole } = render(<SliderRightPanel {...defaultProps} />)

    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: '75' } })
    userEvent.tab()
    fireEvent.blur(input)
    fireEvent.focusOut(input)
    fireEvent.mouseUp(input)
    expect(defaultProps.onValueChanged).toHaveBeenCalledWith(75)
  })

  it('displays tooltip with max value message when input exceeds max', () => {
    defaultProps.onValueChanged = jest.fn()
    const { getByRole } = render(<SliderRightPanel {...defaultProps} />)
    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: '150' } })
    userEvent.tab()
    fireEvent.blur(input)
    fireEvent.focusOut(input)
    fireEvent.mouseUp(input)
    expect(defaultProps.onValueChanged).toHaveBeenCalledWith(100)
  })

  it('displays tooltip with min value message when input is below min', () => {
    defaultProps.onValueChanged = jest.fn()
    const { getByRole } = render(<SliderRightPanel {...defaultProps} />)
    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: '0' } })
    userEvent.tab()
    fireEvent.blur(input)
    fireEvent.focusOut(input)
    fireEvent.mouseUp(input)
    expect(defaultProps.onValueChanged).toHaveBeenCalledWith(0)
  })

  it('does not call onValueChanged when input is invalid', () => {
    defaultProps.onValueChanged = jest.fn()
    const { getByRole } = render(<SliderRightPanel {...defaultProps} />)
    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: 'invalid' } })
    expect(defaultProps.onValueChanged).not.toHaveBeenCalledWith(0)
  })

  // TODO: Add slider tests
})
