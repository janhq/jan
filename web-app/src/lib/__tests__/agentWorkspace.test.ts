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
    api.memoryRead.mockResolvedValue('something else')
    const ws = await import('../agentWorkspace')
    await expect(ws.rememberNote('Chat Notes', 'the fact')).resolves.toEqual({
      name: 'chat-notes-3',
      duplicate: false,
    })
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
    await expect(ws.rememberNote('Fresh Topic', 'body')).resolves.toEqual({
      name: 'fresh-topic',
      duplicate: false,
    })
    expect(api.memoryRead).not.toHaveBeenCalled()
  })

  // Clicking Remember twice on one message must not mint `-2`, `-3`, ... copies
  // of the same text: the suffix is for a *different* fact under a reused title.
  it('does not write a second copy of a note that already exists', async () => {
    api.memoryList.mockResolvedValue(['chat-notes', 'chat-notes-2'])
    api.memoryRead.mockImplementation(async (_: string, name: string) =>
      name === 'chat-notes-2' ? 'the fact' : 'other'
    )
    const ws = await import('../agentWorkspace')
    await expect(ws.rememberNote('Chat Notes', 'the fact')).resolves.toEqual({
      name: 'chat-notes-2',
      duplicate: true,
    })
    expect(api.memoryWrite).not.toHaveBeenCalled()
  })

  it('treats a note that fails to read as different rather than failing', async () => {
    api.memoryList.mockResolvedValue(['chat-notes'])
    api.memoryRead.mockRejectedValue(new Error('gone'))
    const ws = await import('../agentWorkspace')
    await expect(ws.rememberNote('Chat Notes', 'the fact')).resolves.toEqual({
      name: 'chat-notes-2',
      duplicate: false,
    })
  })

  describe('concurrent Remember actions', () => {
    let notes: Map<string, string>

    beforeEach(() => {
      notes = new Map()
      api.memoryList.mockImplementation(async () => [...notes.keys()])
      api.memoryRead.mockImplementation(async (_: string, name: string) => {
        if (!notes.has(name)) throw new Error('missing note')
        return notes.get(name)
      })
      api.memoryWrite.mockImplementation(
        async (_: string, name: string, content: string) => {
          notes.set(name, content)
        }
      )
    })

    it('preserves different facts saved together under the same title', async () => {
      const ws = await import('../agentWorkspace')
      const results = await Promise.all([
        ws.rememberNote('Chat Notes', 'first fact'),
        ws.rememberNote('Chat Notes', 'second fact'),
      ])

      expect(results).toEqual([
        { name: 'chat-notes', duplicate: false },
        { name: 'chat-notes-2', duplicate: false },
      ])
      expect([...notes.entries()]).toEqual([
        ['chat-notes', 'first fact'],
        ['chat-notes-2', 'second fact'],
      ])
    })

    it('writes identical concurrent saves only once', async () => {
      const ws = await import('../agentWorkspace')
      const results = await Promise.all([
        ws.rememberNote('Chat Notes', 'same fact'),
        ws.rememberNote('Chat Notes', 'same fact'),
      ])

      expect(results).toEqual([
        { name: 'chat-notes', duplicate: false },
        { name: 'chat-notes', duplicate: true },
      ])
      expect(api.memoryWrite).toHaveBeenCalledTimes(1)
    })

    it('protects a suffix that is also another title slug', async () => {
      notes.set('topic', 'existing fact')
      const ws = await import('../agentWorkspace')
      await Promise.all([
        ws.rememberNote('Topic', 'first new fact'),
        ws.rememberNote('Topic 2', 'second new fact'),
      ])

      expect([...notes.entries()]).toEqual([
        ['topic', 'existing fact'],
        ['topic-2', 'first new fact'],
        ['topic-2-2', 'second new fact'],
      ])
    })

    it('allows a queued save after an earlier write rejects', async () => {
      api.memoryWrite.mockRejectedValueOnce(new Error('disk full'))
      const ws = await import('../agentWorkspace')
      const results = await Promise.allSettled([
        ws.rememberNote('Chat Notes', 'first fact'),
        ws.rememberNote('Chat Notes', 'second fact'),
      ])

      expect(results[0]).toEqual({
        status: 'rejected',
        reason: new Error('disk full'),
      })
      expect(results[1]).toEqual({
        status: 'fulfilled',
        value: { name: 'chat-notes', duplicate: false },
      })
      expect(notes.get('chat-notes')).toBe('second fact')
    })

    it('waits for a pending write before listing names for the next save', async () => {
      let finishWrite!: () => void
      const pendingWrite = new Promise<void>((resolve) => {
        finishWrite = resolve
      })
      api.memoryWrite.mockImplementationOnce(
        async (_: string, name: string, content: string) => {
          await pendingWrite
          notes.set(name, content)
        }
      )
      const ws = await import('../agentWorkspace')
      const first = ws.rememberNote('Chat Notes', 'first fact')
      await vi.waitFor(() => expect(api.memoryWrite).toHaveBeenCalledTimes(1))
      const second = ws.rememberNote('Chat Notes', 'second fact')

      try {
        // Let the second action reach the queue while the first IPC write is
        // still pending. Its name lookup must wait for that write to finish.
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(api.memoryList).toHaveBeenCalledTimes(1)
        expect(api.memoryWrite).toHaveBeenCalledTimes(1)
      } finally {
        finishWrite()
        await Promise.all([first, second])
      }
      expect([...notes.values()]).toEqual(['first fact', 'second fact'])
    })

    it('keeps one data folder throughout a save', async () => {
      api.memoryList.mockImplementation(async () => {
        getJanDataFolder.mockResolvedValue('/other-data')
        return []
      })
      const ws = await import('../agentWorkspace')
      await ws.rememberNote('Chat Notes', 'the fact')

      expect(api.memoryList).toHaveBeenCalledWith('/data')
      expect(api.memoryWrite).toHaveBeenCalledWith(
        '/data', 'chat-notes', 'the fact'
      )
      expect(getJanDataFolder).toHaveBeenCalledTimes(1)
    })

    it('does not block another data folder behind a pending save', async () => {
      let finishFirst!: () => void
      const firstWrite = new Promise<void>((resolve) => {
        finishFirst = resolve
      })
      api.memoryWrite.mockImplementationOnce(() => firstWrite)
      const ws = await import('../agentWorkspace')
      const first = ws.rememberNote('First', 'first fact')
      await vi.waitFor(() => expect(api.memoryWrite).toHaveBeenCalledTimes(1))

      getJanDataFolder.mockResolvedValue('/other-data')
      try {
        await expect(ws.rememberNote('Second', 'second fact')).resolves.toEqual({
          name: 'second',
          duplicate: false,
        })
        expect(api.memoryWrite).toHaveBeenLastCalledWith(
          '/other-data', 'second', 'second fact'
        )
      } finally {
        finishFirst()
        await first
      }
    })
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
