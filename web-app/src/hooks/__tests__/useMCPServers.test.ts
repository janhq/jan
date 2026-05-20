import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMCPServers, DEFAULT_MCP_SETTINGS } from '../useMCPServers'
import type { MCPServerConfig } from '../useMCPServers'

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

const makeConfig = (overrides: Partial<MCPServerConfig> = {}): MCPServerConfig => ({
  command: 'node',
  args: ['server.js'],
  env: {},
  ...overrides,
})

describe('useMCPServers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMCPServers.setState({
      open: true, mcpServers: {}, settings: { ...DEFAULT_MCP_SETTINGS },
      loading: false, deletedServerKeys: [],
    })
  })

  it('should initialize with default values and all functions', () => {
    const { result } = renderHook(() => useMCPServers())
    expect(result.current.open).toBe(true)
    expect(result.current.mcpServers).toEqual({})
    expect(result.current.settings).toEqual(DEFAULT_MCP_SETTINGS)
    expect(result.current.loading).toBe(false)
    expect(result.current.deletedServerKeys).toEqual([])
    const fns = ['getServerConfig', 'setLeftPanel', 'addServer', 'editServer',
      'deleteServer', 'setServers', 'setSettings', 'updateSettings', 'syncServers', 'syncServersAndRestart']
    fns.forEach((fn) => expect(typeof (result.current as any)[fn]).toBe('function'))
  })

  describe('setLeftPanel', () => {
    it('should toggle open state', () => {
      const { result } = renderHook(() => useMCPServers())
      act(() => { result.current.setLeftPanel(false) })
      expect(result.current.open).toBe(false)
      act(() => { result.current.setLeftPanel(true) })
      expect(result.current.open).toBe(true)
    })
  })

  describe('getServerConfig', () => {
    it('should return config if exists, undefined otherwise', () => {
      const { result } = renderHook(() => useMCPServers())
      const config = makeConfig({ active: true })
      act(() => { result.current.addServer('test', config) })
      expect(result.current.getServerConfig('test')).toEqual(config)
      expect(result.current.getServerConfig('nonexistent')).toBeUndefined()
    })
  })

  describe('addServer', () => {
    it('should add, update, and handle multiple servers', () => {
      const { result } = renderHook(() => useMCPServers())

      const configA = makeConfig({ command: 'node', args: ['a.js'] })
      const configB = makeConfig({ command: 'python', args: ['b.py'] })
      const updatedA = makeConfig({ command: 'node', args: ['a.js', '--prod'], active: true })

      act(() => {
        result.current.addServer('a', configA)
        result.current.addServer('b', configB)
      })
      expect(result.current.mcpServers).toEqual({ a: configA, b: configB })

      act(() => { result.current.addServer('a', updatedA) })
      expect(result.current.mcpServers['a']).toEqual(updatedA)
    })
  })

  describe('editServer', () => {
    it('should edit existing server and preserve untouched properties', () => {
      const { result } = renderHook(() => useMCPServers())

      const initial: MCPServerConfig = {
        command: 'npx', args: ['-y', 'mcp'], env: { KEY: 'val' },
        type: 'stdio', official: true, timeout: 30,
        headers: { 'X-Custom': 'value' },
      }

      act(() => { result.current.addServer('srv', initial) })

      const updated = { ...initial, command: 'node', args: ['updated.js'] }
      act(() => { result.current.editServer('srv', updated) })

      const edited = result.current.mcpServers['srv']
      expect(edited?.command).toBe('node')
      expect(edited?.official).toBe(true)
      expect(edited?.timeout).toBe(30)
      expect(edited?.headers).toEqual({ 'X-Custom': 'value' })
    })

    it('should not modify state if server does not exist', () => {
      const { result } = renderHook(() => useMCPServers())
      const before = result.current.mcpServers
      act(() => { result.current.editServer('nonexistent', makeConfig()) })
      expect(result.current.mcpServers).toEqual(before)
    })
  })

  describe('setServers', () => {
    it('should merge and overwrite servers', () => {
      const { result } = renderHook(() => useMCPServers())
      const existing = makeConfig({ args: ['existing.js'] })
      const newSrv = makeConfig({ command: 'python', args: ['new.py'] })

      act(() => { result.current.addServer('existing', existing) })
      act(() => { result.current.setServers({ 'new-srv': newSrv }) })
      expect(result.current.mcpServers['existing']).toEqual(existing)
      expect(result.current.mcpServers['new-srv']).toEqual(newSrv)

      const overwrite = makeConfig({ args: ['updated.js'] })
      act(() => { result.current.setServers({ existing: overwrite }) })
      expect(result.current.mcpServers['existing']).toEqual(overwrite)
    })
  })

  describe('deleteServer', () => {
    it('should delete servers and track keys', () => {
      const { result } = renderHook(() => useMCPServers())

      act(() => {
        result.current.addServer('a', makeConfig())
        result.current.addServer('b', makeConfig())
      })

      act(() => {
        result.current.deleteServer('a')
        result.current.deleteServer('b')
      })

      expect(result.current.mcpServers).toEqual({})
      expect(result.current.deletedServerKeys).toEqual(['a', 'b'])
    })

    it('should track key even if server does not exist', () => {
      const { result } = renderHook(() => useMCPServers())
      act(() => { result.current.deleteServer('ghost') })
      expect(result.current.deletedServerKeys).toContain('ghost')
    })
  })

  describe('settings', () => {
    it('setSettings replaces, updateSettings merges', () => {
      const { result } = renderHook(() => useMCPServers())

      const newSettings = { ...DEFAULT_MCP_SETTINGS, toolCallTimeoutSeconds: 45 }
      act(() => { result.current.setSettings(newSettings) })
      expect(result.current.settings).toEqual(newSettings)

      act(() => { result.current.updateSettings({ toolCallTimeoutSeconds: 60 }) })
      expect(result.current.settings.toolCallTimeoutSeconds).toBe(60)
    })
  })

  describe('syncServers', () => {
    it('should call updateMCPConfig', async () => {
      const { result } = renderHook(() => useMCPServers())
      const config = makeConfig()
      act(() => { result.current.addServer('test', config) })
      await act(async () => { await result.current.syncServers() })
      expect(mockUpdateMCPConfig).toHaveBeenCalledWith(
        JSON.stringify({ mcpServers: { test: config }, mcpSettings: result.current.settings })
      )
    })
  })

  describe('syncServersAndRestart', () => {
    it('should sync and restart', async () => {
      const { result } = renderHook(() => useMCPServers())
      act(() => { result.current.addServer('srv', makeConfig()) })
      await act(async () => { await result.current.syncServersAndRestart() })
      expect(mockUpdateMCPConfig).toHaveBeenCalled()
      expect(mockRestartMCPServers).toHaveBeenCalled()
    })
  })

  describe('state management', () => {
    it('should maintain state across hook instances', () => {
      const { result: r1 } = renderHook(() => useMCPServers())
      const { result: r2 } = renderHook(() => useMCPServers())
      act(() => { r1.current.addServer('shared', makeConfig()) })
      expect(r2.current.mcpServers['shared']).toBeDefined()
    })
  })

  describe('complete server lifecycle', () => {
    it('should add, edit, then delete', () => {
      const { result } = renderHook(() => useMCPServers())
      const initial = makeConfig({ active: false })
      const updated = makeConfig({ args: ['server.js', '--prod'], active: true })

      act(() => { result.current.addServer('lifecycle', initial) })
      expect(result.current.mcpServers['lifecycle']).toEqual(initial)

      act(() => { result.current.editServer('lifecycle', updated) })
      expect(result.current.mcpServers['lifecycle']).toEqual(updated)

      act(() => { result.current.deleteServer('lifecycle') })
      expect(result.current.mcpServers['lifecycle']).toBeUndefined()
      expect(result.current.deletedServerKeys).toContain('lifecycle')
    })
  })
})
