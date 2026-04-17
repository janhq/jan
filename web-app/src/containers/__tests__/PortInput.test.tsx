import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockSetServerPort = vi.fn()
vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    serverPort: 1337,
    setServerPort: mockSetServerPort,
  }),
}))

import { PortInput } from '../PortInput'

describe('PortInput', () => {
  it('renders with port value', () => {
    render(<PortInput />)
    expect(screen.getByDisplayValue('1337')).toBeDefined()
  })

  it('sets port on valid blur', () => {
    render(<PortInput />)
    const input = screen.getByDisplayValue('1337')
    fireEvent.change(input, { target: { value: '8080' } })
    fireEvent.blur(input)
    expect(mockSetServerPort).toHaveBeenCalledWith(8080)
  })

  it('does not call setServerPort when port is out of range', () => {
    render(<PortInput />)
    const input = screen.getByDisplayValue('1337')
    fireEvent.change(input, { target: { value: '99999' } })
    fireEvent.blur(input)
    expect(mockSetServerPort).not.toHaveBeenCalled()
  })
})
