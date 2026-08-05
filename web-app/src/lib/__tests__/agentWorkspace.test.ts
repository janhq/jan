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
}
const getJanDataFolder = vi.fn()
const revealItemInDir = vi.fn()

vi.mock('@janhq/tauri-plugin-agent-tools-api', () => api)

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    app: () => ({ getJanDataFolder }),
    opener: () => ({ revealItemInDir }),
  }),
}))

describe('agentWorkspace', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.values(api).forEach((fn) => fn.mockReset())
    api.workspacePath.mockResolvedValue('/data/agent-workspace')
    getJanDataFolder.mockReset().mockResolvedValue('/data')
    revealItemInDir.mockReset()
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

  it('reveals the resolved store path, not the data folder', async () => {
    const ws = await import('../agentWorkspace')
    await ws.revealStore()
    expect(revealItemInDir).toHaveBeenCalledWith('/data/agent-workspace')
  })
})
