import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = {
  workspacePath: vi.fn(),
  skillList: vi.fn(),
  skillRead: vi.fn(),
  skillWrite: vi.fn(),
  skillDelete: vi.fn(),
  memoryList: vi.fn(),
  memoryRead: vi.fn(),
  memoryWrite: vi.fn(),
  memoryDelete: vi.fn(),
  // agentWorkspace pulls in agentTools (for invalidateMemory), whose own
  // imports from this module must exist on the mock even though these tests
  // never call them.
  memoryCatalog: vi.fn(),
  subagentResultReserve: vi.fn(),
  subagentResultFill: vi.fn(),
  toolSchemas: vi.fn(),
  executeTool: vi.fn(),
  sandboxStatus: vi.fn(),
  threadWorkspaceDelete: vi.fn(),
  threadWorkspaceSweep: vi.fn(),
}
const getJanDataFolder = vi.fn()
const revealItemInDir = vi.fn()
const openPath = vi.fn()

vi.mock('@janhq/tauri-plugin-agent-tools-api', () => api)

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    app: () => ({ getJanDataFolder }),
    opener: () => ({ revealItemInDir, openPath }),
  }),
}))

describe('agentWorkspace', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.values(api).forEach((fn) => fn.mockReset())
    api.workspacePath.mockResolvedValue('/data/agent-workspace')
    getJanDataFolder.mockReset().mockResolvedValue('/data')
    revealItemInDir.mockReset()
    openPath.mockReset()
  })

  /// Every call resolves the data folder first; none of them take a project
  /// path, so the settings page always edits the permanent store.
  it('reads and writes the permanent store', async () => {
    api.skillList.mockResolvedValue([{ name: 'deploy', description: 'd' }])
    api.memoryList.mockResolvedValue(['prefs'])
    api.skillRead.mockResolvedValue('body')
    api.memoryRead.mockResolvedValue('note')
    const ws = await import('../agentWorkspace')

    await expect(ws.storePath()).resolves.toBe('/data/agent-workspace')
    await expect(ws.listSkills()).resolves.toEqual([
      { name: 'deploy', description: 'd' },
    ])
    await expect(ws.listMemories()).resolves.toEqual(['prefs'])
    await expect(ws.readSkill('deploy')).resolves.toBe('body')
    await expect(ws.readMemory('prefs')).resolves.toBe('note')

    expect(api.skillList).toHaveBeenCalledWith('/data')
    expect(api.memoryRead).toHaveBeenCalledWith('/data', 'prefs')
  })

  it('writes and deletes by name', async () => {
    const ws = await import('../agentWorkspace')
    await ws.writeSkill('deploy', 'x')
    await ws.deleteSkill('deploy')
    await ws.writeMemory('prefs', 'y')
    await ws.deleteMemory('prefs')

    expect(api.skillWrite).toHaveBeenCalledWith('/data', 'deploy', 'x')
    expect(api.skillDelete).toHaveBeenCalledWith('/data', 'deploy')
    expect(api.memoryWrite).toHaveBeenCalledWith('/data', 'prefs', 'y')
    expect(api.memoryDelete).toHaveBeenCalledWith('/data', 'prefs')
  })

  // ---- the chat Remember action --------------------------------------------

  it('slugs a thread title into a filesystem-safe note name', async () => {
    const { slugifyMemoryName } = await import('../agentWorkspace')
    expect(slugifyMemoryName('How to set up CUDA 12?')).toBe(
      'how-to-set-up-cuda-12'
    )
    expect(slugifyMemoryName('  ---  ')).toBe('memory')
    expect(slugifyMemoryName('')).toBe('memory')
    expect(slugifyMemoryName('a'.repeat(100))).toHaveLength(60)
  })

  it('remembers under the thread title, deduplicating taken names', async () => {
    api.memoryList.mockResolvedValue(['chat-notes', 'chat-notes-2'])
    const ws = await import('../agentWorkspace')
    await expect(ws.rememberNote('Chat Notes', 'the fact')).resolves.toBe(
      'chat-notes-3'
    )
    // Suffixing, never overwriting: memory_write replaces by name, and the
    // existing notes are not this action's to replace.
    expect(api.memoryWrite).toHaveBeenCalledWith(
      '/data',
      'chat-notes-3',
      'the fact'
    )
  })

  it('uses the plain slug when the name is free', async () => {
    api.memoryList.mockResolvedValue([])
    const ws = await import('../agentWorkspace')
    await expect(ws.rememberNote('Fresh Topic', 'body')).resolves.toBe(
      'fresh-topic'
    )
  })

  /// Unlike a tool call, a failed edit has a user waiting on it, so these throw
  /// instead of resolving to an error value the page would have to sniff for.
  it('propagates failures to the caller', async () => {
    api.memoryWrite.mockRejectedValue(new Error("invalid name '..'"))
    const ws = await import('../agentWorkspace')
    await expect(ws.writeMemory('..', 'x')).rejects.toThrow("invalid name '..'")
  })

  it('fails clearly when the data folder is unavailable', async () => {
    getJanDataFolder.mockResolvedValue(undefined)
    const ws = await import('../agentWorkspace')
    await expect(ws.listMemories()).rejects.toThrow('data folder')
    expect(api.memoryList).not.toHaveBeenCalled()
  })

  // openPath, not revealItemInDir: revealing a directory selects it in its
  // parent, which is not what "open the store" means.
  it('opens the resolved store path, not the data folder', async () => {
    const ws = await import('../agentWorkspace')
    await ws.revealStore()
    expect(openPath).toHaveBeenCalledWith('/data/agent-workspace')
    expect(revealItemInDir).not.toHaveBeenCalled()
  })
})
