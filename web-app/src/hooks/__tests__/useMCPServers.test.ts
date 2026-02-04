import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMCPServers, DEFAULT_MCP_SETTINGS } from '../useMCPServers'
import type { MCPServerConfig } from '../useMCPServers'

// Mock the ServiceHub
const mockUpdateMCPConfig = vi.fn().mockResolvedValue(undefined)
const mockRestartMCPServers = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    mcp: () => ({
      updateMCPConfig: mockUpdateMCPConfig,
      restartMCPServers: mockRestartMCPServers,
    }),
  }),
}))

describe('useMCPServers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to defaults
    useMCPServers.setState({
      open: true,
      mcpServers: {},
      settings: { ...DEFAULT_MCP_SETTINGS },
      loading: false,
      deletedServerKeys: [],
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useMCPServers())

    expect(result.current.open).toBe(true)
    expect(result.current.mcpServers).toEqual({})
    expect(result.current.settings).toEqual(DEFAULT_MCP_SETTINGS)
    expect(result.current.loading).toBe(false)
    expect(result.current.deletedServerKeys).toEqual([])
    expect(typeof result.current.getServerConfig).toBe('function')
    expect(typeof result.current.setLeftPanel).toBe('function')
    expect(typeof result.current.addServer).toBe('function')
    expect(typeof result.current.editServer).toBe('function')
    expect(typeof result.current.deleteServer).toBe('function')
    expect(typeof result.current.setServers).toBe('function')
    expect(typeof result.current.setSettings).toBe('function')
    expect(typeof result.current.updateSettings).toBe('function')
    expect(typeof result.current.syncServers).toBe('function')
    expect(typeof result.current.syncServersAndRestart).toBe('function')
  })

  describe('setLeftPanel', () => {
    it('should set left panel open state', () => {
      const { result } = renderHook(() => useMCPServers())

      act(() => {
        result.current.setLeftPanel(false)
      })

      expect(result.current.open).toBe(false)

      act(() => {
        result.current.setLeftPanel(true)
      })

      expect(result.current.open).toBe(true)
    })
  })

  describe('getServerConfig', () => {
    it('should return server config if exists', () => {
      const { result } = renderHook(() => useMCPServers())
      
      const serverConfig: MCPServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'production' },
        active: true,
      }

      act(() => {
        result.current.addServer('test-server', serverConfig)
      })

      const config = result.current.getServerConfig('test-server')
      expect(config).toEqual(serverConfig)
    })

    it('should return undefined if server does not exist', () => {
      const { result } = renderHook(() => useMCPServers())

      const config = result.current.getServerConfig('nonexistent-server')
      expect(config).toBeUndefined()
    })
  })

  describe('addServer', () => {
    it('should add a new server', () => {
      const { result } = renderHook(() => useMCPServers())
      
      const serverConfig: MCPServerConfig = {
        command: 'python',
        args: ['main.py', '--port', '8080'],
        env: { PYTHONPATH: '/app' },
        active: true,
      }

      act(() => {
        result.current.addServer('python-server', serverConfig)
      })

      expect(result.current.mcpServers).toEqual({
        'python-server': serverConfig,
      })
    })

    it('should update existing server with same key', () => {
      const { result } = renderHook(() => useMCPServers())
      
      const initialConfig: MCPServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: {},
        active: false,
      }

      const updatedConfig: MCPServerConfig = {
        command: 'node',
        args: ['server.js', '--production'],
        env: { NODE_ENV: 'production' },
        active: true,
      }

      act(() => {
        result.current.addServer('node-server', initialConfig)
      })

      expect(result.current.mcpServers['node-server']).toEqual(initialConfig)

      act(() => {
        result.current.addServer('node-server', updatedConfig)
      })

      expect(result.current.mcpServers['node-server']).toEqual(updatedConfig)
    })

    it('should add multiple servers', () => {
      const { result } = renderHook(() => useMCPServers())
      
      const serverA: MCPServerConfig = {
        command: 'node',
        args: ['serverA.js'],
        env: {},
      }

      const serverB: MCPServerConfig = {
        command: 'python',
        args: ['serverB.py'],
        env: { PYTHONPATH: '/app' },
      }

      act(() => {
        result.current.addServer('server-a', serverA)
        result.current.addServer('server-b', serverB)
      })

      expect(result.current.mcpServers).toEqual({
        'server-a': serverA,
        'server-b': serverB,
      })
    })
  })

  describe('editServer', () => {
    it('should edit existing server', () => {
      const { result } = renderHook(() => useMCPServers())

      const initialConfig: MCPServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: {},
        active: false,
      }

      const updatedConfig: MCPServerConfig = {
        command: 'node',
        args: ['server.js', '--debug'],
        env: { DEBUG: 'true' },
        active: true,
      }

      act(() => {
        result.current.addServer('test-server', initialConfig)
      })

      act(() => {
        result.current.editServer('test-server', updatedConfig)
      })

      expect(result.current.mcpServers['test-server']).toEqual(updatedConfig)
    })

    it('should preserve untouched properties when editing server with complete config', () => {
      const { result } = renderHook(() => useMCPServers())

      // Create a server with multiple properties including official, type, timeout, headers
      const initialServerConfig: MCPServerConfig = {
        command: 'npx',
        args: ['-y', 'search-mcp-server@latest'],
        env: {
          BRIDGE_HOST: '127.0.0.1',
          BRIDGE_PORT: '17389',
          API_KEY: 'secret-key',
        },
        type: 'stdio',
        official: true,
        timeout: 30,
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      }

      // Updated config that changes some properties but preserves others
      // This simulates what the UI component does after our fix
      const updatedConfig: MCPServerConfig = {
        ...initialServerConfig, // Preserve all existing properties
        command: 'node', // Change command
        args: ['updated-server.js'], // Change args
        env: {
          BRIDGE_HOST: '127.0.0.1',
          BRIDGE_PORT: '18000', // Changed port
        },
        // official, type, timeout, headers are preserved via spread
      }

      act(() => {
        result.current.addServer('test-server', initialServerConfig)
      })

      // Verify initial state
      expect(result.current.mcpServers['test-server']?.official).toBe(true)
      expect(result.current.mcpServers['test-server']?.type).toBe('stdio')
      expect(result.current.mcpServers['test-server']?.timeout).toBe(30)
      expect(result.current.mcpServers['test-server']?.headers).toEqual({
        'X-Custom-Header': 'custom-value',
      })

      act(() => {
        result.current.editServer('test-server', updatedConfig)
      })

      // Verify that modified fields changed
      const editedServer = result.current.mcpServers['test-server']
      expect(editedServer?.command).toBe('node')
      expect(editedServer?.args).toEqual(['updated-server.js'])
      expect(editedServer?.env).toEqual({
        BRIDGE_HOST: '127.0.0.1',
        BRIDGE_PORT: '18000',
      })

      // Verify that untouched properties ARE preserved (except active which can have side effects)
      expect(editedServer?.official).toBe(true)
      expect(editedServer?.type).toBe('stdio')
      expect(editedServer?.timeout).toBe(30)
      expect(editedServer?.headers).toEqual({
        'X-Custom-Header': 'custom-value',
      })
    })

    it('should not modify state if server does not exist', () => {
      const { result } = renderHook(() => useMCPServers())

      const initialState = result.current.mcpServers

      const config: MCPServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: {},
      }

      act(() => {
        result.current.editServer('nonexistent-server', config)
      })

      expect(result.current.mcpServers).toEqual(initialState)
    })
  })

  describe('setServers', () => {
    it('should merge servers with existing ones', () => {
      const { result } = renderHook(() => useMCPServers())
      
      const existingServer: MCPServerConfig = {
        command: 'node',
        args: ['existing.js'],
        env: {},
      }

      const newServers = {
        'new-server-1': {
          command: 'python',
          args: ['new1.py'],
          env: { PYTHONPATH: '/app1' },
        },
        'new-server-2': {
          command: 'python',
          args: ['new2.py'],
          env: { PYTHONPATH: '/app2' },
        },
      }

      act(() => {
        result.current.addServer('existing-server', existingServer)
      })

      act(() => {
        result.current.setServers(newServers)
      })

      expect(result.current.mcpServers).toEqual({
        'existing-server': existingServer,
        ...newServers,
      })
    })

    it('should overwrite existing servers with same keys', () => {
      const { result } = renderHook(() => useMCPServers())
      
      const originalServer: MCPServerConfig = {
        command: 'node',
        args: ['original.js'],
        env: {},
      }

      const updatedServer: MCPServerConfig = {
        command: 'node',
        args: ['updated.js'],
        env: { NODE_ENV: 'production' },
      }

      act(() => {
        result.current.addServer('test-server', originalServer)
      })

      act(() => {
        result.current.setServers({ 'test-server': updatedServer })
      })

      expect(result.current.mcpServers['test-server']).toEqual(updatedServer)
    })
  })

  describe('deleteServer', () => {
    it('should delete existing server', () => {
      const { result } = renderHook(() => useMCPServers())
      
      const serverConfig: MCPServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: {},
      }

      act(() => {
        result.current.addServer('test-server', serverConfig)
      })

      expect(result.current.mcpServers['test-server']).toEqual(serverConfig)

      act(() => {
        result.current.deleteServer('test-server')
      })

      expect(result.current.mcpServers['test-server']).toBeUndefined()
      expect(result.current.deletedServerKeys).toContain('test-server')
    })

    it('should add server key to deletedServerKeys even if server does not exist', () => {
      const { result } = renderHook(() => useMCPServers())

      act(() => {
        result.current.deleteServer('nonexistent-server')
      })

      expect(result.current.deletedServerKeys).toContain('nonexistent-server')
    })

    it('should handle multiple deletions', () => {
      const { result } = renderHook(() => useMCPServers())
      
      const serverA: MCPServerConfig = {
        command: 'node',
        args: ['serverA.js'],
        env: {},
      }

      const serverB: MCPServerConfig = {
        command: 'python',
        args: ['serverB.py'],
        env: {},
      }

      act(() => {
        result.current.addServer('server-a', serverA)
        result.current.addServer('server-b', serverB)
      })

      act(() => {
        result.current.deleteServer('server-a')
        result.current.deleteServer('server-b')
      })

      expect(result.current.mcpServers).toEqual({})
      expect(result.current.deletedServerKeys).toEqual(['server-a', 'server-b'])
    })
  })

  describe('setSettings', () => {
    it('should replace runtime settings', () => {
      const { result } = renderHook(() => useMCPServers())

      const newSettings = {
        ...DEFAULT_MCP_SETTINGS,
        toolCallTimeoutSeconds: 45,
      }

      act(() => {
        result.current.setSettings(newSettings)
      })

      expect(result.current.settings).toEqual(newSettings)
      expect(result.current.settings).not.toBe(DEFAULT_MCP_SETTINGS)
    })
  })

  describe('updateSettings', () => {
    it('should merge runtime settings', () => {
      const { result } = renderHook(() => useMCPServers())

      act(() => {
        result.current.updateSettings({ toolCallTimeoutSeconds: 45 })
      })

      expect(result.current.settings.toolCallTimeoutSeconds).toBe(45)
    })
  })

  describe('syncServers', () => {
    it('should call updateMCPConfig with current servers', async () => {
      const { result } = renderHook(() => useMCPServers())
      
      const serverConfig: MCPServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'production' },
      }

      act(() => {
        result.current.addServer('test-server', serverConfig)
      })

      await act(async () => {
        await result.current.syncServers()
      })

      expect(mockUpdateMCPConfig).toHaveBeenCalledWith(
        JSON.stringify({
          mcpServers: {
            'test-server': serverConfig,
          },
          mcpSettings: result.current.settings,
        })
      )
    })

    it('should call updateMCPConfig with empty servers object', async () => {
      const { result } = renderHook(() => useMCPServers())

      await act(async () => {
        await result.current.syncServers()
      })

      expect(mockUpdateMCPConfig).toHaveBeenCalledWith(
        JSON.stringify({
          mcpServers: {},
          mcpSettings: result.current.settings,
        })
      )
    })
  })

  describe('syncServersAndRestart', () => {
    it('should call updateMCPConfig and then mockRestartMCPServers', async () => {
      const { result } = renderHook(() => useMCPServers())
      
      const serverConfig: MCPServerConfig = {
        command: 'python',
        args: ['server.py'],
        env: { PYTHONPATH: '/app' },
      }

      act(() => {
        result.current.addServer('python-server', serverConfig)
      })

      await act(async () => {
        await result.current.syncServersAndRestart()
      })

      expect(mockUpdateMCPConfig).toHaveBeenCalledWith(
        JSON.stringify({
          mcpServers: {
            'python-server': serverConfig,
          },
          mcpSettings: result.current.settings,
        })
      )
      expect(mockRestartMCPServers).toHaveBeenCalled()
    })
  })

  describe('state management', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useMCPServers())
      const { result: result2 } = renderHook(() => useMCPServers())

      const serverConfig: MCPServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: {},
      }

      act(() => {
        result1.current.addServer('shared-server', serverConfig)
      })

      expect(result2.current.mcpServers['shared-server']).toEqual(serverConfig)
    })
  })

  describe('complex scenarios', () => {
    it('should handle complete server lifecycle', () => {
      const { result } = renderHook(() => useMCPServers())
      
      const initialConfig: MCPServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: {},
        active: false,
      }

      const updatedConfig: MCPServerConfig = {
        command: 'node',
        args: ['server.js', '--production'],
        env: { NODE_ENV: 'production' },
        active: true,
      }

      // Add server
      act(() => {
        result.current.addServer('lifecycle-server', initialConfig)
      })

      expect(result.current.mcpServers['lifecycle-server']).toEqual(initialConfig)

      // Edit server
      act(() => {
        result.current.editServer('lifecycle-server', updatedConfig)
      })

      expect(result.current.mcpServers['lifecycle-server']).toEqual(updatedConfig)

      // Delete server
      act(() => {
        result.current.deleteServer('lifecycle-server')
      })

      expect(result.current.mcpServers['lifecycle-server']).toBeUndefined()
      expect(result.current.deletedServerKeys).toContain('lifecycle-server')
    })
  })
<<<<<<< HEAD

  describe('Proactive Mode Settings', () => {
    it('should have proactiveMode in default settings', () => {
      expect(DEFAULT_MCP_SETTINGS.proactiveMode).toBeDefined()
      expect(DEFAULT_MCP_SETTINGS.proactiveMode).toBe(false)
    })

    it('should initialize proactiveMode as false', () => {
      const { result } = renderHook(() => useMCPServers())

      expect(result.current.settings.proactiveMode).toBe(false)
    })

    it('should update proactiveMode using updateSettings', () => {
      const { result } = renderHook(() => useMCPServers())

      act(() => {
        result.current.updateSettings({ proactiveMode: true })
      })

      expect(result.current.settings.proactiveMode).toBe(true)
    })

    it('should toggle proactiveMode on and off', () => {
      const { result } = renderHook(() => useMCPServers())

      // Initially false
      expect(result.current.settings.proactiveMode).toBe(false)

      // Toggle to true
      act(() => {
        result.current.updateSettings({ proactiveMode: true })
      })

      expect(result.current.settings.proactiveMode).toBe(true)

      // Toggle back to false
      act(() => {
        result.current.updateSettings({ proactiveMode: false })
      })

      expect(result.current.settings.proactiveMode).toBe(false)
    })

    it('should not affect other settings when updating proactiveMode', () => {
      const { result } = renderHook(() => useMCPServers())

      const originalSettings = { ...result.current.settings }

      act(() => {
        result.current.updateSettings({ proactiveMode: true })
      })

      expect(result.current.settings.toolCallTimeoutSeconds).toBe(
        originalSettings.toolCallTimeoutSeconds
      )
      expect(result.current.settings.baseRestartDelayMs).toBe(
        originalSettings.baseRestartDelayMs
      )
      expect(result.current.settings.maxRestartDelayMs).toBe(
        originalSettings.maxRestartDelayMs
      )
      expect(result.current.settings.backoffMultiplier).toBe(
        originalSettings.backoffMultiplier
      )
    })

    it('should update proactiveMode along with other settings', () => {
      const { result } = renderHook(() => useMCPServers())

      act(() => {
        result.current.updateSettings({
          proactiveMode: true,
          toolCallTimeoutSeconds: 60,
        })
      })

      expect(result.current.settings.proactiveMode).toBe(true)
      expect(result.current.settings.toolCallTimeoutSeconds).toBe(60)
    })

    it('should call syncServers with proactiveMode included in settings', async () => {
      const { result } = renderHook(() => useMCPServers())

      act(() => {
        result.current.updateSettings({ proactiveMode: true })
      })

      await act(async () => {
        await result.current.syncServers()
      })

      expect(mockUpdateMCPConfig).toHaveBeenCalledWith(
        expect.stringContaining('proactiveMode')
      )
    })

    it('should persist proactiveMode setting through setSettings', () => {
      const { result } = renderHook(() => useMCPServers())

      const newSettings = {
        ...DEFAULT_MCP_SETTINGS,
        proactiveMode: true,
        toolCallTimeoutSeconds: 45,
      }

      act(() => {
        result.current.setSettings(newSettings)
      })

      expect(result.current.settings.proactiveMode).toBe(true)
      expect(result.current.settings.toolCallTimeoutSeconds).toBe(45)
    })
  })
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
})
