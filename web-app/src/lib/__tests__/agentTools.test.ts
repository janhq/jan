import { beforeEach, describe, expect, it, vi } from 'vitest'

const toolSchemas = vi.fn()
const executeTool = vi.fn()
const threadWorkspaceDelete = vi.fn()
const threadWorkspaceSweep = vi.fn()
const sandboxStatus = vi.fn()
const getJanDataFolder = vi.fn()

vi.mock('@janhq/tauri-plugin-agent-tools-api', () => ({
  toolSchemas: () => toolSchemas(),
  executeTool: (...args: unknown[]) => executeTool(...args),
  threadWorkspaceDelete: (...args: unknown[]) => threadWorkspaceDelete(...args),
  threadWorkspaceSweep: (...args: unknown[]) => threadWorkspaceSweep(...args),
  sandboxStatus: () => sandboxStatus(),
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
    getJanDataFolder.mockReset().mockResolvedValue('/data')
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

  it('passes the network setting through to the plugin', async () => {
    executeTool.mockResolvedValue({ content: '', diff: null, isError: false })
    const { useAgentToolsConfig } = await import('@/hooks/useAgentToolsConfig')
    const { executeAgentTool } = await import('../agentTools')

    await executeAgentTool('bash', { command: 'ls' }, 'thread-1')
    expect(executeTool).toHaveBeenLastCalledWith(
      '/data',
      'thread-1',
      'bash',
      { command: 'ls' },
      undefined,
      undefined,
      false
    )

    useAgentToolsConfig.getState().setBashNetworkEnabled(true)
    await executeAgentTool('bash', { command: 'ls' }, 'thread-1')
    expect(executeTool).toHaveBeenLastCalledWith(
      '/data',
      'thread-1',
      'bash',
      { command: 'ls' },
      undefined,
      undefined,
      true
    )
    useAgentToolsConfig.getState().setBashNetworkEnabled(false)
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
  it('scopes execution to the calling thread and passes no project path', async () => {
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
      false
    )
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
      false
    )
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
})
