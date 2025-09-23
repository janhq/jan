import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PromptProgress } from '../PromptProgress'
import { useAppState } from '@/hooks/useAppState'

// Mock the useAppState hook
vi.mock('@/hooks/useAppState', () => ({
  useAppState: vi.fn(),
}))

const mockUseAppState = useAppState as ReturnType<typeof vi.fn>

describe('PromptProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not render when promptProgress is undefined', () => {
    mockUseAppState.mockReturnValue(undefined)

    const { container } = render(<PromptProgress />)
    expect(container.firstChild).toBeNull()
  })

  it('should render progress when promptProgress is available', () => {
    const mockProgress = {
      cache: 0,
      processed: 50,
      time_ms: 1000,
      total: 100,
    }

    mockUseAppState.mockReturnValue(mockProgress)

    render(<PromptProgress />)

    expect(screen.getByText('Reading: 50%')).toBeInTheDocument()
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('should calculate percentage correctly', () => {
    const mockProgress = {
      cache: 0,
      processed: 75,
      time_ms: 1500,
      total: 150,
    }

    mockUseAppState.mockReturnValue(mockProgress)

    render(<PromptProgress />)

    expect(screen.getByText('Reading: 50%')).toBeInTheDocument()
  })

  it('should handle zero total gracefully', () => {
    const mockProgress = {
      cache: 0,
      processed: 0,
      time_ms: 0,
      total: 0,
    }

    mockUseAppState.mockReturnValue(mockProgress)

    const { container } = render(<PromptProgress />)

    // Component should not render when total is 0
    expect(container.firstChild).toBeNull()
  })
})
