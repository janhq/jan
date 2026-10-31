import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import capability from '../../../../src-tauri/capabilities/default.json'
import config from '../../../../src-tauri/tauri.conf.json'

// Keep the installed Tauri window/event/core API real. Only IPC and storage are
// doubles: this is a JS dispatch + configuration regression, NOT native ACL QA.
const storage = vi.hoisted(() => ({
  create: vi.fn(),
  invoke: vi.fn(),
  flush: vi.fn(),
  remove: vi.fn(),
  schedule: vi.fn(),
  adopt: vi.fn(),
  setCurrentId: vi.fn(),
}))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => true }))
vi.mock('@/lib/agentTools', () => ({
  cleanupThreadWorkspace: vi.fn(), sweepSessionWorkspaces: vi.fn(),
}))
vi.mock('@/lib/migrateCoworkSessions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/migrateCoworkSessions')>(),
  migrateCoworkSessionsToThreads: async () => ({ status: 'done' }),
  isCoworkMigrationSettled: async () => true,
}))
vi.mock('@/lib/coworkPersistence', () => ({
  createCoworkPersistence: (...args: unknown[]) => storage.create(...args),
  loadCoworkSessions: async () => ({
    threads: [], sessions: [], currentId: null, legacyIds: new Set(),
  }),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke: storage.invoke }) }),
}))

import { isCoworkClosing, registerCoworkRunForClose } from '@/hooks/useCoworkRun'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { startCoworkSync, __resetCoworkSyncForTests } from '../coworkSync'

type CloseEvent = { event: string; id: number; payload: null }
let dispatchClose: (event: CloseEvent) => Promise<void>
const invoke = vi.fn()
const closeEvent: CloseEvent = { event: 'tauri://close-requested', id: 1, payload: null }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Cowork close with the installed Tauri API', () => {
  beforeEach(() => {
    __resetCoworkSyncForTests()
    useCoworkSessions.setState({ sessions: [], currentId: null })
    vi.clearAllMocks()
    storage.create.mockImplementation(() => storage)
    storage.flush.mockResolvedValue(undefined)
    storage.remove.mockResolvedValue(undefined)
    vi.stubGlobal('__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: (callback: typeof dispatchClose) => {
        dispatchClose = callback
        return 42
      },
      invoke: invoke.mockImplementation(async (command, args) => {
        if (command === 'plugin:event|listen') return 1
        if (command === 'plugin:window|destroy') {
          // Deliberately only an assertion of file/API alignment, not an ACL
          // emulator. Rust is responsible for enforcing the actual permission.
          expect(args).toEqual({ label: 'main' })
          expect(capability.permissions).toContain('core:window:allow-destroy')
          return
        }
        throw new Error(`Unexpected IPC: ${command}`)
      }),
    })
  })

  afterEach(() => {
    __resetCoworkSyncForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('enables destroy only for the main-window caller in an active local capability', () => {
    expect(config.app.security.capabilities).toContain(capability.identifier)
    expect(capability.windows).toEqual(['main'])
    expect('webviews' in capability ? capability.webviews : undefined).toBeUndefined()
    expect('remote' in capability ? capability.remote : undefined).toBeUndefined()
    expect('local' in capability ? capability.local : true).toBe(true)
    expect(capability.permissions).toContain('core:window:allow-close')
    expect(capability.permissions).toContain('core:window:allow-destroy')
  })

  it('dispatches destroy only after queued writes AND pending deletes settle', async () => {
    await startCoworkSync()
    expect(invoke).toHaveBeenCalledWith('plugin:event|listen', {
      event: closeEvent.event, target: { kind: 'Window', label: 'main' }, handler: 42,
    }, undefined)
    const writes = deferred()
    const deletes = deferred()
    storage.flush.mockReturnValueOnce(writes.promise)
    storage.remove.mockReturnValueOnce(deletes.promise)
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions.getState().deleteSession(id)
    expect(storage.remove).toHaveBeenCalled()

    const closing = dispatchClose(closeEvent)
    expect(invoke).not.toHaveBeenCalledWith('plugin:window|destroy', expect.anything(), undefined)
    writes.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(invoke).not.toHaveBeenCalledWith('plugin:window|destroy', expect.anything(), undefined)
    deletes.resolve()
    await closing
    expect(invoke).toHaveBeenCalledWith('plugin:window|destroy', { label: 'main' }, undefined)
  })

  it('waits for every run even if one fails, flushes commits, and retries a prevented close', async () => {
    await startCoworkSync()
    const completion = deferred()
    const failure = new Error('commit failed')
    const badRun = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    const otherRun = vi.fn(() => completion.promise)
    registerCoworkRunForClose(badRun)
    registerCoworkRunForClose(otherRun)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const closing = dispatchClose(closeEvent)
    expect(badRun).toHaveBeenCalledOnce()
    expect(otherRun).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(storage.flush).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith('plugin:window|destroy', expect.anything(), undefined)
    completion.resolve()
    await closing
    expect(storage.flush).toHaveBeenCalledOnce()
    expect(isCoworkClosing()).toBe(false)
    expect(invoke).not.toHaveBeenCalledWith('plugin:window|destroy', expect.anything(), undefined)
    await dispatchClose(closeEvent)
    expect(badRun).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenCalledWith('plugin:window|destroy', { label: 'main' }, undefined)
  })

  it.each(['write_thread_extra', 'settings_set'])(
    'prevents destroy on real persistence %s failure and closes after recovery',
    async (failingCommand) => {
      const { createCoworkPersistence } = await vi.importActual<typeof import('@/lib/coworkPersistence')>('@/lib/coworkPersistence')
      storage.create.mockImplementation(createCoworkPersistence)
      let failing = true
      const disk = new Map<string, unknown>()
      storage.invoke.mockImplementation(async (command, args) => {
        if (failing && command === failingCommand) throw new Error('disk full')
        if (command === 'write_thread_extra') disk.set('sidecar', args.value)
        if (command === 'create_thread') {
          disk.set('thread', args.thread)
          return args.thread
        }
        if (command === 'settings_set') disk.set(args.key, args.value)
      })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await startCoworkSync()
      const id = useCoworkSessions.getState().createSession()
      const messages = [{ id: 'question', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Keep this question' }] }]
      useCoworkSessions.getState().setMessages(id, messages)

      await dispatchClose(closeEvent)
      expect(isCoworkClosing()).toBe(false)
      expect(invoke).not.toHaveBeenCalledWith('plugin:window|destroy', expect.anything(), undefined)
      expect(useCoworkSessions.getState().sessions.find((s) => s.id === id)?.messages).toEqual(messages)
      expect(storage.invoke.mock.calls.filter(([command]) => command === failingCommand)).toHaveLength(3)

      failing = false
      await dispatchClose(closeEvent)
      expect(disk.get('sidecar')).toMatchObject({ messages })
      expect(disk.get('thread')).toMatchObject({ id })
      expect(disk.get('cowork_current_id')).toBe(id)
      expect(invoke).toHaveBeenCalledWith('plugin:window|destroy', { label: 'main' }, undefined)
    }
  )

  it('keeps unsaved state alive on flush failure and allows a later close retry', async () => {
    await startCoworkSync()
    const failure = new Error('disk full')
    storage.flush.mockRejectedValueOnce(failure)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await dispatchClose(closeEvent)
    expect(warn).toHaveBeenCalledWith('[cowork] flush on close failed:', failure)
    expect(isCoworkClosing()).toBe(false)
    expect(invoke).not.toHaveBeenCalledWith('plugin:window|destroy', expect.anything(), undefined)
    await dispatchClose(closeEvent)
    expect(invoke).toHaveBeenCalledWith('plugin:window|destroy', { label: 'main' }, undefined)
  })
})
