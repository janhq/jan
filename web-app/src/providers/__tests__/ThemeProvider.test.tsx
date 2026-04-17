import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ThemeProvider } from '../ThemeProvider'
import { useTheme, checkOSDarkMode } from '@/hooks/useTheme'

vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn(() => ({
    activeTheme: 'light',
    isDark: false,
    setIsDark: vi.fn(),
    setTheme: vi.fn(),
  })),
  checkOSDarkMode: vi.fn(() => false),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: vi.fn(() => false),
}))

describe('ThemeProvider', () => {
  let listeners: Map<string, Function>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    listeners = new Map()
    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn((evt: string, cb: Function) => listeners.set(evt, cb)),
        removeEventListener: vi.fn(),
      })),
    })
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds dark class when isDark is true', () => {
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'dark',
      isDark: true,
      setIsDark: vi.fn(),
      setTheme: vi.fn(),
    })
    render(<ThemeProvider />)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes dark class when isDark is false', () => {
    document.documentElement.classList.add('dark')
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'light',
      isDark: false,
      setIsDark: vi.fn(),
      setTheme: vi.fn(),
    })
    render(<ThemeProvider />)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('calls checkOSDarkMode and setTheme when auto theme', () => {
    const setIsDark = vi.fn()
    const setTheme = vi.fn()
    vi.mocked(checkOSDarkMode).mockReturnValue(true)
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'auto',
      isDark: false,
      setIsDark,
      setTheme,
    })
    render(<ThemeProvider />)
    expect(checkOSDarkMode).toHaveBeenCalled()
    expect(setIsDark).toHaveBeenCalledWith(true)
    expect(setTheme).toHaveBeenCalledWith('auto')
  })

  it('delayed refresh fires after timeout', () => {
    const setIsDark = vi.fn()
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'auto',
      isDark: false,
      setIsDark,
      setTheme: vi.fn(),
    })
    render(<ThemeProvider />)
    setIsDark.mockClear()
    act(() => { vi.advanceTimersByTime(100) })
    expect(setIsDark).toHaveBeenCalled()
  })

  it('media query change updates isDark in auto mode', () => {
    const setIsDark = vi.fn()
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'auto',
      isDark: false,
      setIsDark,
      setTheme: vi.fn(),
    })
    render(<ThemeProvider />)
    const changeHandler = listeners.get('change')
    expect(changeHandler).toBeDefined()
    act(() => { changeHandler!({ matches: true } as MediaQueryListEvent) })
    expect(setIsDark).toHaveBeenCalledWith(true)
  })

  it('does not update isDark on media change when not auto', () => {
    const setIsDark = vi.fn()
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'dark',
      isDark: true,
      setIsDark,
      setTheme: vi.fn(),
    })
    render(<ThemeProvider />)
    const changeHandler = listeners.get('change')
    if (changeHandler) {
      setIsDark.mockClear()
      act(() => { changeHandler({ matches: false } as MediaQueryListEvent) })
      expect(setIsDark).not.toHaveBeenCalled()
    }
  })

  it('renders null', () => {
    const { container } = render(<ThemeProvider />)
    expect(container.innerHTML).toBe('')
  })
})
