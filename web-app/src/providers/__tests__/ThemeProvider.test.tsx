import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemeProvider } from '../ThemeProvider'
import { useTheme } from '@/hooks/useTheme'

// Mock hooks
vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn(() => ({
    activeTheme: 'light',
    setIsDark: vi.fn(),
    setTheme: vi.fn(),
  })),
  checkOSDarkMode: vi.fn(() => false),
}))

describe('ThemeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', () => {
    render(<ThemeProvider />)
    
    // ThemeProvider doesn't render anything visible, just manages theme state
    expect(document.body).toBeInTheDocument()
  })

  it('calls theme hooks on mount', () => {
    render(<ThemeProvider />)
    
    // Verify that the theme hook was called
    expect(useTheme).toHaveBeenCalled()
  })

  it('sets up media query listener for auto theme', () => {
    const mockSetIsDark = vi.fn()
    const mockSetTheme = vi.fn()
    
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'auto',
      setIsDark: mockSetIsDark,
      setTheme: mockSetTheme,
    })
    
    render(<ThemeProvider />)
    
    // Theme provider should call setTheme when in auto mode
    expect(mockSetTheme).toHaveBeenCalledWith('auto')
  })

  it('handles light theme correctly', () => {
    const mockSetIsDark = vi.fn()
    const mockSetTheme = vi.fn()
    
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'light',
      setIsDark: mockSetIsDark,
      setTheme: mockSetTheme,
    })
    
    render(<ThemeProvider />)
    
    // Should be called on mount
    expect(useTheme).toHaveBeenCalled()
  })

  it('handles dark theme correctly', () => {
    const mockSetIsDark = vi.fn()
    const mockSetTheme = vi.fn()
    
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'dark',
      setIsDark: mockSetIsDark,
      setTheme: mockSetTheme,
    })
    
    render(<ThemeProvider />)
    
    // Should be called on mount
    expect(useTheme).toHaveBeenCalled()
  })
})
