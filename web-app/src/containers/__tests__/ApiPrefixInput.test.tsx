import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockSetApiPrefix = vi.fn()
vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    apiPrefix: '/v1',
    setApiPrefix: mockSetApiPrefix,
  }),
}))

import { ApiPrefixInput } from '../ApiPrefixInput'

describe('ApiPrefixInput', () => {
  it('renders with initial value', () => {
    render(<ApiPrefixInput />)
    const input = screen.getByDisplayValue('/v1')
    expect(input).toBeDefined()
  })

  it('prepends slash on blur if missing', () => {
    render(<ApiPrefixInput />)
    const input = screen.getByDisplayValue('/v1')
    fireEvent.change(input, { target: { value: 'api' } })
    fireEvent.blur(input)
    expect(mockSetApiPrefix).toHaveBeenCalledWith('/api')
  })

  it('applies disabled style when server running', () => {
    render(<ApiPrefixInput isServerRunning />)
    const input = screen.getByDisplayValue('/v1')
    expect(input.className).toContain('opacity-50')
  })
})
