import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockSetProxyTimeout = vi.fn()
vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    proxyTimeout: 300,
    setProxyTimeout: mockSetProxyTimeout,
  }),
}))

import { ProxyTimeoutInput } from '../ProxyTimeoutInput'

describe('ProxyTimeoutInput', () => {
  it('renders with value', () => {
    render(<ProxyTimeoutInput />)
    expect(screen.getByDisplayValue('300')).toBeDefined()
  })

  it('sets timeout on valid blur', () => {
    render(<ProxyTimeoutInput />)
    const input = screen.getByDisplayValue('300')
    fireEvent.change(input, { target: { value: '600' } })
    fireEvent.blur(input)
    expect(mockSetProxyTimeout).toHaveBeenCalledWith(600)
  })

  it('calls setProxyTimeout on blur with any value', () => {
    render(<ProxyTimeoutInput />)
    const input = screen.getByDisplayValue('300')
    fireEvent.change(input, { target: { value: '99999' } })
    fireEvent.blur(input)
    expect(mockSetProxyTimeout).toHaveBeenCalled()
  })
})
