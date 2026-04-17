import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/ui/slider', () => ({
  Slider: ({ value, min, max }: any) => (
    <div data-testid="slider" data-value={value?.[0]} data-min={min} data-max={max} />
  ),
}))
vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange }: any) => (
    <input data-testid="slider-input" value={value} onChange={onChange} />
  ),
}))

import { SliderControl } from '../SliderControl'

describe('SliderControl', () => {
  it('renders slider with value', () => {
    render(<SliderControl value={[50]} min={0} max={100} step={1} onChange={vi.fn()} />)
    expect(screen.getByTestId('slider')).toBeInTheDocument()
    expect(screen.getByTestId('slider')).toHaveAttribute('data-value', '50')
  })

  it('renders min and max labels', () => {
    render(<SliderControl value={[50]} min={0} max={100} step={1} onChange={vi.fn()} />)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('renders input with current value', () => {
    render(<SliderControl value={[75]} min={0} max={100} onChange={vi.fn()} />)
    expect(screen.getByTestId('slider-input')).toHaveValue('75')
  })
})
