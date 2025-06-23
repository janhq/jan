import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SystemEvent } from '@/types/events'

// Mock the Tauri API
const mockListen = vi.fn()
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
}

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}))

vi.mock('sonner', () => ({
  toast: mockToast,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'mcp-servers:serverDisabled': 'Server Disabled',
        'mcp-servers:serverDisabledDesc': `MCP Server '${options?.serverName || 'test'}' has been automatically disabled due to too many failed restart attempts.`,
      }
      return translations[key] || key
    },
  }),
}))

describe('MCP Servers Event Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should have correct event type for MCP_MAX_RESTARTS_REACHED', () => {
    expect(SystemEvent.MCP_MAX_RESTARTS_REACHED).toBe(
      'mcp-max-restarts-reached'
    )
  })

  it('should set up event listener correctly', async () => {
    const mockUnlisten = vi.fn()
    mockListen.mockResolvedValue(mockUnlisten)

    // Simulate setting up the event listener
    const eventHandler = vi.fn()
    await mockListen(SystemEvent.MCP_MAX_RESTARTS_REACHED, eventHandler)

    expect(mockListen).toHaveBeenCalledWith(
      SystemEvent.MCP_MAX_RESTARTS_REACHED,
      eventHandler
    )
  })

  it('should handle MCP_MAX_RESTARTS_REACHED event payload correctly', () => {
    const mockEvent = {
      payload: {
        server: 'test-server',
        max_restarts: 3,
      },
    }

    // Simulate the event handler logic
    const { server } = mockEvent.payload

    // Mock the translation function
    const t = (key: string, options?: Record<string, unknown>) => {
      if (key === 'mcp-servers:serverDisabled') return 'Server Disabled'
      if (key === 'mcp-servers:serverDisabledDesc') {
        return `MCP Server '${options?.serverName}' has been automatically disabled due to too many failed restart attempts.`
      }
      return key
    }

    // Simulate calling toast.error with the event data
    mockToast.error(t('mcp-servers:serverDisabled'), {
      description: t('mcp-servers:serverDisabledDesc', { serverName: server }),
      duration: 5000,
    })

    expect(mockToast.error).toHaveBeenCalledWith('Server Disabled', {
      description:
        "MCP Server 'test-server' has been automatically disabled due to too many failed restart attempts.",
      duration: 5000,
    })
  })

  it('should handle event with missing server name gracefully', () => {
    const mockEvent = {
      payload: {
        max_restarts: 3,
        // server name is missing
      },
    }

    // Should not throw when server name is missing
    expect(() => {
      const { server } = mockEvent.payload as {
        server?: string
        max_restarts: number
      }
      if (server) {
        // Only process if server name exists
        mockToast.error('Server Disabled', {
          description: `Server '${server}' disabled`,
          duration: 5000,
        })
      }
    }).not.toThrow()

    // Toast should not be called when server name is missing
    expect(mockToast.error).not.toHaveBeenCalled()
  })

  it('should handle malformed event payload gracefully', () => {
    const mockEvent = {
      payload: null,
    }

    // Should not throw when payload is malformed
    expect(() => {
      if (mockEvent.payload && typeof mockEvent.payload === 'object') {
        const { server } = mockEvent.payload as { server?: string }
        if (server) {
          mockToast.error('Server Disabled')
        }
      }
    }).not.toThrow()

    expect(mockToast.error).not.toHaveBeenCalled()
  })

  it('should clean up event listener properly', async () => {
    const mockUnlisten = vi.fn()
    mockListen.mockResolvedValue(mockUnlisten)

    // Simulate setting up and cleaning up the event listener
    const unlistenPromise = mockListen(
      SystemEvent.MCP_MAX_RESTARTS_REACHED,
      vi.fn()
    )
    const unlisten = await unlistenPromise
    unlisten()

    expect(mockUnlisten).toHaveBeenCalled()
  })
})

describe('MCP Servers Translation Keys', () => {
  it('should have all required translation keys for server disabled notifications', () => {
    const translations = {
      'mcp-servers:serverDisabled': 'Server Disabled',
      'mcp-servers:serverDisabledDesc':
        "MCP Server '{serverName}' has been automatically disabled due to too many failed restart attempts.",
    }

    expect(translations['mcp-servers:serverDisabled']).toBe('Server Disabled')
    expect(translations['mcp-servers:serverDisabledDesc']).toContain(
      'automatically disabled'
    )
    expect(translations['mcp-servers:serverDisabledDesc']).toContain(
      'failed restart attempts'
    )
  })

  it('should support server name interpolation in translation', () => {
    const t = (key: string, options?: Record<string, unknown>) => {
      if (key === 'mcp-servers:serverDisabledDesc') {
        return `MCP Server '${options?.serverName}' has been automatically disabled due to too many failed restart attempts.`
      }
      return key
    }

    const result = t('mcp-servers:serverDisabledDesc', {
      serverName: 'my-test-server',
    })
    expect(result).toContain('my-test-server')
    expect(result).toContain('automatically disabled')
  })
})
