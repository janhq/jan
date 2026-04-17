import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    serverHost: '127.0.0.1',
    setServerHost: vi.fn(),
  }),
}))

import { ServerHostSwitcher } from '../ServerHostSwitcher'

describe('ServerHostSwitcher', () => {
  it('renders with current host', () => {
    render(<ServerHostSwitcher />)
    expect(screen.getByText('127.0.0.1')).toBeDefined()
  })
})
