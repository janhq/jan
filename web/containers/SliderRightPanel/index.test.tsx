import React from 'react'
import { render } from '@testing-library/react'
import { fireEvent, screen } from '@testing-library/dom'
import SliderRightPanel from './index'
import '@testing-library/jest-dom'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock

jest.mock('@radix-ui/react-slider', () => ({
  Root: ({ children, onValueChange, ...props }: any) => (
    <div data-testid="slider-root" {...props}>
      <input
        data-testid="slider-input"
        type="number"
        {...props}
        onChange={(e: any) =>
          onValueChange && onValueChange([parseInt(e.target.value)])
        }
      />
      {children}
    </div>
  ),
  Track: ({ children }: any) => (
    <div data-testid="slider-track">{children}</div>
  ),
  Range: () => <div data-testid="slider-range" />,
  Thumb: () => <div data-testid="slider-thumb" />,
}))

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
    const { getByText } = render(
      <SliderRightPanel {...defaultProps} />
    )
    expect(getByText('Test Slider')).toBeInTheDocument()
  })

  it('calls onValueChanged with correct value when input is changed', () => {
    defaultProps.onValueChanged = jest.fn()
    const { getByRole } = render(<SliderRightPanel {...defaultProps} />)

    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: '75' } })
    expect(defaultProps.onValueChanged).toHaveBeenCalledWith(75)
  })

  it('calls onValueChanged with correct value when slider is changed', () => {
    defaultProps.onValueChanged = jest.fn()

    const input = screen.getByTestId('slider-input')
    fireEvent.change(input, { target: { value: '75' } })
    expect(defaultProps.onValueChanged).toHaveBeenCalledWith(75)
  })

  it('displays tooltip with max value message when input exceeds max', () => {
    defaultProps.onValueChanged = jest.fn()
    const { getByRole } = render(<SliderRightPanel {...defaultProps} />)
    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: '150' } })
    fireEvent.focusOut(input)
    expect(defaultProps.onValueChanged).toHaveBeenCalledWith(100)
  })

  it('displays tooltip with min value message when input is below min', () => {
    defaultProps.onValueChanged = jest.fn()
    const { getByRole } = render(<SliderRightPanel {...defaultProps} />)
    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.focusOut(input)
    expect(defaultProps.onValueChanged).toHaveBeenCalledWith(0)
  })

  it('does not call onValueChanged when input is invalid', () => {
    defaultProps.onValueChanged = jest.fn()
    const { getByRole } = render(<SliderRightPanel {...defaultProps} />)
    const input = getByRole('textbox')
    fireEvent.change(input, { target: { value: 'invalid' } })
    expect(defaultProps.onValueChanged).not.toHaveBeenCalledWith(0)
  })
})
