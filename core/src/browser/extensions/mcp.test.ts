import { describe, it, expect, beforeEach } from 'vitest'
import { MCPExtension } from './mcp'
import { ExtensionTypeEnum } from '../extension'
import { MCPTool, MCPToolCallResult } from '../../types'

class TestMCPExtension extends MCPExtension {
  constructor() {
    super('test://mcp', 'test-mcp')
  }

  async getTools(): Promise<MCPTool[]> {
    return [
      {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        server: 'test-server'
      }
    ]
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    return {
      error: '',
      content: [{ type: 'text', text: `Called ${toolName} with ${JSON.stringify(args)}` }]
    }
  }

  async getConnectedServers(): Promise<string[]> {
    return ['test-server']
  }

  async refreshTools(): Promise<void> {
    // Mock implementation
  }

  async isHealthy(): Promise<boolean> {
    return true
  }

  async onLoad(): Promise<void> {
    // Mock implementation
  }

  onUnload(): void {
    // Mock implementation
  }
}

describe('MCPExtension', () => {
  let mcpExtension: TestMCPExtension

  beforeEach(() => {
    mcpExtension = new TestMCPExtension()
  })

  describe('type', () => {
    it('should return MCP extension type', () => {
      expect(mcpExtension.type()).toBe(ExtensionTypeEnum.MCP)
    })
  })

  describe('getTools', () => {
    it('should return array of MCP tools', async () => {
      const tools = await mcpExtension.getTools()
      expect(tools).toHaveLength(1)
      expect(tools[0]).toEqual({
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        server: 'test-server'
      })
    })
  })

  describe('callTool', () => {
    it('should call tool and return result', async () => {
      const result = await mcpExtension.callTool('test_tool', { param: 'value' })
      expect(result).toEqual({
        error: '',
        content: [{ type: 'text', text: 'Called test_tool with {"param":"value"}' }]
      })
    })
  })

  describe('getConnectedServers', () => {
    it('should return list of connected servers', async () => {
      const servers = await mcpExtension.getConnectedServers()
      expect(servers).toEqual(['test-server'])
    })
  })

  describe('isHealthy', () => {
    it('should return health status', async () => {
      const healthy = await mcpExtension.isHealthy()
      expect(healthy).toBe(true)
    })
  })
})
