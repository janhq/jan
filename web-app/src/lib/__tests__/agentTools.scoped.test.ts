import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConversationCapabilities } from '../conversationCapabilities'

// Independent native boundaries: never map scoped dispatch back to executeTool.
const mocks = vi.hoisted(() => ({
  executeThreadTool: vi.fn(), executeTool: vi.fn(), getJanDataFolder: vi.fn(),
  getState: vi.fn(), getConversationCapabilities: vi.fn(),
  persisted: undefined as unknown, overlay: undefined as unknown,
}))
vi.mock('@janhq/tauri-plugin-agent-tools-api', () => ({
  executeThreadTool: mocks.executeThreadTool,
  executeTool: mocks.executeTool,
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ app: () => ({ getJanDataFolder: mocks.getJanDataFolder }) }),
}))
vi.mock('@/hooks/useThreads', () => ({ useThreads: { getState: mocks.getState } }))
const livePlan = vi.hoisted(() => ({ on: false }))
vi.mock('@/hooks/useChatPlan', () => ({ chatPlanEnabled: () => livePlan.on }))

import { executeAgentTool } from '../agentTools'

const granted = {
  version: 1, folderScope: { path: '/explicit/folder', access: 'write' },
  shellNetwork: true, memoryWrite: true,
} as const
const threadId = 'isolated-verifier-thread'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('executeAgentTool production scoped entry (independent native mocks)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.persisted = granted
    mocks.overlay = undefined
    mocks.executeThreadTool.mockReset().mockResolvedValue({ content: 'scoped output', isError: false })
    mocks.executeTool.mockReset().mockResolvedValue({ content: 'legacy output', isError: false })
    mocks.getJanDataFolder.mockReset().mockResolvedValue('/isolated/verifier-data')
    mocks.getConversationCapabilities.mockReset().mockImplementation(() => mocks.overlay ?? mocks.persisted)
    mocks.getState.mockReset().mockImplementation(() => ({ getConversationCapabilities: mocks.getConversationCapabilities }))
  })

  it('reads the overlay-aware getter anew for each call, only after async setup', async () => {
    const firstSetup = deferred<string>()
    mocks.getJanDataFolder.mockReturnValueOnce(firstSetup.promise)
    const first = executeAgentTool('shell', { command: 'echo scratch' }, threadId)
    expect(mocks.getState).not.toHaveBeenCalled()
    expect(mocks.getConversationCapabilities).not.toHaveBeenCalled()
    mocks.overlay = defaultConversationCapabilities()
    firstSetup.resolve('/isolated/verifier-data')
    await expect(first).resolves.toMatchObject({ content: 'scoped output' })
    expect(mocks.executeThreadTool).toHaveBeenLastCalledWith(threadId, 'shell', { command: 'echo scratch' }, defaultConversationCapabilities(), false)

    const secondSetup = deferred<string>()
    mocks.getJanDataFolder.mockReturnValueOnce(secondSetup.promise)
    const second = executeAgentTool('shell', {}, threadId)
    expect(mocks.getConversationCapabilities).toHaveBeenCalledTimes(1)
    mocks.overlay = granted
    secondSetup.resolve('/isolated/verifier-data')
    await second
    expect(mocks.executeThreadTool).toHaveBeenLastCalledWith(threadId, 'shell', {}, granted, false)
    expect(mocks.getState).toHaveBeenCalledTimes(2)
    expect(mocks.getConversationCapabilities.mock.calls).toEqual([[threadId], [threadId]])
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('immediately denies memory after a pending then failed revoke despite stale persisted consent', async () => {
    await expect(executeAgentTool('memory', { op: 'write', name: 'test', content: 'note' }, threadId)).resolves.toMatchObject({ content: 'scoped output' })
    mocks.executeThreadTool.mockClear()
    // Model the useThreads contract: revoke overlay is synchronous; disk can remain granted.
    const persistence = deferred<void>()
    const save = vi.fn(() => { mocks.overlay = defaultConversationCapabilities(); return persistence.promise })
    const saving = save().catch(() => undefined)
    await expect(executeAgentTool('memory', { op: 'write' }, threadId)).resolves.toEqual({ error: expect.stringContaining('durable memory') })
    persistence.reject(new Error('isolated persistence failure'))
    await saving
    expect(mocks.persisted).toEqual(granted)
    await expect(executeAgentTool('memory', { op: 'delete' }, threadId)).resolves.toEqual({ error: expect.stringContaining('durable memory') })
    expect(mocks.executeThreadTool).not.toHaveBeenCalled()
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('keeps shell scratch dispatch while narrowing folder/network; ignores forged legacy caller flags', async () => {
    mocks.overlay = defaultConversationCapabilities()
    await expect(executeAgentTool('shell', { command: 'echo scratch' }, threadId, '/forged/project', 'thread', true, true, '/forged/skills')).resolves.toMatchObject({ content: 'scoped output' })
    expect(mocks.executeThreadTool.mock.calls).toEqual([[threadId, 'shell', { command: 'echo scratch' }, defaultConversationCapabilities(), false]])
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('keeps temporary-chat default shell on dedicated IPC without forged legacy elevation or mutations', async () => {
    mocks.persisted = defaultConversationCapabilities()
    await expect(executeAgentTool('shell', { command: 'printf temporary-scratch' }, 'temporary-chat', '/forged/project', 'thread', true, true, '/forged/skills')).resolves.toMatchObject({ content: 'scoped output' })
    expect(mocks.getConversationCapabilities).toHaveBeenCalledExactlyOnceWith('temporary-chat')
    expect(mocks.executeThreadTool).toHaveBeenCalledExactlyOnceWith('temporary-chat', 'shell', { command: 'printf temporary-scratch' }, defaultConversationCapabilities(), false)
    mocks.executeThreadTool.mockClear()
    for (const name of ['memory', 'skill_write']) {
      await expect(executeAgentTool(name, { op: 'write', memoryWrite: true, effectiveGrant: granted }, 'temporary-chat', '/forged/project', 'thread', true, true, '/forged/skills')).resolves.toEqual({ error: expect.stringContaining('durable memory') })
    }
    expect(mocks.executeThreadTool).not.toHaveBeenCalled()
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('takes the exact explicit grant, not the caller-selected folder or network flags', async () => {
    mocks.overlay = { ...granted, folderScope: { path: '/explicit/read-only', access: 'read' }, shellNetwork: false }
    await executeAgentTool('read', { path: 'example.txt' }, threadId, '/forged', 'thread', true, true, '/forged/skills')
    expect(mocks.executeThreadTool).toHaveBeenCalledExactlyOnceWith(threadId, 'read', { path: 'example.txt' }, mocks.overlay, false)
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it.each(['memory', 'skill_write'])('ignores forged memoryWrite in %s input', async (name) => {
    mocks.overlay = defaultConversationCapabilities()
    await expect(executeAgentTool(name, { op: 'write', memoryWrite: true, effectiveGrant: granted }, threadId)).resolves.toEqual({ error: expect.stringContaining('durable memory') })
    expect(mocks.executeThreadTool).not.toHaveBeenCalled()
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it.each(['view', 'search'])('keeps memory %s recall after revoke', async (op) => {
    mocks.overlay = defaultConversationCapabilities()
    await executeAgentTool('memory', { op }, threadId)
    expect(mocks.executeThreadTool).toHaveBeenCalledExactlyOnceWith(threadId, 'memory', { op }, defaultConversationCapabilities(), false)
  })

  it('preserves Cowork session legacy arguments without reading Chat authority', async () => {
    await expect(executeAgentTool('shell', { command: 'echo session' }, 'cowork-session', '/cowork/folder', 'session', true, true, '/cowork/skills', undefined, undefined, () => false)).resolves.toMatchObject({ content: 'legacy output' })
    expect(mocks.executeTool).toHaveBeenCalledExactlyOnceWith('/isolated/verifier-data', 'cowork-session', 'shell', { command: 'echo session' }, '/cowork/skills', undefined, true, '/cowork/folder', true, 'session', undefined, false)
    expect(mocks.executeThreadTool).not.toHaveBeenCalled()
    expect(mocks.getState).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'isError', 'getter', 'setup', 'no-data', 'unknown-tool'])('fails closed on %s without falling back to legacy', async (failure) => {
    let name = 'shell'
    if (failure === 'rejected') mocks.executeThreadTool.mockRejectedValueOnce(new Error('native denied'))
    if (failure === 'isError') mocks.executeThreadTool.mockResolvedValueOnce({ isError: true, content: 'native denied' })
    if (failure === 'getter') mocks.getConversationCapabilities.mockImplementationOnce(() => { throw new Error('getter failed') })
    if (failure === 'setup') mocks.getJanDataFolder.mockRejectedValueOnce(new Error('setup failed'))
    if (failure === 'no-data') mocks.getJanDataFolder.mockResolvedValueOnce(null)
    if (failure === 'unknown-tool') name = 'task'
    const result = await executeAgentTool(name, {}, threadId)
    expect(result.error).toEqual(expect.any(String))
    expect(result).not.toHaveProperty('content')
    expect(mocks.executeTool).not.toHaveBeenCalled()
    if (!['rejected', 'isError'].includes(failure)) expect(mocks.executeThreadTool).not.toHaveBeenCalled()
  })

  it('malformed grant narrows the complete shell request instead of partially salvaging consent', async () => {
    mocks.overlay = { ...granted, extra: true }
    await executeAgentTool('shell', {}, threadId)
    expect(mocks.executeThreadTool).toHaveBeenCalledExactlyOnceWith(threadId, 'shell', {}, defaultConversationCapabilities(), false)
  })

  it('preserves diff and images from dedicated native results', async () => {
    const images = [{ mimeType: 'image/png', base64: 'isolated-fixture' }]
    mocks.executeThreadTool.mockResolvedValueOnce({ content: 'edited', diff: '--- a\n+++ b\n', images, isError: false })
    await expect(executeAgentTool('edit', { path: 'scratch.txt' }, threadId)).resolves.toEqual({ content: 'edited', diff: '--- a\n+++ b\n', images })
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  describe('effectiveGrantCeiling (classification-time upper bound)', () => {
    const call = (name: string, ceiling: unknown, args: Record<string, unknown> = {}) =>
      executeAgentTool(name, args, threadId, undefined, 'thread', false, false, undefined, ceiling)

    it('keeps a call classified under the default grant denied after the grant widens', async () => {
      mocks.overlay = granted // widened after classification
      await expect(call('memory', defaultConversationCapabilities(), { op: 'write' })).resolves.toEqual({ error: expect.stringContaining('durable memory') })
      expect(mocks.executeThreadTool).not.toHaveBeenCalled()
      await call('shell', defaultConversationCapabilities(), { command: 'echo scratch' })
      expect(mocks.executeThreadTool).toHaveBeenCalledExactlyOnceWith(threadId, 'shell', { command: 'echo scratch' }, defaultConversationCapabilities(), false)
    })

    it('does not auto-expand a scratch call when folder is granted after classification', async () => {
      mocks.overlay = { ...granted, folderScope: { path: '/late/folder', access: 'write' } }
      await call('read', defaultConversationCapabilities(), { path: 'a.txt' })
      expect(mocks.executeThreadTool.mock.calls[0][3]).toEqual(defaultConversationCapabilities())
    })

    it('permits the granted call when current equals the ceiling', async () => {
      mocks.overlay = granted
      await expect(call('memory', granted, { op: 'write' })).resolves.toMatchObject({ content: 'scoped output' })
      expect(mocks.executeThreadTool.mock.calls[0][3]).toEqual(granted)
    })

    it('still narrows on revoke after a granted classification', async () => {
      mocks.overlay = defaultConversationCapabilities()
      await expect(call('memory', granted, { op: 'write' })).resolves.toEqual({ error: expect.stringContaining('durable memory') })
      expect(mocks.executeThreadTool).not.toHaveBeenCalled()
    })

    it('intersects folder path and access, network and memory', async () => {
      mocks.overlay = { ...granted, folderScope: { path: '/explicit/folder', access: 'read' } }
      await call('shell', granted, {})
      expect(mocks.executeThreadTool.mock.calls[0][3]).toEqual({ ...granted, folderScope: { path: '/explicit/folder', access: 'read' } })
      mocks.executeThreadTool.mockClear()
      mocks.overlay = { ...granted, folderScope: { path: '/other', access: 'write' }, shellNetwork: false }
      await call('shell', granted, {})
      expect(mocks.executeThreadTool.mock.calls[0][3]).toEqual({ ...defaultConversationCapabilities(), memoryWrite: true })
    })

    it('treats a malformed ceiling as the default', async () => {
      mocks.overlay = granted
      await call('shell', { ...granted, extra: 1 }, {})
      expect(mocks.executeThreadTool.mock.calls[0][3]).toEqual(defaultConversationCapabilities())
    })
  })

  describe('effective run-latched Plan crosses the native boundary', () => {
    const planArg = () => mocks.executeThreadTool.mock.calls.at(-1)?.[4]
    beforeEach(() => { livePlan.on = false; mocks.overlay = granted })

    it('is false for a normal run, even for an allowed read with a write grant', async () => {
      await executeAgentTool('read', { path: 'a.txt' }, threadId)
      expect(planArg()).toBe(false)
      await executeAgentTool('read', { path: 'a.txt' }, threadId, undefined, 'thread', false, false, undefined, undefined, undefined, () => false)
      expect(planArg()).toBe(false)
    })

    it('carries the run latch even after the live toolbar is switched off', async () => {
      livePlan.on = false
      await executeAgentTool('read', { path: 'a.txt' }, threadId, undefined, 'thread', false, false, undefined, undefined, undefined, () => true)
      expect(planArg()).toBe(true)
    })

    it('late-enabled live Plan tightens a call whose run snapshot is not yet latched', async () => {
      livePlan.on = true
      await executeAgentTool('read', { path: 'a.txt' }, threadId, undefined, 'thread', false, false, undefined, undefined, undefined, () => false)
      expect(planArg()).toBe(true)
      await executeAgentTool('read', { path: 'a.txt' }, threadId)
      expect(planArg()).toBe(true)
    })

    it('reads Plan at dispatch, after async setup and approval-time changes', async () => {
      const setup = deferred<string>()
      mocks.getJanDataFolder.mockReturnValueOnce(setup.promise)
      let latched = false
      const call = executeAgentTool('read', { path: 'a.txt' }, threadId, undefined, 'thread', false, false, undefined, undefined, undefined, () => latched)
      latched = true // Plan enabled while the call was waiting
      setup.resolve('/isolated/verifier-data')
      await call
      expect(planArg()).toBe(true)
    })

    it('reviewed Execute transition (latch and live both cleared) sends false', async () => {
      let latched = true
      livePlan.on = true
      await executeAgentTool('read', { path: 'a.txt' }, threadId, undefined, 'thread', false, false, undefined, undefined, undefined, () => latched)
      expect(planArg()).toBe(true)
      latched = false
      livePlan.on = false
      await executeAgentTool('read', { path: 'a.txt' }, threadId, undefined, 'thread', false, false, undefined, undefined, undefined, () => latched)
      expect(planArg()).toBe(false)
    })

    const session = (planActive?: () => boolean) =>
      executeAgentTool('read', {}, 'cowork-session', '/cowork/folder', 'session', false, true, undefined, undefined, undefined, planActive)
    const sessionPlanArg = () => mocks.executeTool.mock.calls[0][11]

    it('legacy session path ignores the live Chat toolbar and sends only the run-latched Plan', async () => {
      livePlan.on = true
      await session(() => false)
      expect(mocks.executeThreadTool).not.toHaveBeenCalled()
      expect(mocks.executeTool).toHaveBeenCalledTimes(1)
      expect(sessionPlanArg()).toBe(false)
    })

    it('legacy session path sends true when the run latched Plan', async () => {
      livePlan.on = false
      await session(() => true)
      expect(sessionPlanArg()).toBe(true)
    })

    it('legacy session path reads the latch at dispatch, after async setup', async () => {
      const setup = deferred<string>()
      mocks.getJanDataFolder.mockReturnValueOnce(setup.promise)
      let latched = false
      const call = session(() => latched)
      latched = true
      setup.resolve('/isolated/verifier-data')
      await call
      expect(sessionPlanArg()).toBe(true)
    })

    it('legacy session path with no planActive fails closed without native IPC', async () => {
      livePlan.on = false
      const result = await session()
      expect(result).toEqual({ error: expect.stringContaining('planActive is required') })
      expect(mocks.executeTool).not.toHaveBeenCalled()
      expect(mocks.executeThreadTool).not.toHaveBeenCalled()
      expect(mocks.getJanDataFolder).not.toHaveBeenCalled()
    })
  })
})
