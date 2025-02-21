import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Slider } from './index'

// Mock the styles
jest.mock('./styles.scss', () => ({}))

// Mock Radix UI Slider
jest.mock('@radix-ui/react-slider', () => ({
  Root: ({ children, onValueChange, ...props }: any) => (
    <div
      data-testid="slider-root"
      {...props}
      onChange={(e: any) =>
        onValueChange && onValueChange([parseInt(e.target.value)])
      }
    >
      <input type="range" {...props} />
      {children}
    </div>
  ),
  Track: ({ children }: any) => (
    <div data-testid="slider-track">{children}</div>
  ),
  Range: () => <div data-testid="slider-range" />,
  Thumb: () => <div data-testid="slider-thumb" />,
}))

describe('@joi/core/Slider', () => {
  it('renders correctly with default props', () => {
    render(<Slider value={[1]}/>)
    expect(screen.getByTestId('slider-root')).toBeInTheDocument()
    expect(screen.getByTestId('slider-track')).toBeInTheDocument()
    expect(screen.getByTestId('slider-range')).toBeInTheDocument()
    expect(screen.getByTestId('slider-thumb')).toBeInTheDocument()
  })

  it('passes props correctly to SliderPrimitive.Root', () => {
    const props = {
      name: 'test-slider',
      min: 0,
      max: 100,
      value: [50],
      step: 1,
      disabled: true,
    }
    render(<Slider {...props} />)
    const sliderRoot = screen.getByTestId('slider-root')
    expect(sliderRoot).toHaveAttribute('name', 'test-slider')
    expect(sliderRoot).toHaveAttribute('min', '0')
    expect(sliderRoot).toHaveAttribute('max', '100')
    expect(sliderRoot).toHaveAttribute('value', '50')
    expect(sliderRoot).toHaveAttribute('step', '1')
    expect(sliderRoot).toHaveAttribute('disabled', '')
  })

  it('calls onValueChange when value changes', () => {
    const onValueChange = jest.fn()
    render(<Slider onValueChange={onValueChange} min={0} max={100} step={1} />)
    const input = screen.getByTestId('slider-root').querySelector('input')
    fireEvent.change(input!, { target: { value: '75' } })
    expect(onValueChange).toHaveBeenCalledWith([75])
  })
})
