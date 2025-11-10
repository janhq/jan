import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useJanBrowserPrompt } from '../useJanBrowserPrompt'
import { localStorageKey } from '@/constants/localStorage'

// Mock dependencies
vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../useMCPServers', () => ({
  useMCPServers: vi.fn(() => ({
    mcpServers: {
      'Jan Browser Extension (Experimental)': {
        command: 'node',
        args: ['/path/to/index.js'],
        env: {
          BRIDGE_HOST: '127.0.0.1',
          BRIDGE_PORT: '17389',
        },
        active: false,
        type: 'stdio',
      },
      browsermcp: {
        command: 'npx',
        args: ['@browsermcp/mcp'],
        active: false,
      },
    },
  })),
}))

vi.mock('../useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    mcp: () => ({
      getConnectedServers: vi.fn().mockResolvedValue([]),
      activateMCPServer: vi.fn().mockResolvedValue(undefined),
      deactivateMCPServer: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}))

describe('useJanBrowserPrompt', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should not show prompt if setup is not completed', () => {
    localStorage.setItem(localStorageKey.setupCompleted, 'false')

    const { result } = renderHook(() => useJanBrowserPrompt())

    expect(result.current.showPrompt).toBe(false)
  })

  it('should not show prompt if prompt was already shown', () => {
    localStorage.setItem(localStorageKey.setupCompleted, 'true')
    localStorage.setItem(localStorageKey.janBrowserPromptShown, 'true')

    const { result } = renderHook(() => useJanBrowserPrompt())

    expect(result.current.showPrompt).toBe(false)
  })

  it('should initialize hook when conditions are met', () => {
    localStorage.setItem(localStorageKey.setupCompleted, 'true')

    const { result } = renderHook(() => useJanBrowserPrompt())

    // Hook should initialize without error
    expect(result.current).toBeDefined()
    expect(result.current.showPrompt).toBe(false)
  })

  it('should return showPrompt status', () => {
    const { result } = renderHook(() => useJanBrowserPrompt())

    expect(result.current).toHaveProperty('showPrompt')
    expect(typeof result.current.showPrompt).toBe('boolean')
  })

  it('should initialize with showPrompt as false', () => {
    const { result } = renderHook(() => useJanBrowserPrompt())

    expect(result.current.showPrompt).toBe(false)
  })

  it('should handle empty localStorage gracefully', () => {
    localStorage.clear()

    const { result } = renderHook(() => useJanBrowserPrompt())

    expect(result.current.showPrompt).toBe(false)
  })

  it('should work with various localStorage states', () => {
    // Test with setup completed but prompt not shown
    localStorage.setItem(localStorageKey.setupCompleted, 'true')
    const { result: result1 } = renderHook(() => useJanBrowserPrompt())
    expect(result1.current).toBeDefined()

    // Test with setup not completed
    localStorage.clear()
    localStorage.setItem(localStorageKey.setupCompleted, 'false')
    const { result: result2 } = renderHook(() => useJanBrowserPrompt())
    expect(result2.current).toBeDefined()

    // Test with both flags set
    localStorage.setItem(localStorageKey.setupCompleted, 'true')
    localStorage.setItem(localStorageKey.janBrowserPromptShown, 'true')
    const { result: result3 } = renderHook(() => useJanBrowserPrompt())
    expect(result3.current).toBeDefined()
  })
})
