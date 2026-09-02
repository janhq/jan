import { beforeEach, describe, expect, it, vi } from 'vitest'

const toolSchemas = vi.fn()
const executeTool = vi.fn()
const threadWorkspaceDelete = vi.fn()
const threadWorkspaceSweep = vi.fn()
const sandboxStatus = vi.fn()
const memoryCatalog = vi.fn()
const memoryRead = vi.fn()
const subagentResultReserve = vi.fn()
const subagentResultFill = vi.fn()
const getJanDataFolder = vi.fn()

vi.mock('@janhq/tauri-plugin-agent-tools-api', () => ({
  toolSchemas: () => toolSchemas(),
  executeTool: (...args: unknown[]) => executeTool(...args),
  threadWorkspaceDelete: (...args: unknown[]) => threadWorkspaceDelete(...args),
  threadWorkspaceSweep: (...args: unknown[]) => threadWorkspaceSweep(...args),
  sandboxStatus: () => sandboxStatus(),
  memoryCatalog: (...args: unknown[]) => memoryCatalog(...args),
  memoryRead: (...args: unknown[]) => memoryRead(...args),
  subagentResultReserve: (...args: unknown[]) => subagentResultReserve(...args),
  subagentResultFill: (...args: unknown[]) => subagentResultFill(...args),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ app: () => ({ getJanDataFolder }) }),
}))

const schemaFor = (name: string) => ({
  type: 'function' as const,
  function: { name, description: `${name} desc`, parameters: {} },
})

describe('agentTools', () => {
  beforeEach(() => {
    vi.resetModules()
    toolSchemas.mockReset()
    executeTool.mockReset()
    threadWorkspaceDelete.mockReset().mockResolvedValue(undefined)
    threadWorkspaceSweep.mockReset().mockResolvedValue(0)
    sandboxStatus
      .mockReset()
      .mockResolvedValue({ backend: 'bubblewrap', enforces: true })
    memoryCatalog.mockReset().mockResolvedValue([])
    memoryRead.mockReset().mockResolvedValue('')
    subagentResultReserve.mockReset()
    subagentResultFill.mockReset()
    getJanDataFolder.mockReset().mockResolvedValue('/data')
  })

  // The chat surface offers the sandboxed shell alone; everything else is
  // Cowork's. A chat set that grew a write tool would hand the main interface
  // an agent toolset it no longer advertises a workspace for.
  it('restricts the chat subset to bash', async () => {
    const { CHAT_AGENT_TOOL_NAMES } = await import('../agentTools')
    expect([...CHAT_AGENT_TOOL_NAMES]).toEqual(['bash'])
  })

  it('advertises the workspace tools including writes and bash', async () => {
    const { AGENT_TOOL_NAMES } = await import('../agentTools')
    for (const name of ['read', 'ls', 'find', 'grep', 'bash']) {
      expect(AGENT_TOOL_NAMES.has(name)).toBe(true)
    }
    // write/edit can only touch the thread's ephemeral sandbox, so they are
    // allowed there without a prompt -- withholding them while bash can write
    // the same files would be a restriction a sibling tool bypasses.
    for (const name of ['write', 'edit']) {
      expect(AGENT_TOOL_NAMES.has(name)).toBe(true)
    }
    // Already advertised through the websearch plugin.
    for (const name of ['web_search', 'web_fetch']) {
      expect(AGENT_TOOL_NAMES.has(name)).toBe(false)
    }
  })

  it('filters Rust schemas down to the advertised subset', async () => {
    toolSchemas.mockResolvedValue([
      schemaFor('read'),
      schemaFor('write'),
      schemaFor('memory_write'),
      schemaFor('web_search'),
    ])
    const { getAgentToolSchemas } = await import('../agentTools')
    const names = (await getAgentToolSchemas()).map((s) => s.function.name)
    expect(names).toEqual(['read', 'write', 'memory_write'])
  })

  /// The diff must reach the caller so the UI can render it, but stay out of
  /// `content`, which is what gets sent back to the model.
  it('returns the diff alongside content, not inside it', async () => {
    executeTool.mockResolvedValue({
      content: 'Applied 1 edit(s) to a.txt',
      diff: '@@ edit 1/1 @@\n-    1 | a\n+    1 | A',
      isError: false,
    })
    const { executeAgentTool } = await import('../agentTools')
    const result = await executeAgentTool('edit', { path: 'a.txt' }, 'thread-1')
    expect(result.content).toBe('Applied 1 edit(s) to a.txt')
    expect(result.diff).toContain('+    1 | A')
    expect(String(result.content)).not.toContain('@@')
  })

  it('omits the diff for tools that produce none', async () => {
    executeTool.mockResolvedValue({
      content: 'a.txt',
      diff: null,
      isError: false,
    })
    const { executeAgentTool } = await import('../agentTools')
    const result = await executeAgentTool('ls', {}, 'thread-1')
    expect(result.diff).toBeUndefined()
  })

  it('offers bash when the sandbox can enforce', async () => {
    toolSchemas.mockResolvedValue([schemaFor('read'), schemaFor('bash')])
    const { getAgentToolSchemas } = await import('../agentTools')
    const names = (await getAgentToolSchemas()).map((s) => s.function.name)
    expect(names).toEqual(['read', 'bash'])
  })

  // Offering a tool the executor will always refuse wastes a model turn, so an
  // unconfinable host must not see bash at all.
  it('withholds bash when no sandbox backend exists', async () => {
    sandboxStatus.mockResolvedValue({ backend: 'none', enforces: false })
    toolSchemas.mockResolvedValue([schemaFor('read'), schemaFor('bash')])
    const { getAgentToolSchemas } = await import('../agentTools')
    const names = (await getAgentToolSchemas()).map((s) => s.function.name)
    expect(names).toEqual(['read'])
  })

  it('withholds bash when the sandbox probe itself fails', async () => {
    sandboxStatus.mockRejectedValue(new Error('probe exploded'))
    toolSchemas.mockResolvedValue([schemaFor('read'), schemaFor('bash')])
    const { getAgentToolSchemas, sandboxEnforces } = await import(
      '../agentTools'
    )
    const names = (await getAgentToolSchemas()).map((s) => s.function.name)
    expect(names).toEqual(['read'])
    expect(sandboxEnforces()).toBe(false)
  })

  // Chat's shell runs with the network closed; no global setting can open it.
  it('keeps the sandbox network closed unless the caller opens it', async () => {
    executeTool.mockResolvedValue({ content: '', diff: null, isError: false })
    const { executeAgentTool } = await import('../agentTools')
    await executeAgentTool('bash', { command: 'ls' }, 'thread-1')
    expect(executeTool).toHaveBeenLastCalledWith(
      '/data',
      'thread-1',
      'bash',
      { command: 'ls' },
      undefined,
      undefined,
      false,
      undefined,
      'thread'
    )
  })

  // Cowork opens the sandbox network per call.
  it('opens the network when the caller asks', async () => {
    executeTool.mockResolvedValue({ content: '', diff: null, isError: false })
    const { executeAgentTool } = await import('../agentTools')
    await executeAgentTool(
      'bash',
      { command: 'ls' },
      'thread-1',
      undefined,
      'thread',
      true
    )
    expect(executeTool).toHaveBeenLastCalledWith(
      '/data',
      'thread-1',
      'bash',
      { command: 'ls' },
      undefined,
      undefined,
      true,
      undefined,
      'thread'
    )
  })

  it('caches the schemas so every turn does not re-cross IPC', async () => {
    toolSchemas.mockResolvedValue([schemaFor('read')])
    const { getAgentToolSchemas } = await import('../agentTools')
    await getAgentToolSchemas()
    await getAgentToolSchemas()
    expect(toolSchemas).toHaveBeenCalledTimes(1)
  })

  /// The thread id scopes the sandbox, so it must reach the plugin on every
  /// call; without it two conversations would share one scratch directory.
  it('scopes execution to the calling thread and attaches no folder by default', async () => {
    executeTool.mockResolvedValue({
      content: 'hello',
      diff: null,
      isError: false,
    })
    const { executeAgentTool } = await import('../agentTools')
    await expect(
      executeAgentTool('read', { path: 'a.txt' }, 'thread-1')
    ).resolves.toEqual({ content: 'hello' })
    expect(executeTool).toHaveBeenCalledWith(
      '/data',
      'thread-1',
      'read',
      { path: 'a.txt' },
      undefined,
      undefined,
      false,
      undefined,
      'thread'
    )
  })

  // The workspace UI promises "reads from <folder>", so the folder has to reach
  // the plugin; Rust is what makes it read-only.
  it('forwards an attached folder as the read-only project', async () => {
    vi.mocked(executeTool).mockResolvedValue({
      content: 'ok',
      isError: false,
      diff: null,
    } as never)
    const { executeAgentTool } = await import('../agentTools')
    await executeAgentTool('read', { path: 'a.txt' }, 'thread-1', '/home/u/repo')
    expect(executeTool).toHaveBeenLastCalledWith(
      '/data',
      'thread-1',
      'read',
      { path: 'a.txt' },
      undefined,
      undefined,
      false,
      '/home/u/repo',
      'thread'
    )
  })

  it('sends undefined, not null, when no folder is attached', async () => {
    vi.mocked(executeTool).mockResolvedValue({
      content: 'ok',
      isError: false,
      diff: null,
    } as never)
    const { executeAgentTool } = await import('../agentTools')
    await executeAgentTool('read', { path: 'a.txt' }, 'thread-1', null)
    expect(vi.mocked(executeTool).mock.calls.at(-1)?.[7]).toBeUndefined()
  })

  it('maps a gate refusal to an error rather than content', async () => {
    executeTool.mockResolvedValue({
      content: "tool 'write' needs user approval",
      diff: null,
      isError: true,
    })
    const { executeAgentTool } = await import('../agentTools')
    await expect(executeAgentTool('write', {}, 'thread-1')).resolves.toEqual({
      error: "tool 'write' needs user approval",
    })
  })

  it('reports a rejected invoke as an error instead of throwing', async () => {
    executeTool.mockRejectedValue({ message: 'denied by policy' })
    const { executeAgentTool } = await import('../agentTools')
    await expect(executeAgentTool('read', {}, 'thread-1')).resolves.toEqual({
      error: 'denied by policy',
    })
  })

  it('errors when the data folder is unavailable', async () => {
    getJanDataFolder.mockResolvedValue(undefined)
    const { executeAgentTool } = await import('../agentTools')
    const result = await executeAgentTool('read', {}, 'thread-1')
    expect(result.error).toBeTruthy()
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('coerces a non-object input to empty args', async () => {
    executeTool.mockResolvedValue({ content: '', diff: null, isError: false })
    const { executeAgentTool } = await import('../agentTools')
    await executeAgentTool('memory_list', undefined, 'thread-1')
    expect(executeTool).toHaveBeenCalledWith(
      '/data',
      'thread-1',
      'memory_list',
      {},
      undefined,
      undefined,
      false,
      undefined,
      'thread'
    )
  })

  // ---- shared memory recall ----------------------------------------------

  const note = (name: string, mtimeMs: number, summary = `${name} summary`) => ({
    name,
    summary,
    mtimeMs,
  })

  it('caps the prompt catalog at the newest notes, then name-sorts it', async () => {
    const { getMemoryCatalog, MEMORY_CATALOG_MAX_NOTES } = await import(
      '../agentTools'
    )
    const notes = Array.from({ length: MEMORY_CATALOG_MAX_NOTES + 5 }, (_, i) =>
      note(`n${String(i).padStart(3, '0')}`, i)
    )
    memoryCatalog.mockResolvedValue(notes)
    const catalog = await getMemoryCatalog()
    expect(catalog).toHaveLength(MEMORY_CATALOG_MAX_NOTES)
    // The 5 oldest (lowest mtime) fell off, and the survivors are name-sorted
    // so the prompt block is stable when nothing changed.
    const names = catalog.map((n) => n.name)
    expect(names).toEqual([...names].sort())
    expect(names).not.toContain('n000')
    expect(names).not.toContain('n004')
    expect(names).toContain('n005')
  })

  it('builds a whole-note digest, newest first, under the byte budget', async () => {
    const { refreshMemoryDigest, memoryDigestNow, MEMORY_DIGEST_BUDGET } =
      await import('../agentTools')
    expect(memoryDigestNow()).toBe('')
    memoryCatalog.mockResolvedValue([
      note('old', 1),
      note('huge', 3),
      note('new', 2),
    ])
    const bodies: Record<string, string> = {
      old: 'user prefers tabs',
      huge: 'x'.repeat(MEMORY_DIGEST_BUDGET + 1),
      new: 'project targets Node 22',
    }
    memoryRead.mockImplementation(async (_df: string, name: string) => bodies[name])
    const digest = await refreshMemoryDigest()
    // Whole notes only: the oversized note is absent, not truncated.
    expect(digest).not.toContain('xxx')
    expect(digest).toContain('## new\nproject targets Node 22')
    expect(digest).toContain('## old\nuser prefers tabs')
    // Newest first.
    expect(digest.indexOf('## new')).toBeLessThan(digest.indexOf('## old'))
    expect(digest.length).toBeLessThanOrEqual(MEMORY_DIGEST_BUDGET)
    expect(memoryDigestNow()).toBe(digest)
  })

  it('serves the snapshot from cache until a write invalidates it', async () => {
    const { getMemoryCatalog, invalidateMemory } = await import('../agentTools')
    memoryCatalog.mockResolvedValue([note('a', 1)])
    await getMemoryCatalog()
    await getMemoryCatalog()
    expect(memoryCatalog).toHaveBeenCalledTimes(1)
    invalidateMemory()
    await getMemoryCatalog()
    expect(memoryCatalog).toHaveBeenCalledTimes(2)
  })

  // Cowork's memory_write goes through executeAgentTool, so a note the model
  // records mid-session must reach the next run/send without a restart.
  it('invalidates the snapshot when the memory_write tool succeeds', async () => {
    executeTool.mockResolvedValue({ content: 'ok', diff: null, isError: false })
    const { executeAgentTool, getMemoryCatalog } = await import('../agentTools')
    memoryCatalog.mockResolvedValue([])
    await getMemoryCatalog()
    await executeAgentTool('memory_write', { name: 'a', content: 'b' }, 't1')
    await getMemoryCatalog()
    expect(memoryCatalog).toHaveBeenCalledTimes(2)
  })

  it('degrades to empty recall when the store is unreachable', async () => {
    memoryCatalog.mockRejectedValue(new Error('no backend'))
    const { getMemoryCatalog, refreshMemoryDigest } = await import(
      '../agentTools'
    )
    await expect(getMemoryCatalog()).resolves.toEqual([])
    await expect(refreshMemoryDigest()).resolves.toBe('')
  })

  it('deletes one thread sandbox on cleanup', async () => {
    const { cleanupThreadWorkspace } = await import('../agentTools')
    await cleanupThreadWorkspace('thread-1')
    expect(threadWorkspaceDelete).toHaveBeenCalledWith('/data', 'thread-1')
  })

  /// Deleting a thread must not fail loudly over a leftover directory; the next
  /// startup sweep collects it.
  it('swallows a cleanup failure', async () => {
    threadWorkspaceDelete.mockRejectedValue({ message: 'busy' })
    const { cleanupThreadWorkspace } = await import('../agentTools')
    await expect(cleanupThreadWorkspace('thread-1')).resolves.toBeUndefined()
  })

  it('sweeps with the surviving thread ids', async () => {
    threadWorkspaceSweep.mockResolvedValue(3)
    const { sweepThreadWorkspaces } = await import('../agentTools')
    await expect(sweepThreadWorkspaces(['a', 'b'])).resolves.toBe(3)
    expect(threadWorkspaceSweep).toHaveBeenCalledWith('/data', ['a', 'b'])
  })

  it('reports zero swept when the sweep fails', async () => {
    threadWorkspaceSweep.mockRejectedValue(new Error('nope'))
    const { sweepThreadWorkspaces } = await import('../agentTools')
    await expect(sweepThreadWorkspaces(['a'])).resolves.toBe(0)
  })

  it('claims a result file and reports the model-visible path', async () => {
    subagentResultReserve.mockResolvedValue({
      file: 'researcher-c1.md',
      path: '/tmp/subagents/researcher-c1.md',
    })
    const { reserveSubagentResult } = await import('../agentTools')
    await expect(
      reserveSubagentResult('sess-1', 'researcher-c1')
    ).resolves.toEqual({
      file: 'researcher-c1.md',
      path: '/tmp/subagents/researcher-c1.md',
    })
    expect(subagentResultReserve).toHaveBeenCalledWith('sess-1', 'researcher-c1')
  })

  it('fills the claimed file by name', async () => {
    subagentResultFill.mockResolvedValue(undefined)
    const { fillSubagentResult } = await import('../agentTools')
    await expect(
      fillSubagentResult('sess-1', 'researcher-c1.md', 'findings')
    ).resolves.toBe(true)
    expect(subagentResultFill).toHaveBeenCalledWith(
      'sess-1',
      'researcher-c1.md',
      'findings'
    )
  })

  /// A value, not a throw: the caller falls back to delivering the answer
  /// inline, which is what a web build with no scratch has to do anyway.
  it('reports failure rather than throwing when there is no scratch', async () => {
    subagentResultReserve.mockRejectedValue(new Error('no scratch'))
    subagentResultFill.mockRejectedValue(new Error('no scratch'))
    const { reserveSubagentResult, fillSubagentResult } = await import(
      '../agentTools'
    )
    await expect(reserveSubagentResult('s', 'id')).resolves.toBeNull()
    await expect(fillSubagentResult('s', 'id.md', 'x')).resolves.toBe(false)
  })
})
