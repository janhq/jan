import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DataProvider } from '../DataProvider'
import { RouterProvider, createRouter, createRootRoute, createMemoryHistory } from '@tanstack/react-router'

// Mock Tauri deep link
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: vi.fn(),
  getCurrent: vi.fn().mockResolvedValue([]),
}))

// Mock services
vi.mock('@/services/threads', () => ({
  fetchThreads: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/messages', () => ({
  fetchMessages: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/providers', () => ({
  getProviders: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/assistants', () => ({
  getAssistants: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/mcp', () => ({
  getMCPConfig: vi.fn().mockResolvedValue({ mcpServers: [] }),
}))

// Mock hooks
vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({
    setThreads: vi.fn(),
  })),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    setProviders: vi.fn(),
  })),
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: vi.fn(() => ({
    setAssistants: vi.fn(),
  })),
}))

vi.mock('@/hooks/useMessages', () => ({
  useMessages: vi.fn(() => ({
    setMessages: vi.fn(),
  })),
}))

vi.mock('@/hooks/useAppUpdater', () => ({
  useAppUpdater: vi.fn(() => ({
    checkForUpdate: vi.fn(),
  })),
}))

vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: vi.fn(() => ({
    setServers: vi.fn(),
  })),
}))

describe('DataProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderWithRouter = (children: React.ReactNode) => {
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <DataProvider />
          {children}
        </>
      ),
    })

    const router = createRouter({ 
      routeTree: rootRoute,
      history: createMemoryHistory({
        initialEntries: ['/'],
      }),
    })
    return render(<RouterProvider router={router} />)
  }

  it('renders without crashing', () => {
    renderWithRouter(<div>Test Child</div>)
    
    expect(screen.getByText('Test Child')).toBeInTheDocument()
  })

  it('initializes data on mount', async () => {
    const mockFetchThreads = vi.mocked(await vi.importMock('@/services/threads')).fetchThreads
    const mockGetAssistants = vi.mocked(await vi.importMock('@/services/assistants')).getAssistants
    const mockGetProviders = vi.mocked(await vi.importMock('@/services/providers')).getProviders
    
    renderWithRouter(<div>Test Child</div>)
    
    await waitFor(() => {
      expect(mockFetchThreads).toHaveBeenCalled()
      expect(mockGetAssistants).toHaveBeenCalled()
      expect(mockGetProviders).toHaveBeenCalled()
    })
  })

  it('handles multiple children correctly', () => {
    const TestComponent1 = () => <div>Test Child 1</div>
    const TestComponent2 = () => <div>Test Child 2</div>
    
    renderWithRouter(
      <>
        <TestComponent1 />
        <TestComponent2 />
      </>
    )
    
    expect(screen.getByText('Test Child 1')).toBeInTheDocument()
    expect(screen.getByText('Test Child 2')).toBeInTheDocument()
  })
})