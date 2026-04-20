import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriMCPService } from '../tauri'
import { DEFAULT_MCP_SETTINGS } from '@/hooks/useMCPServers'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const mockCore = {
  api: {
    saveMcpConfigs: vi.fn(),
    restartMcpServers: vi.fn(),
    getMcpConfigs: vi.fn(),
    getTools: vi.fn(),
    getConnectedServers: vi.fn(),
    callTool: vi.fn(),
    cancelToolCall: vi.fn(),
  },
}

Object.defineProperty(globalThis, 'window', {
  value: { core: mockCore },
  writable: true,
})

describe('TauriMCPService – coverage', () => {
  let svc: TauriMCPService

  beforeEach(() => {
    svc = new TauriMCPService()
    vi.clearAllMocks()
  })

  describe('callToolWithCancellation', () => {
    it('returns promise, cancel fn, and token', () => {
      const mockResult = { error: '', content: [{ text: 'ok' }] }
      mockCore.api.callTool.mockResolvedValue(mockResult)
      mockCore.api.cancelToolCall.mockResolvedValue(undefined)

      const result = svc.callToolWithCancellation({
        toolName: 'test_tool',
        arguments: { foo: 'bar' },
      })

      expect(result.token).toBeDefined()
      expect(typeof result.cancel).toBe('function')
      expect(result.promise).toBeDefined()
    })

    it('uses provided cancellationToken', () => {
      mockCore.api.callTool.mockResolvedValue({ error: '', content: [] })

      const result = svc.callToolWithCancellation({
        toolName: 'test_tool',
        arguments: {},
        cancellationToken: 'my-token',
      })

      expect(result.token).toBe('my-token')
      expect(mockCore.api.callTool).toHaveBeenCalledWith(
        expect.objectContaining({ cancellationToken: 'my-token' })
      )
    })

    it('cancel calls cancelToolCall with correct token', async () => {
      mockCore.api.callTool.mockResolvedValue({ error: '', content: [] })
      mockCore.api.cancelToolCall.mockResolvedValue(undefined)

      const { cancel, token } = svc.callToolWithCancellation({
        toolName: 'test_tool',
        arguments: {},
      })

      await cancel()

      expect(mockCore.api.cancelToolCall).toHaveBeenCalledWith({
        cancellationToken: token,
      })
    })
  })

  describe('cancelToolCall', () => {
    it('calls cancelToolCall on window.core.api', async () => {
      mockCore.api.cancelToolCall.mockResolvedValue(undefined)

      await svc.cancelToolCall('token-123')

      expect(mockCore.api.cancelToolCall).toHaveBeenCalledWith({
        cancellationToken: 'token-123',
      })
    })
  })

  describe('activateMCPServer', () => {
    it('invokes activate_mcp_server with name and config', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)

      const config = { command: 'node', args: ['server.js'] }
      await svc.activateMCPServer('myServer', config as any)

      expect(invoke).toHaveBeenCalledWith('activate_mcp_server', {
        name: 'myServer',
        config,
      })
    })
  })

  describe('deactivateMCPServer', () => {
    it('invokes deactivate_mcp_server with name', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)

      await svc.deactivateMCPServer('myServer')

      expect(invoke).toHaveBeenCalledWith('deactivate_mcp_server', {
        name: 'myServer',
      })
    })
  })

  describe('checkJanBrowserExtensionConnected', () => {
    it('invokes check_jan_browser_extension_connected', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(true)

      const result = await svc.checkJanBrowserExtensionConnected()

      expect(invoke).toHaveBeenCalledWith('check_jan_browser_extension_connected')
      expect(result).toBe(true)
    })
  })

  describe('getMCPConfig – additional branches', () => {
    it('handles config with mcpServers and mcpSettings keys', async () => {
      const config = {
        mcpServers: { fs: { command: 'fs-server' } },
        mcpSettings: { maxToolRoundtrips: 5 },
      }
      mockCore.api.getMcpConfigs.mockResolvedValue(JSON.stringify(config))

      const result = await svc.getMCPConfig()

      expect(result.mcpServers).toEqual({ fs: { command: 'fs-server' } })
      expect(result.mcpSettings).toEqual({
        ...DEFAULT_MCP_SETTINGS,
        maxToolRoundtrips: 5,
      })
    })

    it('handles whitespace-only config string', async () => {
      mockCore.api.getMcpConfigs.mockResolvedValue('   ')

      const result = await svc.getMCPConfig()

      expect(result).toEqual({
        mcpServers: {},
        mcpSettings: { ...DEFAULT_MCP_SETTINGS },
      })
    })

    it('handles config with no mcpServers key (legacy format)', async () => {
      const legacy = { myServer: { command: 'node', args: ['s.js'] } }
      mockCore.api.getMcpConfigs.mockResolvedValue(JSON.stringify(legacy))

      const result = await svc.getMCPConfig()

      expect(result.mcpServers).toEqual(legacy)
    })

    it('handles config where mcpServers is not an object', async () => {
      const config = { mcpServers: 'invalid', legacyServer: { command: 'x' } }
      mockCore.api.getMcpConfigs.mockResolvedValue(JSON.stringify(config))

      const result = await svc.getMCPConfig()

      expect(result.mcpServers).toEqual({ legacyServer: { command: 'x' } })
    })

    it('handles config where mcpSettings is not an object', async () => {
      const config = { mcpServers: {}, mcpSettings: 'invalid' }
      mockCore.api.getMcpConfigs.mockResolvedValue(JSON.stringify(config))

      const result = await svc.getMCPConfig()

      expect(result.mcpSettings).toEqual({ ...DEFAULT_MCP_SETTINGS })
    })

    it('returns empty servers when no legacy and mcpServers is null', async () => {
      const config = { mcpServers: null }
      mockCore.api.getMcpConfigs.mockResolvedValue(JSON.stringify(config))

      const result = await svc.getMCPConfig()

      expect(result.mcpServers).toEqual({})
    })
  })
})
