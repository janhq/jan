import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServiceHubProvider } from '../ServiceHubProvider'

const mockInitializeServiceHub = vi.fn()
const mockInitializeServiceHubStore = vi.fn()

vi.mock('@/services', () => ({
  initializeServiceHub: (...args: any[]) => mockInitializeServiceHub(...args),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({})),
  getServiceHub: vi.fn(() => ({})),
  initializeServiceHubStore: (...args: any[]) => mockInitializeServiceHubStore(...args),
  isServiceHubInitialized: () => true,
}))

describe('ServiceHubProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders children after successful initialization', async () => {
    const hub = { test: true }
    mockInitializeServiceHub.mockResolvedValue(hub)
    render(
      <ServiceHubProvider>
        <div data-testid="child">Content</div>
      </ServiceHubProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeInTheDocument()
    })
    expect(mockInitializeServiceHubStore).toHaveBeenCalledWith(hub)
  })

  it('hides children until initialized', () => {
    // Use a deferred promise we can control, with cleanup to prevent hang
    let resolve: (v: any) => void
    const pending = new Promise((r) => { resolve = r })
    mockInitializeServiceHub.mockReturnValue(pending)
    const { container, unmount } = render(
      <ServiceHubProvider>
        <div data-testid="child">Content</div>
      </ServiceHubProvider>
    )
    expect(container.querySelector('[data-testid="child"]')).toBeNull()
    // Resolve and unmount to prevent vitest from hanging
    resolve!(undefined)
    unmount()
  })

  it('still renders children on initialization error', async () => {
    mockInitializeServiceHub.mockRejectedValue(new Error('init failed'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ServiceHubProvider>
        <div data-testid="child">Content</div>
      </ServiceHubProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeInTheDocument()
    })
    expect(mockInitializeServiceHubStore).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
