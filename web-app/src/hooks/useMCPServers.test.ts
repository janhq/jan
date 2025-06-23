import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

// Import after mocking
import { useMCPServers, MCPServerConfig } from './useMCPServers'

describe('useMCPServers', () => {
  beforeEach(() => {
    // Reset the store state before each test
    const { result } = renderHook(() => useMCPServers())
    act(() => {
      // Clear all servers
      Object.keys(result.current.mcpServers).forEach(key => {
        result.current.deleteServer(key)
      })
    })
  })

  it('should initialize with empty servers', () => {
    const { result } = renderHook(() => useMCPServers())
    expect(result.current.mcpServers).toEqual({})
  })

  it('should add a server', () => {
    const { result } = renderHook(() => useMCPServers())
    const serverName = 'test-server'
    const config: MCPServerConfig = {
      command: 'npx',
      args: ['test-mcp-server'],
      env: {},
      active: true
    }

    act(() => {
      result.current.addServer(serverName, config)
    })

    expect(result.current.mcpServers[serverName]).toEqual(config)
  })

  it('should edit a server', () => {
    const { result } = renderHook(() => useMCPServers())
    const serverName = 'test-server'
    const initialConfig: MCPServerConfig = {
      command: 'npx',
      args: ['test-mcp-server'],
      env: {},
      active: true
    }

    const updatedConfig: MCPServerConfig = {
      command: 'uvx',
      args: ['updated-mcp-server'],
      env: { TEST: 'value' },
      active: false
    }

    act(() => {
      result.current.addServer(serverName, initialConfig)
      result.current.editServer(serverName, updatedConfig)
    })

    expect(result.current.mcpServers[serverName]).toEqual(updatedConfig)
  })

  it('should delete a server', () => {
    const { result } = renderHook(() => useMCPServers())
    const serverName = 'test-server'
    const config: MCPServerConfig = {
      command: 'npx',
      args: ['test-mcp-server'],
      env: {},
      active: true
    }

    act(() => {
      result.current.addServer(serverName, config)
    })
    expect(result.current.mcpServers[serverName]).toBeDefined()

    act(() => {
      result.current.deleteServer(serverName)
    })
    expect(result.current.mcpServers[serverName]).toBeUndefined()
  })

  it('should deactivate a server', () => {
    const { result } = renderHook(() => useMCPServers())
    const serverName = 'test-server'
    const config: MCPServerConfig = {
      command: 'npx',
      args: ['test-mcp-server'],
      env: {},
      active: true
    }

    act(() => {
      result.current.addServer(serverName, config)
    })
    expect(result.current.mcpServers[serverName].active).toBe(true)

    act(() => {
      result.current.deactivateServer(serverName)
    })
    expect(result.current.mcpServers[serverName].active).toBe(false)
  })

  it('should handle deactivating non-existent server gracefully', () => {
    const { result } = renderHook(() => useMCPServers())
    
    expect(() => {
      act(() => {
        result.current.deactivateServer('non-existent-server')
      })
    }).not.toThrow()
  })

  it('should get server config', () => {
    const { result } = renderHook(() => useMCPServers())
    const serverName = 'test-server'
    const config: MCPServerConfig = {
      command: 'npx',
      args: ['test-mcp-server'],
      env: {},
      active: true
    }

    act(() => {
      result.current.addServer(serverName, config)
    })
    
    const retrievedConfig = result.current.getServerConfig(serverName)
    expect(retrievedConfig).toEqual(config)
  })

  it('should return undefined for non-existent server config', () => {
    const { result } = renderHook(() => useMCPServers())
    const retrievedConfig = result.current.getServerConfig('non-existent-server')
    expect(retrievedConfig).toBeUndefined()
  })

  it('should sync servers', () => {
    const { result } = renderHook(() => useMCPServers())
    const serverName = 'test-server'
    const config: MCPServerConfig = {
      command: 'npx',
      args: ['test-mcp-server'],
      env: {},
      active: true
    }

    act(() => {
      result.current.addServer(serverName, config)
    })
    
    // syncServers should not throw
    expect(() => {
      act(() => {
        result.current.syncServers()
      })
    }).not.toThrow()
  })

  it('should sync servers and restart', () => {
    const { result } = renderHook(() => useMCPServers())
    const serverName = 'test-server'
    const config: MCPServerConfig = {
      command: 'npx',
      args: ['test-mcp-server'],
      env: {},
      active: true
    }

    act(() => {
      result.current.addServer(serverName, config)
    })
    
    // syncServersAndRestart should not throw
    expect(() => {
      act(() => {
        result.current.syncServersAndRestart()
      })
    }).not.toThrow()
  })

  it('should handle multiple servers', () => {
    const { result } = renderHook(() => useMCPServers())
    const server1 = 'server-1'
    const server2 = 'server-2'
    const config1: MCPServerConfig = {
      command: 'npx',
      args: ['server-1'],
      env: {},
      active: true
    }
    const config2: MCPServerConfig = {
      command: 'uvx',
      args: ['server-2'],
      env: { ENV: 'test' },
      active: false
    }

    act(() => {
      result.current.addServer(server1, config1)
      result.current.addServer(server2, config2)
    })

    expect(Object.keys(result.current.mcpServers)).toHaveLength(2)
    expect(result.current.mcpServers[server1]).toEqual(config1)
    expect(result.current.mcpServers[server2]).toEqual(config2)

    act(() => {
      result.current.deleteServer(server1)
    })
    expect(Object.keys(result.current.mcpServers)).toHaveLength(1)
    expect(result.current.mcpServers[server2]).toEqual(config2)
  })
})