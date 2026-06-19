import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock ReactDOM
const mockRender = vi.fn()
const mockCreateRoot = vi.fn().mockReturnValue({ render: mockRender })

vi.mock('react-dom/client', () => ({
  default: {
    createRoot: mockCreateRoot,
  },
  createRoot: mockCreateRoot,
}))

// Mock router
vi.mock('@tanstack/react-router', () => ({
  RouterProvider: ({ router }: { router: any }) => `<RouterProvider router={router} />`,
  createRouter: vi.fn().mockReturnValue('mocked-router'),
  createRootRoute: vi.fn(),
}))

// take_pending_webdata_reset returns null (no pending reset) by default
const mockInvoke = vi.fn().mockResolvedValue(null)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

// Dynamically-imported modules (deferred until after the reset prune)
vi.mock('../routeTree.gen', () => ({
  routeTree: 'mocked-route-tree',
}))
vi.mock('../index.css', () => ({}))
vi.mock('../i18n', () => ({}))

describe('main.tsx', () => {
  let mockGetElementById: any
  let mockRootElement: any

  beforeEach(() => {
    mockRootElement = {
      innerHTML: '',
    }
    mockGetElementById = vi.fn().mockReturnValue(mockRootElement)
    Object.defineProperty(document, 'getElementById', {
      value: mockGetElementById,
      writable: true,
    })

    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('consumes the pending-reset sentinel before rendering', async () => {
    await import('../main')

    await vi.waitFor(() => expect(mockRender).toHaveBeenCalled())
    expect(mockInvoke).toHaveBeenCalledWith('take_pending_webdata_reset')
    expect(mockCreateRoot).toHaveBeenCalledWith(mockRootElement)
  })

  it('should not render app when root element already has content', async () => {
    mockRootElement.innerHTML = '<div>existing content</div>'

    await import('../main')

    await vi.waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('take_pending_webdata_reset')
    )
    expect(mockCreateRoot).not.toHaveBeenCalled()
    expect(mockRender).not.toHaveBeenCalled()
  })

  it('does not render when root element is missing', async () => {
    mockGetElementById.mockReturnValue(null)

    await import('../main')

    await vi.waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('take_pending_webdata_reset')
    )
    expect(mockRender).not.toHaveBeenCalled()
  })
})
