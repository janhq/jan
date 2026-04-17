import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import posthog from 'posthog-js'
import { AnalyticProvider } from '../AnalyticProvider'
import { useAnalytic } from '@/hooks/useAnalytic'

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    identify: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    register: vi.fn(),
    get_distinct_id: vi.fn().mockReturnValue('ph-id'),
  },
}))

vi.mock('@/hooks/useAnalytic', () => ({
  useAnalytic: vi.fn(() => ({ productAnalytic: false })),
}))

const mockGetAppDistinctId = vi.fn()
const mockUpdateDistinctId = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    analytic: () => ({
      getAppDistinctId: mockGetAppDistinctId,
      updateDistinctId: mockUpdateDistinctId,
    }),
  })),
}))

describe('AnalyticProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set globals that the component checks
    ;(globalThis as any).POSTHOG_KEY = 'test-key'
    ;(globalThis as any).POSTHOG_HOST = 'https://ph.test'
    ;(globalThis as any).VERSION = '1.0.0'
  })

  it('renders null', () => {
    const { container } = render(<AnalyticProvider />)
    expect(container.innerHTML).toBe('')
  })

  it('opts out when productAnalytic is false', () => {
    vi.mocked(useAnalytic).mockReturnValue({ productAnalytic: false } as any)
    render(<AnalyticProvider />)
    expect(posthog.opt_out_capturing).toHaveBeenCalled()
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it('initializes posthog when productAnalytic is true', async () => {
    vi.mocked(useAnalytic).mockReturnValue({ productAnalytic: true } as any)
    mockGetAppDistinctId.mockResolvedValue('existing-id')

    render(<AnalyticProvider />)

    expect(posthog.init).toHaveBeenCalledWith('test-key', expect.objectContaining({
      api_host: 'https://ph.test',
      autocapture: false,
    }))

    await waitFor(() => {
      expect(posthog.identify).toHaveBeenCalledWith('existing-id')
      expect(posthog.opt_in_capturing).toHaveBeenCalled()
      expect(posthog.register).toHaveBeenCalledWith({ app_version: '1.0.0' })
      expect(mockUpdateDistinctId).toHaveBeenCalledWith('ph-id')
    })
  })

  it('skips identify when no existing distinct id', async () => {
    vi.mocked(useAnalytic).mockReturnValue({ productAnalytic: true } as any)
    mockGetAppDistinctId.mockResolvedValue(null)

    render(<AnalyticProvider />)

    await waitFor(() => {
      expect(posthog.opt_in_capturing).toHaveBeenCalled()
    })
    expect(posthog.identify).not.toHaveBeenCalled()
  })

  it('does not init when POSTHOG_KEY is missing', () => {
    ;(globalThis as any).POSTHOG_KEY = ''
    vi.mocked(useAnalytic).mockReturnValue({ productAnalytic: true } as any)
    render(<AnalyticProvider />)
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it('sanitize_properties nullifies denied keys', () => {
    vi.mocked(useAnalytic).mockReturnValue({ productAnalytic: true } as any)
    mockGetAppDistinctId.mockResolvedValue(null)
    render(<AnalyticProvider />)

    const initCall = vi.mocked(posthog.init).mock.calls[0]
    const sanitize = initCall[1]?.sanitize_properties as (props: Record<string, any>) => Record<string, any>
    const props = { '$pathname': '/secret', '$host': 'localhost', safe_key: 'ok' }
    const result = sanitize(props)
    expect(result['$pathname']).toBeNull()
    expect(result['$host']).toBeNull()
    expect(result.safe_key).toBe('ok')
  })
})
