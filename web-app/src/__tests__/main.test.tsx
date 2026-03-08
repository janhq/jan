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

// Mock route tree
vi.mock('../routeTree.gen', () => ({
  routeTree: 'mocked-route-tree',
}))

// Mock CSS imports
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
    
    // Clear all mocks
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('should render app when root element is empty', async () => {
    mockRootElement.innerHTML = ''
    
    await import('../main')
    
    expect(mockGetElementById).toHaveBeenCalledWith('root')
    expect(mockCreateRoot).toHaveBeenCalledWith(mockRootElement)
    expect(mockRender).toHaveBeenCalled()
  })

  it('should not render app when root element already has content', async () => {
    mockRootElement.innerHTML = '<div>existing content</div>'
    
    await import('../main')
    
    expect(mockGetElementById).toHaveBeenCalledWith('root')
    expect(mockCreateRoot).not.toHaveBeenCalled()
    expect(mockRender).not.toHaveBeenCalled()
  })

  it('should throw error when root element is not found', async () => {
    mockGetElementById.mockReturnValue(null)
    
    await expect(async () => {
      await import('../main')
    }).rejects.toThrow()
  })
})
