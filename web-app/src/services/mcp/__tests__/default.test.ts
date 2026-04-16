import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultMCPService } from '../default'

describe('DefaultMCPService', () => {
  let svc: DefaultMCPService

  beforeEach(() => {
    svc = new DefaultMCPService()
    vi.restoreAllMocks()
  })

  describe('updateMCPConfig', () => {
    it('resolves without error', async () => {
      await expect(svc.updateMCPConfig('{"a":1}')).resolves.toBeUndefined()
    })
  })

  describe('restartMCPServers', () => {
    it('resolves without error', async () => {
      await expect(svc.restartMCPServers()).resolves.toBeUndefined()
    })
  })

  describe('getMCPConfig', () => {
    it('returns empty object', async () => {
      const result = await svc.getMCPConfig()
      expect(result).toEqual({})
    })
  })

  describe('getTools', () => {
    it('returns empty array', async () => {
      const result = await svc.getTools()
      expect(result).toEqual([])
    })
  })

  describe('getToolsForServers', () => {
    it('returns empty array regardless of input', async () => {
      const result = await svc.getToolsForServers(['server1', 'server2'])
      expect(result).toEqual([])
    })
  })

  describe('getServerSummaries', () => {
    it('returns empty array', async () => {
      const result = await svc.getServerSummaries()
      expect(result).toEqual([])
    })
  })

  describe('getConnectedServers', () => {
    it('returns empty array', async () => {
      const result = await svc.getConnectedServers()
      expect(result).toEqual([])
    })
  })

  describe('callTool', () => {
    it('returns empty content and no error', async () => {
      const result = await svc.callTool({
        toolName: 'test_tool',
        arguments: { key: 'value' },
      })
      expect(result).toEqual({ error: '', content: [] })
    })
  })

  describe('callToolWithCancellation', () => {
    it('returns a result with promise, cancel, and token', async () => {
      const result = svc.callToolWithCancellation({
        toolName: 'test_tool',
        arguments: { key: 'value' },
        cancellationToken: 'tok-123',
      })
      expect(result.token).toBe('')
      expect(typeof result.cancel).toBe('function')
      const resolved = await result.promise
      expect(resolved).toEqual({ error: '', content: [] })
    })

    it('cancel resolves without error', async () => {
      const result = svc.callToolWithCancellation({
        toolName: 'test_tool',
        arguments: {},
      })
      await expect(result.cancel()).resolves.toBeUndefined()
    })
  })

  describe('cancelToolCall', () => {
    it('resolves without error', async () => {
      await expect(svc.cancelToolCall('tok-123')).resolves.toBeUndefined()
    })
  })

  describe('activateMCPServer', () => {
    it('resolves without error', async () => {
      await expect(
        svc.activateMCPServer('server1', { command: 'node', args: ['server.js'] } as any)
      ).resolves.toBeUndefined()
    })
  })

  describe('deactivateMCPServer', () => {
    it('resolves without error', async () => {
      await expect(svc.deactivateMCPServer('server1')).resolves.toBeUndefined()
    })
  })

  describe('checkJanBrowserExtensionConnected', () => {
    it('returns false', async () => {
      const result = await svc.checkJanBrowserExtensionConnected()
      expect(result).toBe(false)
    })
  })
})
