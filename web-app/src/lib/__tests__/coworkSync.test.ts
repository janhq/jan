import { describe, it, expect, beforeEach, vi } from 'vitest'

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

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke: backend.invoke }) }),
}))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => true }))
const agentTools = vi.hoisted(() => ({
  cleanupThreadWorkspace: vi.fn().mockResolvedValue(undefined),
  sweepSessionWorkspaces: vi.fn().mockResolvedValue(0),
}))
vi.mock('@/lib/agentTools', () => agentTools)
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: vi.fn().mockResolvedValue(() => {}) }),
}))

import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useThreads } from '@/hooks/useThreads'
import {
  startCoworkSync,
  flushCowork,
  isCoworkMigrationDone,
  __resetCoworkSyncForTests,
} from '../coworkSync'
import { CODE_SESSIONS_KEY, COWORK_MIGRATION_FLAG_KEY } from '../migrateCoworkSessions'

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
    backend.settings.clear()
    backend.threads.clear()
    backend.extras.clear()
    backend.log.length = 0
    agentTools.cleanupThreadWorkspace.mockClear()
    agentTools.sweepSessionWorkspaces.mockClear()
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
})
