import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MCPOrchestrator } from '../mcp-orchestrator'
import type { MCPServiceLike } from '../mcp-orchestrator'
import type { ServerSummary } from '@/services/mcp/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(overrides: Partial<MCPServiceLike> = {}): MCPServiceLike {
  return {
    getTools: vi.fn().mockResolvedValue([]),
    getToolsForServers: vi.fn().mockResolvedValue([]),
    getServerSummaries: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

const fewSummaries: ServerSummary[] = [
  { name: 'fs', capabilities: ['filesystem'], description: 'read/write files' },
  { name: 'web', capabilities: ['browser'], description: 'browse the web' },
]

const manySummaries: ServerSummary[] = [
  { name: 'filesystem', capabilities: ['filesystem', 'files'], description: 'read and write files on disk' },
  { name: 'browser', capabilities: ['web', 'browser', 'search'], description: 'browse web pages' },
  { name: 'database', capabilities: ['database', 'sql'], description: 'query databases' },
  { name: 'calendar', capabilities: ['calendar', 'events'], description: 'manage calendar events' },
  { name: 'email', capabilities: ['email', 'mail'], description: 'send and read emails' },
  { name: 'code', capabilities: ['code', 'git'], description: 'interact with code repositories' },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPOrchestrator', () => {
  let orchestrator: MCPOrchestrator

  beforeEach(() => {
    orchestrator = new MCPOrchestrator()
  })

  // ─── below threshold — uses getTools() ───────────────────────────────────

  describe('when few servers (≤ threshold)', () => {
    it('calls getTools() directly', async () => {
      const mockTools = [
        { name: 'read_file', description: 'reads a file', inputSchema: {}, server: 'fs' },
      ]
      const service = makeService({
        getServerSummaries: vi.fn().mockResolvedValue(fewSummaries),
        getTools: vi.fn().mockResolvedValue(mockTools),
      })

      const tools = await orchestrator.getRelevantTools('read a file', service, [])

      expect(service.getTools).toHaveBeenCalled()
      expect(service.getToolsForServers).not.toHaveBeenCalled()
      expect(tools).toEqual(mockTools)
    })

    it('filters disabled tools', async () => {
      const mockTools = [
        { name: 'read_file', description: 'reads a file', inputSchema: {}, server: 'fs' },
        { name: 'write_file', description: 'writes a file', inputSchema: {}, server: 'fs' },
      ]
      const service = makeService({
        getServerSummaries: vi.fn().mockResolvedValue(fewSummaries),
        getTools: vi.fn().mockResolvedValue(mockTools),
      })

      const tools = await orchestrator.getRelevantTools('read a file', service, ['fs::write_file'])

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('read_file')
    })
  })

  // ─── above threshold — uses getToolsForServers() ─────────────────────────

  describe('when many servers (> threshold)', () => {
    it('calls getToolsForServers() with intent-selected server names', async () => {
      const mockTools = [
        { name: 'read_file', description: 'reads a file', inputSchema: {}, server: 'filesystem' },
      ]
      const service = makeService({
        getServerSummaries: vi.fn().mockResolvedValue(manySummaries),
        getToolsForServers: vi.fn().mockResolvedValue(mockTools),
      })

      await orchestrator.getRelevantTools('read the file from disk', service, [])

      expect(service.getToolsForServers).toHaveBeenCalled()
      const calledWith = (service.getToolsForServers as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
      expect(calledWith).toContain('filesystem')
      // Should NOT include unrelated servers
      expect(calledWith).not.toContain('email')
      expect(calledWith).not.toContain('calendar')
    })

    it('falls back to all servers when intent yields no match', async () => {
      const service = makeService({
        getServerSummaries: vi.fn().mockResolvedValue(manySummaries),
        getTools: vi.fn().mockResolvedValue([]),
        getToolsForServers: vi.fn().mockResolvedValue([]),
      })

      // Gibberish message → no keyword match → all servers
      await orchestrator.getRelevantTools('zzzzxxx', service, [])
      // When all servers are returned by classifyIntent the count equals manySummaries.length
      const calledWith = (service.getToolsForServers as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[]
      expect(calledWith).toHaveLength(manySummaries.length)
    })
  })

  // ─── caching ─────────────────────────────────────────────────────────────

  describe('tool caching', () => {
    it('uses cached tools on second call without hitting the service again', async () => {
      const mockTools = [
        { name: 'read_file', description: 'reads a file', inputSchema: {}, server: 'filesystem' },
      ]
      const service = makeService({
        getServerSummaries: vi.fn().mockResolvedValue(manySummaries),
        getToolsForServers: vi.fn().mockResolvedValue(mockTools),
      })

      await orchestrator.getRelevantTools('read a file from disk', service, [])
      await orchestrator.getRelevantTools('read a file from disk', service, [])

      // getToolsForServers should only be called once — second call uses cache
      expect(service.getToolsForServers).toHaveBeenCalledTimes(1)
    })

    it('clears the full cache on invalidateCache() with no argument', async () => {
      const mockTools = [
        { name: 'read_file', description: 'reads a file', inputSchema: {}, server: 'filesystem' },
      ]
      const service = makeService({
        getServerSummaries: vi.fn().mockResolvedValue(manySummaries),
        getToolsForServers: vi.fn().mockResolvedValue(mockTools),
      })

      await orchestrator.getRelevantTools('read a file from disk', service, [])
      orchestrator.invalidateCache()
      await orchestrator.getRelevantTools('read a file from disk', service, [])

      expect(service.getToolsForServers).toHaveBeenCalledTimes(2)
    })

    it('clears only one server cache on invalidateCache(serverName)', async () => {
      const fsTools = [{ name: 'read_file', description: '', inputSchema: {}, server: 'filesystem' }]
      const browserTools = [{ name: 'browse', description: '', inputSchema: {}, server: 'browser' }]

      const service = makeService({
        getServerSummaries: vi.fn().mockResolvedValue(manySummaries),
        getToolsForServers: vi.fn()
          .mockResolvedValueOnce([...fsTools, ...browserTools])
          .mockResolvedValueOnce(fsTools),
      })

      await orchestrator.getRelevantTools('read file and browse web', service, [])
      orchestrator.invalidateCache('filesystem')
      await orchestrator.getRelevantTools('read file and browse web', service, [])

      // Second call should refetch — but only for filesystem, browser is still cached
      expect(service.getToolsForServers).toHaveBeenCalledTimes(2)
    })
  })

  // ─── summary caching ─────────────────────────────────────────────────────

  describe('server summary caching', () => {
    it('fetches summaries only once for multiple consecutive calls', async () => {
      const service = makeService({
        getServerSummaries: vi.fn().mockResolvedValue(fewSummaries),
        getTools: vi.fn().mockResolvedValue([]),
      })

      await orchestrator.getRelevantTools('hello', service, [])
      await orchestrator.getRelevantTools('world', service, [])
      await orchestrator.getRelevantTools('foo', service, [])

      expect(service.getServerSummaries).toHaveBeenCalledTimes(1)
    })

    it('re-fetches summaries after invalidateCache()', async () => {
      const service = makeService({
        getServerSummaries: vi.fn().mockResolvedValue(fewSummaries),
        getTools: vi.fn().mockResolvedValue([]),
      })

      await orchestrator.getRelevantTools('hello', service, [])
      orchestrator.invalidateCache()
      await orchestrator.getRelevantTools('world', service, [])

      expect(service.getServerSummaries).toHaveBeenCalledTimes(2)
    })
  })

  // ─── error resilience ────────────────────────────────────────────────────

  describe('error resilience', () => {
    it('falls back to getTools() when getServerSummaries() throws', async () => {
      const mockTools = [{ name: 'tool', description: '', inputSchema: {}, server: 's' }]
      const service = makeService({
        getServerSummaries: vi.fn().mockRejectedValue(new Error('network error')),
        getTools: vi.fn().mockResolvedValue(mockTools),
      })

      const tools = await orchestrator.getRelevantTools('do something', service, [])
      // summaries failed → empty list → below threshold → getTools()
      expect(service.getTools).toHaveBeenCalled()
      expect(tools).toEqual(mockTools)
    })

    it('returns empty tools when getToolsForServers() throws', async () => {
      const service = makeService({
        getServerSummaries: vi.fn().mockResolvedValue(manySummaries),
        getToolsForServers: vi.fn().mockRejectedValue(new Error('server down')),
      })

      const tools = await orchestrator.getRelevantTools('read a file', service, [])
      expect(tools).toEqual([])
    })
  })
})
