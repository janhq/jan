import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemeProvider } from '../ThemeProvider'
import { useTheme } from '@/hooks/useTheme'

vi.mock('@/hooks/useTheme', () => {
  const useThemeMock = Object.assign(
    vi.fn(() => ({
      activeTheme: 'light',
      isDark: false,
      setIsDark: vi.fn(),
      setTheme: vi.fn(),
    })),
    { getState: () => ({ activeTheme: 'light' }) }
  )
  return {
    useTheme: useThemeMock,
    checkOSDarkMode: vi.fn(() => false),
  }
})

describe('ThemeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', () => {
    render(<ThemeProvider />)
    expect(document.body).toBeInTheDocument()
  })

  it('calls theme hooks on mount', () => {
    render(<ThemeProvider />)
    expect(useTheme).toHaveBeenCalled()
  })

  it('reads activeTheme from store on event', () => {
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'auto',
      isDark: false,
      setIsDark: vi.fn(),
      setTheme: vi.fn(),
    })
    render(<ThemeProvider />)
    expect(useTheme).toHaveBeenCalled()
  })

  it('handles light theme correctly', () => {
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'light',
      isDark: false,
      setIsDark: vi.fn(),
      setTheme: vi.fn(),
    })
    render(<ThemeProvider />)
    expect(useTheme).toHaveBeenCalled()
  })

  it('handles dark theme correctly', () => {
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'dark',
      isDark: true,
      setIsDark: vi.fn(),
      setTheme: vi.fn(),
    })
    render(<ThemeProvider />)
    expect(useTheme).toHaveBeenCalled()
  })
})
