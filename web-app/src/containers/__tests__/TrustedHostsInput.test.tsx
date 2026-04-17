import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockSetTrustedHosts = vi.fn()
vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    trustedHosts: ['localhost', '127.0.0.1'],
    setTrustedHosts: mockSetTrustedHosts,
  }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { TrustedHostsInput } from '../TrustedHostsInput'

describe('TrustedHostsInput', () => {
  it('renders with comma-separated hosts', () => {
    render(<TrustedHostsInput />)
    expect(screen.getByDisplayValue('localhost, 127.0.0.1')).toBeDefined()
  })

  it('calls setTrustedHosts on blur', () => {
    render(<TrustedHostsInput />)
    const input = screen.getByDisplayValue('localhost, 127.0.0.1')
    fireEvent.blur(input)
    expect(mockSetTrustedHosts).toHaveBeenCalled()
  })
})
