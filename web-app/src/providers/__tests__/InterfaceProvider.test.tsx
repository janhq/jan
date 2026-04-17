import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InterfaceProvider } from '../InterfaceProvider'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useTheme } from '@/hooks/useTheme'

vi.mock('@/hooks/useInterfaceSettings', () => ({
  useInterfaceSettings: vi.fn(() => ({
    fontSize: '14px',
    accentColor: 'blue',
  })),
  ACCENT_COLORS: [
    {
      value: 'blue',
      primary: '#3b82f6',
      sidebar: { dark: '#1e3a5f', light: '#dbeafe' },
    },
    {
      value: 'red',
      primary: '#ef4444',
      sidebar: { dark: '#7f1d1d', light: '#fee2e2' },
    },
  ],
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn(() => ({ isDark: false })),
}))

describe('InterfaceProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset CSS vars
    document.documentElement.style.removeProperty('--font-size-base')
    document.documentElement.style.removeProperty('--primary')
    document.documentElement.style.removeProperty('--sidebar')
  })

  it('applies font size to document root', () => {
    render(<InterfaceProvider />)
    expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe('14px')
  })

  it('applies light sidebar color when not dark', () => {
    render(<InterfaceProvider />)
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#3b82f6')
    expect(document.documentElement.style.getPropertyValue('--sidebar')).toBe('#dbeafe')
  })

  it('applies dark sidebar color when isDark', () => {
    vi.mocked(useTheme).mockReturnValue({ isDark: true } as any)
    render(<InterfaceProvider />)
    expect(document.documentElement.style.getPropertyValue('--sidebar')).toBe('#1e3a5f')
  })

  it('does not set CSS vars for unknown accent color', () => {
    vi.mocked(useInterfaceSettings).mockReturnValue({
      fontSize: '16px',
      accentColor: 'unknown',
    } as any)
    render(<InterfaceProvider />)
    expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe('16px')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
  })

  it('renders null', () => {
    const { container } = render(<InterfaceProvider />)
    expect(container.innerHTML).toBe('')
  })
})
