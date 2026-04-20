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

    // Component should render Loader when total is 0
    const loader = container.querySelector('svg.animate-spin')
    expect(loader).not.toBeNull()
    expect(loader?.classList.contains('animate-spin')).toBe(true)
  })
})
