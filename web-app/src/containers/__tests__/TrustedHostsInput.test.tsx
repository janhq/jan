import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrustedHostsInput } from '../TrustedHostsInput'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

// The settings store persists to localStorage; keep these tests in memory.
vi.mock('zustand/middleware', () => ({
  persist: (fn: unknown) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

const savedHosts = () => useLocalApiServer.getState().trustedHosts
const field = () => screen.getByPlaceholderText('common:enterTrustedHosts')

describe('TrustedHostsInput', () => {
  beforeEach(() => {
    cleanup()
    useLocalApiServer.setState({ trustedHosts: [] })
  })

  it('saves a typed entry when the field loses focus, trimmed and de-duplicated', async () => {
    const user = userEvent.setup()
    render(<TrustedHostsInput />)
    await user.type(field(), ' a.example , b.example,a.example ')
    await user.tab()
    expect(savedHosts()).toEqual(['a.example', 'b.example'])
    expect(field()).toHaveValue('a.example, b.example')
  })

  it('saves a typed entry on Enter', async () => {
    const user = userEvent.setup()
    render(<TrustedHostsInput />)
    await user.type(field(), 'a.example{Enter}')
    expect(savedHosts()).toEqual(['a.example'])
  })

  // Closing the settings popover unmounts the field without a blur event.
  it('keeps a typed entry when the field is removed without losing focus', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<TrustedHostsInput />)
    await user.type(field(), 'a.example, b.example')
    unmount()
    expect(savedHosts()).toEqual(['a.example', 'b.example'])
  })

  it('does not rewrite the saved hosts when nothing was typed', () => {
    const hosts = ['a.example']
    useLocalApiServer.setState({ trustedHosts: hosts })
    const { unmount } = render(<TrustedHostsInput />)
    unmount()
    expect(savedHosts()).toBe(hosts)
  })
})
