import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriMCPService } from '../mcp/tauri'
import { MCPTool } from '@/types/completion'

// Mock the global window.core.api
const mockCore = {
  api: {
    saveMcpConfigs: vi.fn(),
    restartMcpServers: vi.fn(),
    getMcpConfigs: vi.fn(),
    getTools: vi.fn(),
    getConnectedServers: vi.fn(),
    callTool: vi.fn(),
  },
}

// Set up global window mock
Object.defineProperty(global, 'window', {
  value: {
    core: mockCore,
  },
  writable: true,
})

describe('TauriMCPService', () => {
  let mcpService: TauriMCPService

  beforeEach(() => {
    mcpService = new TauriMCPService()
    vi.clearAllMocks()
  })

  describe('updateMCPConfig', () => {
    it('should call saveMcpConfigs with correct configs', async () => {
      const testConfig = '{"server1": {"path": "/path/to/server"}, "server2": {"command": "node server.js"}}'
      mockCore.api.saveMcpConfigs.mockResolvedValue(undefined)

      await mcpService.updateMCPConfig(testConfig)

      expect(mockCore.api.saveMcpConfigs).toHaveBeenCalledWith({
        configs: testConfig,
      })
    })

    it('should handle empty config string', async () => {
      const emptyConfig = ''
      mockCore.api.saveMcpConfigs.mockResolvedValue(undefined)

      await mcpService.updateMCPConfig(emptyConfig)

      expect(mockCore.api.saveMcpConfigs).toHaveBeenCalledWith({
        configs: emptyConfig,
      })
    })

    it('should handle API rejection', async () => {
      const testConfig = '{"server1": {}}'
      const mockError = new Error('Failed to save config')
      mockCore.api.saveMcpConfigs.mockRejectedValue(mockError)

      await expect(mcpService.updateMCPConfig(testConfig)).rejects.toThrow('Failed to save config')
      expect(mockCore.api.saveMcpConfigs).toHaveBeenCalledWith({
        configs: testConfig,
      })
    })

    it('should handle undefined window.core.api gracefully', async () => {
      // Temporarily set window.core to undefined
      const originalCore = window.core
      // @ts-ignore
      window.core = undefined

      const testConfig = '{"server1": {}}'

      await expect(mcpService.updateMCPConfig(testConfig)).resolves.toBeUndefined()

      // Restore original core
      window.core = originalCore
    })
  })

  describe('restartMCPServers', () => {
    it('should call restartMcpServers API', async () => {
      mockCore.api.restartMcpServers.mockResolvedValue(undefined)

      await mcpService.restartMCPServers()

      expect(mockCore.api.restartMcpServers).toHaveBeenCalledWith()
    })

    it('should handle API rejection', async () => {
      const mockError = new Error('Failed to restart servers')
      mockCore.api.restartMcpServers.mockRejectedValue(mockError)

      await expect(mcpService.restartMCPServers()).rejects.toThrow('Failed to restart servers')
      expect(mockCore.api.restartMcpServers).toHaveBeenCalledWith()
    })

    it('should handle undefined window.core.api gracefully', async () => {
      const originalCore = window.core
      // @ts-ignore
      window.core = undefined

      await expect(mcpService.restartMCPServers()).resolves.toBeUndefined()

      window.core = originalCore
    })
  })

  describe('getMCPConfig', () => {
    it('should get and parse MCP config correctly', async () => {
      const mockConfigString = '{"server1": {"path": "/path/to/server"}, "server2": {"command": "node server.js"}}'
      const expectedConfig = {
        server1: { path: '/path/to/server' },
        server2: { command: 'node server.js' },
      }

      mockCore.api.getMcpConfigs.mockResolvedValue(mockConfigString)

      const result = await mcpService.getMCPConfig()

      expect(mockCore.api.getMcpConfigs).toHaveBeenCalledWith()
      expect(result).toEqual(expectedConfig)
    })

    it('should return empty object when config is null', async () => {
      mockCore.api.getMcpConfigs.mockResolvedValue(null)

      const result = await mcpService.getMCPConfig()

      expect(result).toEqual({})
    })

    it('should return empty object when config is undefined', async () => {
      mockCore.api.getMcpConfigs.mockResolvedValue(undefined)

      const result = await mcpService.getMCPConfig()

      expect(result).toEqual({})
    })

    it('should return empty object when config is empty string', async () => {
      mockCore.api.getMcpConfigs.mockResolvedValue('')

      const result = await mcpService.getMCPConfig()

      expect(result).toEqual({})
    })

    it('should handle invalid JSON gracefully', async () => {
      const invalidJson = '{"invalid": json}'
      mockCore.api.getMcpConfigs.mockResolvedValue(invalidJson)

      await expect(mcpService.getMCPConfig()).rejects.toThrow()
    })

    it('should handle API rejection', async () => {
      const mockError = new Error('Failed to get config')
      mockCore.api.getMcpConfigs.mockRejectedValue(mockError)

      await expect(mcpService.getMCPConfig()).rejects.toThrow('Failed to get config')
    })
  })

  describe('getTools', () => {
    it('should return list of MCP tools', async () => {
      const mockTools: MCPTool[] = [
        {
          name: 'file_read',
          description: 'Read a file from the filesystem',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
        },
        {
          name: 'file_write',
          description: 'Write content to a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      ]

      mockCore.api.getTools.mockResolvedValue(mockTools)

      const result = await mcpService.getTools()

      expect(mockCore.api.getTools).toHaveBeenCalledWith()
      expect(result).toEqual(mockTools)
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('file_read')
      expect(result[1].name).toBe('file_write')
    })

    it('should return empty array when no tools available', async () => {
      mockCore.api.getTools.mockResolvedValue([])

      const result = await mcpService.getTools()

      expect(result).toEqual([])
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle API rejection', async () => {
      const mockError = new Error('Failed to get tools')
      mockCore.api.getTools.mockRejectedValue(mockError)

      await expect(mcpService.getTools()).rejects.toThrow('Failed to get tools')
    })

    it('should handle undefined window.core.api', async () => {
      const originalCore = window.core
      // @ts-ignore
      window.core = undefined

      const result = await mcpService.getTools()

      expect(result).toBeUndefined()

      window.core = originalCore
    })
  })

  describe('getConnectedServers', () => {
    it('should return list of connected server names', async () => {
      const mockServers = ['filesystem', 'database', 'search']
      mockCore.api.getConnectedServers.mockResolvedValue(mockServers)

      const result = await mcpService.getConnectedServers()

      expect(mockCore.api.getConnectedServers).toHaveBeenCalledWith()
      expect(result).toEqual(mockServers)
      expect(result).toHaveLength(3)
    })

    it('should return empty array when no servers connected', async () => {
      mockCore.api.getConnectedServers.mockResolvedValue([])

      const result = await mcpService.getConnectedServers()

      expect(result).toEqual([])
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle API rejection', async () => {
      const mockError = new Error('Failed to get connected servers')
      mockCore.api.getConnectedServers.mockRejectedValue(mockError)

      await expect(mcpService.getConnectedServers()).rejects.toThrow('Failed to get connected servers')
    })

    it('should handle undefined window.core.api', async () => {
      const originalCore = window.core
      // @ts-ignore
      window.core = undefined

      const result = await mcpService.getConnectedServers()

      expect(result).toBeUndefined()

      window.core = originalCore
    })
  })

  describe('callTool', () => {
    it('should call tool with correct arguments and return result', async () => {
      const toolArgs = {
        toolName: 'file_read',
        arguments: { path: '/path/to/file.txt' },
      }

      const mockResult = {
        error: '',
        content: [{ text: 'File content here' }],
      }

      mockCore.api.callTool.mockResolvedValue(mockResult)

      const result = await mcpService.callTool(toolArgs)

      expect(mockCore.api.callTool).toHaveBeenCalledWith(toolArgs)
      expect(result).toEqual(mockResult)
    })

    it('should handle tool call with error', async () => {
      const toolArgs = {
        toolName: 'file_read',
        arguments: { path: '/nonexistent/file.txt' },
      }

      const mockResult = {
        error: 'File not found',
        content: [],
      }

      mockCore.api.callTool.mockResolvedValue(mockResult)

      const result = await mcpService.callTool(toolArgs)

      expect(result.error).toBe('File not found')
      expect(result.content).toEqual([])
    })

    it('should handle complex tool arguments', async () => {
      const toolArgs = {
        toolName: 'database_query',
        arguments: {
          query: 'SELECT * FROM users WHERE age > ?',
          params: [18],
          limit: 100,
        },
      }

      const mockResult = {
        error: '',
        content: [{ text: 'Query results...' }],
      }

      mockCore.api.callTool.mockResolvedValue(mockResult)

      const result = await mcpService.callTool(toolArgs)

      expect(mockCore.api.callTool).toHaveBeenCalledWith(toolArgs)
      expect(result).toEqual(mockResult)
    })

    it('should handle API rejection', async () => {
      const toolArgs = {
        toolName: 'file_read',
        arguments: { path: '/path/to/file.txt' },
      }

      const mockError = new Error('Tool execution failed')
      mockCore.api.callTool.mockRejectedValue(mockError)

      await expect(mcpService.callTool(toolArgs)).rejects.toThrow('Tool execution failed')
    })

    it('should handle undefined window.core.api', async () => {
      const originalCore = window.core
      // @ts-ignore
      window.core = undefined

      const toolArgs = {
        toolName: 'test_tool',
        arguments: {},
      }

      const result = await mcpService.callTool(toolArgs)

      expect(result).toBeUndefined()

      window.core = originalCore
    })

    it('should handle empty arguments object', async () => {
      const toolArgs = {
        toolName: 'simple_tool',
        arguments: {},
      }

      const mockResult = {
        error: '',
        content: [{ text: 'Success' }],
      }

      mockCore.api.callTool.mockResolvedValue(mockResult)

      const result = await mcpService.callTool(toolArgs)

      expect(mockCore.api.callTool).toHaveBeenCalledWith(toolArgs)
      expect(result).toEqual(mockResult)
    })
  })

  describe('integration tests', () => {
    it('should handle full MCP workflow: config -> restart -> get tools -> call tool', async () => {
      const config = '{"filesystem": {"command": "filesystem-server"}}'
      const tools: MCPTool[] = [
        {
          name: 'read_file',
          description: 'Read file',
          inputSchema: { type: 'object' },
        },
      ]
      const servers = ['filesystem']
      const toolResult = {
        error: '',
        content: [{ text: 'File content' }],
      }

      mockCore.api.saveMcpConfigs.mockResolvedValue(undefined)
      mockCore.api.restartMcpServers.mockResolvedValue(undefined)
      mockCore.api.getTools.mockResolvedValue(tools)
      mockCore.api.getConnectedServers.mockResolvedValue(servers)
      mockCore.api.callTool.mockResolvedValue(toolResult)

      // Execute workflow
      await mcpService.updateMCPConfig(config)
      await mcpService.restartMCPServers()
      const availableTools = await mcpService.getTools()
      const connectedServers = await mcpService.getConnectedServers()
      const result = await mcpService.callTool({
        toolName: 'read_file',
        arguments: { path: '/test.txt' },
      })

      // Verify all calls were made correctly
      expect(mockCore.api.saveMcpConfigs).toHaveBeenCalledWith({ configs: config })
      expect(mockCore.api.restartMcpServers).toHaveBeenCalled()
      expect(mockCore.api.getTools).toHaveBeenCalled()
      expect(mockCore.api.getConnectedServers).toHaveBeenCalled()
      expect(mockCore.api.callTool).toHaveBeenCalledWith({
        toolName: 'read_file',
        arguments: { path: '/test.txt' },
      })

      // Verify results
      expect(availableTools).toEqual(tools)
      expect(connectedServers).toEqual(servers)
      expect(result).toEqual(toolResult)
    })
  })
})