import { Chat } from '@ai-sdk/react'
import { trackChat, observeChatWork, __resetChatCloseForTests } from '@/lib/chatClose'
import { flushMessageWrites, __resetMessageWritesForTests, useMessages } from '@/hooks/useMessages'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

type Json = Record<string, any>

const backend = vi.hoisted(() => {
  const settings = new Map<string, string>()
  const threads = new Map<string, any>()
  const extras = new Map<string, any>()
  const log: string[] = []
  const invoke = async (cmd: string, args: Record<string, any> = {}) => {
    log.push(cmd)
    switch (cmd) {
      case 'settings_get':
        return settings.get(args.key) ?? null
      case 'settings_set':
        settings.set(args.key, args.value)
        return
      case 'settings_remove':
        settings.delete(args.key)
        return
      case 'list_threads':
        return [...threads.values()].map((t) => JSON.parse(JSON.stringify(t)))
      case 'write_thread_extra':
        if (!args.create && !threads.has(args.threadId)) throw new Error('no thread.json')
        extras.set(args.threadId, JSON.parse(JSON.stringify(args.value)))
        return
      case 'read_thread_extra':
        return extras.get(args.threadId) ?? null
      case 'create_thread':
        if (threads.has(args.thread.id)) return threads.get(args.thread.id)
        threads.set(args.thread.id, JSON.parse(JSON.stringify(args.thread)))
        return args.thread
      case 'modify_thread':
        threads.set(args.thread.id, JSON.parse(JSON.stringify(args.thread)))
        return
      case 'delete_thread':
        threads.delete(args.threadId)
        extras.delete(args.threadId)
        return
      default:
        throw new Error(`unexpected ${cmd}`)
    }
  }
  return { settings, threads, extras, log, invoke }
})

const chatStorage = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue(undefined), modify: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) }))
const updateChatThread = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({ invoke: backend.invoke }),
    messages: () => ({ createMessage: chatStorage.create, modifyMessage: chatStorage.modify, deleteMessage: chatStorage.remove }),
    threads: () => ({ updateThread: updateChatThread }),
    projects: () => ({ getProjects: async () => [], deleteProject: async () => {} }),
  }),
}))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => true }))
const agentTools = vi.hoisted(() => ({
  cleanupThreadWorkspace: vi.fn().mockResolvedValue(undefined),
  sweepSessionWorkspaces: vi.fn().mockResolvedValue(0),
  cancelAgentThreadBash: vi.fn().mockResolvedValue(undefined),
  stopAgentSessionMonitors: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/agentTools', () => agentTools)
const sonner = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast: sonner }))
const closeWindow = vi.hoisted(() => ({ callback: null as null | ((event: { preventDefault: () => void }) => Promise<void>) }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: vi.fn(async (callback) => {
    closeWindow.callback = callback
    return () => {}
  }) }),
}))

import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { registerCoworkRunForClose, isCoworkClosing } from '@/hooks/useCoworkRun'
import { useThreads } from '@/hooks/useThreads'
import { updateThreadProject } from '../threadProject'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import {
  startCoworkSync,
  flushCowork,
  flushCoworkDeletes,
  flushCoworkStartupWarnings,
  isCoworkMigrationDone,
  __resetCoworkSyncForTests,
} from '../coworkSync'
import { CODE_SESSIONS_KEY, COWORK_DELETED_IDS_KEY, COWORK_MIGRATION_FLAG_KEY } from '../migrateCoworkSessions'

const legacy = (id: string): Json => ({
  id,
  title: 'Legacy ' + id,
  folder: null,
  turns: [{ role: 'user', content: 'hi' }],
  messages: [{ id: 'm', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
  updated: 1_700_000_000_000,
})

describe('coworkSync startup', () => {
  beforeEach(() => {
    __resetChatCloseForTests()
    __resetMessageWritesForTests()
    useMessages.setState({ messages: {} })
    chatStorage.create.mockReset().mockResolvedValue(undefined)
    backend.settings.clear()
    backend.threads.clear()
    backend.extras.clear()
    backend.log.length = 0
    agentTools.cleanupThreadWorkspace.mockClear()
    agentTools.sweepSessionWorkspaces.mockClear()
    sonner.warning.mockClear()
    sonner.error.mockClear()
    sonner.dismiss.mockClear()
    __resetCoworkSyncForTests()
    useCoworkSessions.setState({ sessions: [], currentId: null })
    useThreads.setState({ threads: {} })
  })

  it('migrates legacy sessions into threads, then loads them into the store', async () => {
    backend.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({ state: { sessions: [legacy('a'), legacy('b')] }, version: 1 })
    )
    await startCoworkSync()
    expect(backend.threads.get('a')!.metadata.mode).toBe('cowork')
    expect(useCoworkSessions.getState().sessions.map((s) => s.id).sort()).toEqual(['a', 'b'])
    expect(backend.settings.get(COWORK_MIGRATION_FLAG_KEY)).toBe('true')
    expect(isCoworkMigrationDone()).toBe(true)
    // The legacy blob is left in place for rollback.
    expect(backend.settings.has(CODE_SESSIONS_KEY)).toBe(true)
    // Cowork threads reach the shared thread list (search, sidebar).
    expect(useThreads.getState().threads['a']).toBeTruthy()
  })

  it('loading does not write anything back', async () => {
    backend.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({ state: { sessions: [legacy('a')] }, version: 1 })
    )
    await startCoworkSync()
    backend.log.length = 0
    await flushCowork()
    expect(backend.log).not.toContain('create_thread')
    expect(backend.log).not.toContain('modify_thread')
    expect(backend.log.filter((c) => c === 'write_thread_extra')).toHaveLength(0)
  })

  it('stable path: no data, marker set, nothing written, no sweep', async () => {
    await startCoworkSync()
    expect(backend.settings.get(COWORK_MIGRATION_FLAG_KEY)).toBe('true')
    expect(backend.threads.size).toBe(0)
    expect(agentTools.sweepSessionWorkspaces).not.toHaveBeenCalled()
  })

  it('writes a mutation through to the thread and sidecar', async () => {
    await startCoworkSync()
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions
      .getState()
      .commitTurns(id, [{ role: 'user', content: 'hello' }], [], [])
    await flushCowork()
    expect(backend.threads.get(id)!.metadata.mode).toBe('cowork')
    expect(backend.extras.get(id).turns[0].content).toBe('hello')
    expect(useThreads.getState().threads[id]).toBeTruthy()
  })

  it('close awaits a background run commit before flushing its first question and partial response', async () => {
    await startCoworkSync()
    const id = useCoworkSessions.getState().createSession()
    // The active closure owns these, just like runRequest; none is in the
    // durable session yet. A different viewed session must not affect close.
    useCoworkSessions.getState().createSession()
    const turns = [
      { role: 'user' as const, content: 'write the file' },
      { role: 'tool' as const, content: '', callId: 'write-1', name: 'write', args: { path: 'a.txt' }, status: 'done' as const, result: 'written' },
      { role: 'assistant' as const, content: 'I wrote the file and' },
    ]
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'write the file' }] },
      { id: 'a1', role: 'assistant', parts: [
        { type: 'dynamic-tool', toolName: 'write', toolCallId: 'write-1', state: 'output-available', input: { path: 'a.txt' }, output: 'written' },
        { type: 'text', text: 'I wrote the file and' },
      ] },
    ] as any
    let finish!: () => void
    const completed = new Promise<void>((resolve) => { finish = resolve })
    const stop = vi.fn(async () => {
      await completed
      useCoworkSessions.getState().commitTurns(id, turns, messages, [])
    })
    const unregister = registerCoworkRunForClose(stop)
    const closing = closeWindow.callback!({ preventDefault: vi.fn() })
    expect(stop).toHaveBeenCalledOnce()
    expect(isCoworkClosing()).toBe(true)
    expect(backend.extras.has(id)).toBe(false)
    finish()
    await closing
    unregister()
    expect(backend.extras.get(id).turns).toEqual(turns)
    expect(backend.extras.get(id).messages).toEqual(messages)

    // Reload through the real persistence adapter, not the in-memory store.
    __resetCoworkSyncForTests()
    useCoworkSessions.setState({ sessions: [], currentId: null })
    await startCoworkSync()
    const reloaded = useCoworkSessions.getState().sessions.find((s) => s.id === id)!
    expect(reloaded.turns).toEqual(turns)
    expect(reloaded.messages).toEqual(messages)
  })

  it('native close handler holds BOTH ordinary Chat finalization/write and Cowork commit', async () => {
    await startCoworkSync()
    let finishChat!: () => void
    let finishCowork!: () => void
    let finishWrite!: () => void
    const pending = new Set<Promise<unknown>>()
    const chat = new Chat({})
    trackChat(chat, pending)
    const chatDone = new Promise<void>((resolve) => { finishChat = resolve })
    const coworkDone = new Promise<void>((resolve) => { finishCowork = resolve })
    const writeDone = new Promise<void>((resolve) => { finishWrite = resolve })
    chatStorage.create.mockImplementation(async () => writeDone)
    observeChatWork(pending, async () => {
      await chatDone
      useMessages.getState().addMessage({ id: 'partial', thread_id: 'ordinary', content: [] } as any)
    })
    const unregister = registerCoworkRunForClose(() => coworkDone)
    const preventDefault = vi.fn()
    let destroyed = false
    const closing = closeWindow.callback!({ preventDefault }).then(() => { destroyed = !preventDefault.mock.calls.length })
    finishCowork(); await Promise.resolve(); expect(destroyed).toBe(false)
    finishChat(); await vi.waitFor(() => expect(chatStorage.create).toHaveBeenCalled())
    expect(destroyed).toBe(false)
    finishWrite(); await closing
    expect(destroyed).toBe(true)
    unregister()
  })

  it('native close drains a recovered background write on the FIRST close instead of failing it', async () => {
    await startCoworkSync()
    chatStorage.create.mockRejectedValueOnce(new Error('disk full'))
    useMessages.getState().addMessage({ id: 'partial', thread_id: 'ordinary', content: [] } as any)
    await Promise.resolve(); await Promise.resolve()
    // Storage recovered after the background failure: the close must retry the
    // queued head and succeed, not re-throw the stale recorded error.
    const first = vi.fn()
    await closeWindow.callback!({ preventDefault: first })
    expect(first).not.toHaveBeenCalled()
    expect(chatStorage.create).toHaveBeenCalledTimes(2)
  })

  it('native close handler prevents destroy while the write still fails, then a later close retries', async () => {
    await startCoworkSync()
    chatStorage.create.mockRejectedValue(new Error('disk full'))
    useMessages.getState().addMessage({ id: 'partial', thread_id: 'ordinary', content: [] } as any)
    await Promise.resolve(); await Promise.resolve()
    const first = vi.fn()
    await closeWindow.callback!({ preventDefault: first })
    expect(first).toHaveBeenCalledOnce()
    chatStorage.create.mockResolvedValue(undefined)
    const second = vi.fn()
    await closeWindow.callback!({ preventDefault: second })
    expect(second).not.toHaveBeenCalled()
  })

  it.each([true, false])('project reassignment survives later writes and project deletion (move=%s)', async (move) => {
    await startCoworkSync()
    const id = useCoworkSessions.getState().createSession()
    const projectA = { id: 'A', name: 'A', updated_at: 1 }
    const projectB = { id: 'B', name: 'B', updated_at: 2, assistantId: 'assistant-b' }
    useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'hello' }], [], [])
    updateThreadProject(id, projectA)
    await flushCowork()

    updateThreadProject(id, move ? projectB : undefined)
    expect(useCoworkSessions.getState().sessions.find((s) => s.id === id)?.project).toEqual(move ? projectB : undefined)
    expect(useThreads.getState().threads[id].metadata?.project).toEqual(move ? projectB : undefined)
    // Delete before the persistence debounce: authoritative state must win.
    await useThreads.getState().deleteAllThreadsByProject('A')
    expect(useCoworkSessions.getState().sessions.some((s) => s.id === id)).toBe(true)
    useCoworkSessions.getState().setTitle(id, 'Later mutation')
    await flushCowork()
    expect(backend.threads.get(id)?.metadata.project).toEqual(move ? projectB : undefined)
    expect(useThreads.getState().threads[id].metadata?.project).toEqual(move ? projectB : undefined)
    await useThreads.getState().deleteAllThreadsByProject('A')
    expect(backend.threads.has(id)).toBe(true)
    await useThreads.getState().deleteAllThreadsByProject('B')
    expect(backend.threads.has(id)).toBe(!move)
    expect(useCoworkSessions.getState().sessions.some((s) => s.id === id)).toBe(!move)
  })

  it('deleting a project without conversations detaches authoritative sessions, not stale mirrors', async () => {
    await startCoworkSync()
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'hello' }], [], [])
    const projectA = { id: 'A', name: 'A', updated_at: 1 }
    const projectB = { id: 'B', name: 'B', updated_at: 2 }
    updateThreadProject(id, projectA)
    await flushCowork()
    updateThreadProject(id, projectB)
    // Simulate a lagging mirror: project deletion must still consult the session.
    useThreads.setState((state) => ({ threads: {
      ...state.threads,
      [id]: { ...state.threads[id], metadata: { mode: 'cowork', project: projectA } },
    } }))
    const { result } = renderHook(() => useThreadManagement())
    await act(async () => { await result.current.deleteFolder('A') })
    expect(useCoworkSessions.getState().sessions.find((s) => s.id === id)?.project).toEqual(projectB)
    await act(async () => { await result.current.deleteFolder('B') })
    expect(useCoworkSessions.getState().sessions.find((s) => s.id === id)?.project).toBeUndefined()
    expect(useThreads.getState().threads[id].metadata?.project).toBeUndefined()
    await flushCowork()
    expect(backend.threads.get(id)?.metadata.project).toBeUndefined()
    expect(backend.threads.has(id)).toBe(true)
  })

  it('keeps Chat assignment on the normal thread update path', () => {
    useThreads.getState().setThreads([{ id: 'chat', title: 'Chat', metadata: { custom: 'keep' } } as unknown as Thread])
    const project = { id: 'B', name: 'B', updated_at: 2 }
    updateThreadProject('chat', project)
    expect(useThreads.getState().threads.chat.metadata).toEqual({ custom: 'keep', project })
    expect(updateChatThread).toHaveBeenCalledWith(expect.objectContaining({ id: 'chat', metadata: { custom: 'keep', project } }))
    updateThreadProject('chat', undefined)
    expect(useThreads.getState().threads.chat.metadata?.project).toBeUndefined()
    expect(useCoworkSessions.getState().sessions).toEqual([])
  })

  it('deleting a session deletes its thread and its session sandbox', async () => {
    await startCoworkSync()
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'x' }], [], [])
    await flushCowork()
    useCoworkSessions.getState().deleteSession(id)
    await vi.waitFor(() => expect(backend.threads.has(id)).toBe(false))
    expect(agentTools.cleanupThreadWorkspace).toHaveBeenCalledWith(id, 'session')
    expect(useThreads.getState().threads[id]).toBeUndefined()
  })

  it('a partial migration keeps legacy sessions visible and does not sweep sandboxes', async () => {
    backend.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({ state: { sessions: [legacy('a')] }, version: 1 })
    )
    const failing = backend.invoke
    // Make the first thread create fail so the migration is partial.
    const orig = backend.invoke
    let failed = false
    ;(backend as any).invoke = async (cmd: string, args: any) => {
      if (cmd === 'create_thread' && !failed) {
        failed = true
        throw new Error('disk full')
      }
      return orig(cmd, args)
    }
    void failing
    await startCoworkSync()
    expect(useCoworkSessions.getState().sessions.map((s) => s.id)).toEqual(['a'])
    expect(backend.settings.has(COWORK_MIGRATION_FLAG_KEY)).toBe(false)
    expect(agentTools.sweepSessionWorkspaces).not.toHaveBeenCalled()
  })

  it('sessions created before hydration finishes survive the merge', async () => {
    backend.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({ state: { sessions: [legacy('a')] }, version: 1 })
    )
    const early = useCoworkSessions.getState().createSession()
    await startCoworkSync()
    const ids = useCoworkSessions.getState().sessions.map((s) => s.id)
    expect(ids).toContain(early)
    expect(ids).toContain('a')
  })

  it('warns the user persistently on every launch while the deletion journal is unreadable', async () => {
    backend.settings.set(COWORK_DELETED_IDS_KEY, '{corrupt')
    backend.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({ state: { sessions: [legacy('hidden')] }, version: 1 })
    )
    await startCoworkSync()
    // Fail closed: the legacy session stays hidden, never auto-resurrected,
    // and the corrupt journal bytes are left exactly as they were.
    expect(useCoworkSessions.getState().sessions.some((s) => s.id === 'hidden')).toBe(false)
    expect(backend.settings.get(COWORK_DELETED_IDS_KEY)).toBe('{corrupt')
    expect(backend.settings.get(COWORK_MIGRATION_FLAG_KEY)).toBeUndefined()
    // ...but never silently: a persistent warning with recovery instructions.
    expect(sonner.warning).toHaveBeenCalledTimes(1)
    expect(sonner.warning.mock.calls[0][1]).toMatchObject({ duration: Infinity })
    expect(sonner.warning.mock.calls[0][1].description).toContain('cowork_deleted_ids')
    // The blocked-deletion claim covers ALL Cowork conversations, not only
    // imported ones: every removal records intent while migration is unsettled.
    expect(sonner.warning.mock.calls[0][1].description).toContain('any Cowork conversation')
    // Manual recovery must say to quit first: the settings store rewrites the
    // whole file from memory (debounced + exit flush), clobbering live edits.
    expect(sonner.warning.mock.calls[0][1].description).toContain('quit Jan completely')
    // The warning repeats on the next launch until the journal is repaired.
    __resetCoworkSyncForTests()
    useCoworkSessions.setState({ sessions: [], currentId: null })
    await startCoworkSync()
    expect(sonner.warning).toHaveBeenCalledTimes(2)
    // A healthy journal raises no warning and merges the blob again.
    backend.settings.set(COWORK_DELETED_IDS_KEY, JSON.stringify([]))
    __resetCoworkSyncForTests()
    useCoworkSessions.setState({ sessions: [], currentId: null })
    await startCoworkSync()
    expect(sonner.warning).toHaveBeenCalledTimes(2)
    expect(useCoworkSessions.getState().sessions.some((s) => s.id === 'hidden')).toBe(true)
  })

  it('a corrupt journal with nothing to migrate raises no warning and blocks nothing', async () => {
    backend.settings.set(COWORK_DELETED_IDS_KEY, '{corrupt')
    await startCoworkSync()
    // No legacy data ⇒ the corrupt journal protects nothing: no false
    // warning, migration settles, and normal deletion flows stay unblocked.
    expect(sonner.warning).not.toHaveBeenCalled()
    expect(backend.settings.get(COWORK_MIGRATION_FLAG_KEY)).toBe('true')
    expect(isCoworkMigrationDone()).toBe(true)
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'x' }], [], [])
    await flushCowork()
    useCoworkSessions.getState().deleteSession(id)
    await vi.waitFor(() => expect(backend.threads.has(id)).toBe(false))
    // The corrupt value itself is still never rewritten.
    expect(backend.settings.get(COWORK_DELETED_IDS_KEY)).toBe('{corrupt')
  })

  it('the post-mount flush re-raises the journal warning with the same id, and only while it applies', async () => {
    // Before any start (or after reset) there is nothing to flush.
    flushCoworkStartupWarnings()
    expect(sonner.warning).not.toHaveBeenCalled()
    backend.settings.set(COWORK_DELETED_IDS_KEY, '{corrupt')
    // A mergeable legacy session must exist: the journal (and therefore the
    // warning) only matters when there is something it could protect.
    backend.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({ state: { sessions: [legacy('pending')] }, version: 1 })
    )
    await startCoworkSync()
    expect(sonner.warning).toHaveBeenCalledTimes(1)
    // The Toaster host mounts after startup gates: the flush re-raises the
    // same stable-id warning (sonner drops the pre-mount one).
    flushCoworkStartupWarnings()
    expect(sonner.warning).toHaveBeenCalledTimes(2)
    expect(sonner.warning.mock.calls[1][1].id).toBe(sonner.warning.mock.calls[0][1].id)
    // A later healthy start clears the pending warning: flush becomes a no-op.
    backend.settings.set(COWORK_DELETED_IDS_KEY, JSON.stringify([]))
    __resetCoworkSyncForTests()
    useCoworkSessions.setState({ sessions: [], currentId: null })
    await startCoworkSync()
    flushCoworkStartupWarnings()
    expect(sonner.warning).toHaveBeenCalledTimes(2)
  })

  it('the sandbox sweep keep-list includes sessions created before hydration finished', async () => {
    backend.settings.set(COWORK_MIGRATION_FLAG_KEY, 'true')
    backend.threads.set('committed', {
      id: 'committed',
      object: 'thread',
      title: 'Committed',
      assistants: [],
      created: 1,
      updated: 1,
      metadata: { mode: 'cowork', folder: null },
    })
    backend.extras.set('committed', {
      version: 1,
      turns: [{ role: 'user', content: 'hi' }],
      messages: [],
    })
    // A session begun before hydration finished (e.g. a failed first start
    // retried mid-run) has a live sandbox the sweep must keep.
    const early = useCoworkSessions.getState().createSession()
    await startCoworkSync()
    expect(agentTools.sweepSessionWorkspaces).toHaveBeenCalledTimes(1)
    const keep = agentTools.sweepSessionWorkspaces.mock.calls[0][0] as string[]
    expect(keep).toContain('committed')
    expect(keep).toContain(early)
  })
  it('a sandbox cleanup failure does not restore a durably deleted session', async () => {
    await startCoworkSync()
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'x' }], [], [])
    await flushCowork()
    agentTools.cleanupThreadWorkspace.mockRejectedValueOnce(new Error('cleanup failed'))
    useCoworkSessions.getState().deleteSession(id)
    await flushCoworkDeletes()
    expect(backend.threads.has(id)).toBe(false)
    expect(useCoworkSessions.getState().sessions.some((s) => s.id === id)).toBe(false)
  })

  it('propagates initialization failure and permits a later retry', async () => {
    const invoke = backend.invoke
    let fail = true
    backend.invoke = async (command, args) => {
      if (command === 'list_threads' && fail) throw new Error('storage unavailable')
      return invoke(command, args)
    }
    await expect(startCoworkSync()).rejects.toThrow('storage unavailable')
    fail = false
    await expect(startCoworkSync()).resolves.toBeUndefined()
    backend.invoke = invoke
  })

})
