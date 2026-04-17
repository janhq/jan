import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockSetAccentColor = vi.fn()
vi.mock('@/hooks/useInterfaceSettings', () => ({
  useInterfaceSettings: () => ({
    accentColor: 'gray',
    setAccentColor: mockSetAccentColor,
  }),
  ACCENT_COLORS: [
    { name: 'Gray', value: 'gray', thumb: '#3F3F46' },
    { name: 'Red', value: 'red', thumb: '#F0614B' },
  ],
}))

import { AccentColorPicker } from '../AccentColorPicker'

describe('AccentColorPicker', () => {
  it('renders color buttons', () => {
    render(<AccentColorPicker />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveAttribute('title', 'Gray')
    expect(buttons[1]).toHaveAttribute('title', 'Red')
  })

  it('calls setAccentColor on click', () => {
    render(<AccentColorPicker />)
    fireEvent.click(screen.getByTitle('Red'))
    expect(mockSetAccentColor).toHaveBeenCalledWith('red')
  })

  it('applies selected ring class to current color', () => {
    render(<AccentColorPicker />)
    const grayBtn = screen.getByTitle('Gray')
    expect(grayBtn.className).toContain('ring-2')
  })
})
