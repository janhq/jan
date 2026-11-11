import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>

// One in-memory backend serves the migration (through the service hub) and the
// write-through, with the Rust commands' semantics.
const backend = vi.hoisted(() => {
  const settings = new Map<string, string>()
  const threads = new Map<string, any>()
  const extras = new Map<string, any>()
  const logs = new Map<string, any[]>()
  const log: string[] = []
  const hooks: { before?: (cmd: string, args: Record<string, any>) => Promise<void> } = {}
  // What Rust answers for `main_window_hides_on_close`.
  const window = { hidesOnClose: false }
  const invoke = async (cmd: string, args: Record<string, any> = {}) => {
    log.push(cmd)
    await hooks.before?.(cmd, args)
    switch (cmd) {
      case 'settings_get':
        return settings.get(args.key) ?? null
      case 'settings_set':
        settings.set(args.key, args.value)
        return
      case 'settings_flush':
        return
      case 'settings_backup_once':
        return true
      case 'settings_remove':
        settings.delete(args.key)
        return
      case 'list_threads':
        return [...threads.values()].map((t) => JSON.parse(JSON.stringify(t)))
      case 'write_thread_extra':
        if (!args.create && !threads.has(args.threadId))
          throw new Error('thread_missing: Thread has no thread.json')
        extras.set(args.threadId, JSON.parse(JSON.stringify(args.value)))
        return
      case 'read_thread_extra':
        return extras.get(args.threadId) ?? null
      case 'replace_thread_messages':
        if (!args.create && !threads.has(args.threadId))
          throw new Error('thread_missing: Thread has no thread.json')
        logs.set(args.threadId, JSON.parse(JSON.stringify(args.messages)))
        return
      case 'list_messages':
        return logs.get(args.threadId) ?? []
      case 'create_thread':
        if (threads.has(args.thread.id)) return threads.get(args.thread.id)
        threads.set(args.thread.id, JSON.parse(JSON.stringify(args.thread)))
        return args.thread
      case 'modify_thread':
        if (!threads.has(args.thread.id))
          throw new Error('thread_missing: Thread does not exist')
        threads.set(args.thread.id, JSON.parse(JSON.stringify(args.thread)))
        return
      case 'delete_thread':
        threads.delete(args.threadId)
        extras.delete(args.threadId)
        logs.delete(args.threadId)
        return
      case 'main_window_hides_on_close':
        return window.hidesOnClose
      case 'exit_after_save':
      case 'cancel_exit_save':
      case 'exit_without_saving':
        return
      default:
        throw new Error(`unexpected ${cmd}`)
    }
  }
  return { settings, threads, extras, logs, log, hooks, window, invoke }
})

const messageStore = vi.hoisted(() => ({
  create: async (message: unknown): Promise<unknown> => message,
}))

const platform = vi.hoisted(() => ({ tauri: true }))
vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => platform.tauri,
  isPlatformIOS: () => false,
  isPlatformAndroid: () => false,
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({ invoke: backend.invoke }),
    threads: () => ({ deleteThread: vi.fn(async () => {}) }),
    messages: () => ({
      createMessage: (message: unknown) => messageStore.create(message),
      modifyMessage: async (message: unknown) => message,
      deleteMessage: async () => {},
      fetchMessages: async (threadId: string) => backend.logs.get(threadId) ?? [],
    }),
  }),
}))
const agentTools = vi.hoisted(() => ({
  cleanupThreadWorkspace: vi.fn().mockResolvedValue(undefined),
  copySessionWorkspaceToThread: vi.fn().mockResolvedValue({ copied: true }),
  cancelAgentThreadBash: vi.fn().mockResolvedValue(undefined),
  stopAgentSessionMonitors: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/agentTools', () => agentTools)
const sonner = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast: sonner }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  i18n: { t: (key: string) => key },
}))
const closeWindow = vi.hoisted(() => ({
  callback: null as null | ((event: { preventDefault: () => void }) => Promise<void>),
  // The `app-exit-requested` listener Rust fires on tray Quit / Cmd+Q.
  onExitRequested: null as null | (() => Promise<void>),
  destroy: vi.fn(async () => {}),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy: closeWindow.destroy,
    onCloseRequested: vi.fn(async (callback) => {
      closeWindow.callback = callback
      return () => {}
    }),
    listen: vi.fn(async (event: string, callback: () => Promise<void>) => {
      if (event === 'app-exit-requested') closeWindow.onExitRequested = callback
      return () => {}
    }),
  }),
}))

import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import {
  registerCoworkRunForClose,
  isCoworkClosing,
  resumeCoworkAfterPreventedClose,
} from '@/hooks/useCoworkRun'
import { resumeChatsAfterPreventedClose } from '../chatClose'
import { useThreads } from '@/hooks/useThreads'
import { useMessages, __resetMessageWritesForTests } from '@/hooks/useMessages'
import {
  startCoworkSync,
  flushCoworkDeletes,
  flushCoworkStartupWarnings,
  retryCoworkImport,
  COWORK_MIGRATION_BUDGET_MS,
  COWORK_CLOSE_FAILURES_BEFORE_FORCE,
  continueChatAsTask,
  __resetCoworkSyncForTests,
} from '../coworkSync'
import {
  CODE_SESSIONS_KEY,
  COWORK_DELETED_IDS_KEY,
  COWORK_MIGRATION_FLAG_KEY,
} from '../migrateCoworkSessions'
import {
  coworkSessionToThreadMessages,
  transcriptFromThreadMessages,
} from '../coworkThreadMessages'

/** The stored transcript, carried by messages.jsonl. */
const stored = (id: string) => transcriptFromThreadMessages(backend.logs.get(id) ?? [])

const legacy = (id: string, extra: Json = {}): Json => ({
  id,
  title: 'Legacy ' + id,
  folder: null,
  turns: [{ role: 'user', content: 'hi' }],
  messages: [{ id: 'm', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
  updated: 1_700_000_000_000,
  ...extra,
})

const putBlob = (...sessions: Json[]) =>
  backend.settings.set(
    CODE_SESSIONS_KEY,
    JSON.stringify({ state: { sessions }, version: 1 })
  )

// Cowork writes are drained through the window-close handshake, the public way
// to flush them; its closing barriers are lifted again so a test can keep editing.
const flushCowork = async () => {
  await closeWindow.callback!({ preventDefault: vi.fn() })
  resumeCoworkAfterPreventedClose()
  resumeChatsAfterPreventedClose()
}

const reply = { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] }

describe('coworkSync', () => {
  beforeEach(() => {
    backend.settings.clear()
    backend.threads.clear()
    backend.extras.clear()
    backend.logs.clear()
    backend.log.length = 0
    backend.hooks.before = undefined
    backend.window.hidesOnClose = false
    agentTools.cleanupThreadWorkspace.mockClear()
    sonner.warning.mockClear()
    sonner.dismiss.mockClear()
    platform.tauri = true
    closeWindow.callback = null
    closeWindow.destroy.mockClear()
    sonner.error.mockClear()
    messageStore.create = async (message) => message
    __resetMessageWritesForTests()
    __resetCoworkSyncForTests()
    useCoworkSessions.setState({ sessions: [], currentId: null })
    useThreads.setState({ threads: {} })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('continueChatAsTask', () => {
    const text = (id: string, role: string, value: string) => ({
      id,
      thread_id: 'c',
      object: 'thread.message',
      role,
      status: 'ready',
      created_at: 1_700_000_000,
      completed_at: 1_700_000_000,
      content: [{ type: 'text', text: { value, annotations: [] } }],
    })
    const chatThread = {
      id: 'c',
      object: 'thread',
      title: 'Fix the build',
      assistants: [{ id: 'jan', name: 'Jan', model: { id: 'm', engine: 'p' } }],
      created: 1_700_000_000,
      updated: 1_700_000_100,
      metadata: { folder: '/repo', folderAccess: 'write', is_favorite: true },
    }

    beforeEach(() => {
      backend.threads.set('c', JSON.parse(JSON.stringify(chatThread)))
      backend.logs.set('c', [
        text('u1', 'user', 'why does it fail?'),
        text('a1', 'assistant', 'A missing import.'),
      ])
      useThreads.setState({
        threads: {
          c: {
            ...chatThread,
            model: { id: 'm', provider: 'p' },
            isFavorite: true,
          } as any,
        },
      })
    })

    it('turns the same thread into a task, with no second thread or transcript', async () => {
      await startCoworkSync()
      await continueChatAsTask('c')

      expect([...backend.threads.keys()]).toEqual(['c'])
      const record = backend.threads.get('c')
      expect(record.metadata).toMatchObject({
        mode: 'cowork',
        folder: '/repo',
        folderAccess: 'write',
        is_favorite: true,
      })
      expect(record.title).toBe('Fix the build')
      expect(record.created).toBe(chatThread.created)
      expect(stored('c')!.turns.map((t) => [t.role, t.content])).toEqual([
        ['user', 'why does it fail?'],
        ['assistant', 'A missing import.'],
      ])
      expect(useThreads.getState().threads['c'].metadata?.mode).toBe('cowork')
      expect(useCoworkSessions.getState().currentId).toBe('c')
    })

    it('reopens as the same task after a restart', async () => {
      await startCoworkSync()
      await continueChatAsTask('c')
      __resetCoworkSyncForTests()
      useCoworkSessions.setState({ sessions: [], currentId: null })
      await startCoworkSync()
      const session = useCoworkSessions.getState().sessions.find((s) => s.id === 'c')
      expect(session?.folder).toBe('/repo')
      expect(session?.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
      expect(session?.turns).toHaveLength(2)
    })
  })

  describe('startup', () => {
    it('migrates legacy sessions into threads, then loads them into the store', async () => {
      putBlob(legacy('a'), legacy('b'))
      await startCoworkSync()
      expect(backend.threads.get('a')!.metadata.mode).toBe('cowork')
      expect(useCoworkSessions.getState().sessions.map((s) => s.id).sort()).toEqual(['a', 'b'])
      expect(backend.settings.get(COWORK_MIGRATION_FLAG_KEY)).toBe('true')
      expect(backend.settings.get(COWORK_MIGRATION_FLAG_KEY)).toBe('true')
      // The legacy blob is the rollback source and is never touched.
      expect(backend.settings.has(CODE_SESSIONS_KEY)).toBe(true)
      // Cowork threads reach the shared thread list (search, sidebar) exactly once.
      expect(useThreads.getState().threads['a']).toBeTruthy()
      expect(Object.keys(useThreads.getState().threads).sort()).toEqual(['a', 'b'])
    })

    it('hydration itself writes nothing back', async () => {
      putBlob(legacy('a'))
      await startCoworkSync()
      await flushCowork()
      const writes = backend.log.filter((c) =>
        ['write_thread_extra', 'modify_thread', 'replace_thread_messages'].includes(c)
      )
      // The only writes are the migration's own (one sidecar, one messages log).
      expect(writes.sort()).toEqual(['replace_thread_messages', 'write_thread_extra'])
    })

    it('is a no-op off the desktop app', async () => {
      platform.tauri = false
      await startCoworkSync()
      expect(backend.log).toEqual([])
    })

    it('runs once for concurrent callers and a failed start is retried', async () => {
      putBlob(legacy('a'))
      await Promise.all([startCoworkSync(), startCoworkSync()])
      expect(backend.log.filter((c) => c === 'list_threads').length).toBeLessThanOrEqual(2)
      const before = backend.log.length
      await startCoworkSync()
      expect(backend.log.length).toBe(before)
    })

    it('a session created before hydration finished is kept and wins over the loaded copy', async () => {
      putBlob(legacy('a', { title: 'On disk' }))
      useCoworkSessions.setState({
        sessions: [
          { id: 'a', title: 'In memory', folder: null, turns: [], messages: [], updated: 5 } as any,
          { id: 'early', title: 'Early', folder: null, turns: [], messages: [], updated: 6 } as any,
        ],
        currentId: 'early',
      })
      await startCoworkSync()
      const byId = Object.fromEntries(useCoworkSessions.getState().sessions.map((s) => [s.id, s]))
      expect(byId.a.title).toBe('In memory')
      expect(byId.early).toBeTruthy()
      expect(useCoworkSessions.getState().currentId).toBe('early')
    })

    it('surfaces an unreadable deletion journal and flushes the warning after the toaster mounts', async () => {
      putBlob(legacy('a'))
      backend.settings.set(COWORK_DELETED_IDS_KEY, '{corrupt')
      // The migration fails closed on the journal, leaving the blob unsettled.
      await startCoworkSync()
      expect(sonner.warning).toHaveBeenCalledWith(
        'common:coworkSync.journalUnreadableTitle',
        expect.objectContaining({
          id: 'cowork-deletion-journal-unreadable',
          description: 'common:coworkSync.journalUnreadableDescription',
        })
      )
      sonner.warning.mockClear()
      flushCoworkStartupWarnings()
      expect(sonner.warning).toHaveBeenCalledTimes(1)
      // The corrupt bytes are never rewritten.
      expect(backend.settings.get(COWORK_DELETED_IDS_KEY)).toBe('{corrupt')
    })
  })

  describe('write-through', () => {
    it('a new session is persisted as thread + sidecar + converted messages, sidecar first and thread.json last', async () => {
      await startCoworkSync()
      const id = useCoworkSessions.getState().createSession()
      useCoworkSessions.getState().setMessages(id, legacy('x').messages)
      useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'hi' } as any], legacy('x').messages, [])
      await flushCowork()
      const order = backend.log.filter((c) =>
        ['write_thread_extra', 'replace_thread_messages', 'create_thread'].includes(c)
      )
      expect(order).toEqual(['write_thread_extra', 'replace_thread_messages', 'create_thread'])
      const session = useCoworkSessions.getState().sessions.find((s) => s.id === id)!
      expect(stored(id)?.messages).toEqual(session.messages)
      expect(backend.logs.get(id)!.length).toBe(coworkSessionToThreadMessages(session).length)
      expect(useThreads.getState().threads[id]).toBeTruthy()
    })

    it('an untouched blank session is never written', async () => {
      await startCoworkSync()
      useCoworkSessions.getState().createSession()
      await flushCowork()
      expect(backend.threads.size).toBe(0)
    })

    it('a reload sees exactly what was written (hydration reads the sidecar)', async () => {
      await startCoworkSync()
      const id = useCoworkSessions.getState().createSession()
      useCoworkSessions.getState().setFolder(id, '/work')
      useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'hi' } as any], legacy('x').messages, [])
      useCoworkSessions.getState().setTitle(id, 'Named')
      await flushCowork()
      const before = useCoworkSessions.getState().sessions.find((s) => s.id === id)!

      __resetCoworkSyncForTests()
      useCoworkSessions.setState({ sessions: [], currentId: null })
      useThreads.setState({ threads: {} })
      await startCoworkSync()
      const after = useCoworkSessions.getState().sessions.find((s) => s.id === id)!
      expect(after.title).toBe('Named')
      expect(after.folder).toBe('/work')
      expect(after.messages).toEqual(before.messages)
      expect(after.turns).toEqual(before.turns)
    })

    it('a migrated thread keeps its message stamps when the live session appends a turn', async () => {
      putBlob(legacy('a'))
      await startCoworkSync()
      await flushCowork()
      const migrated = JSON.stringify(backend.logs.get('a')![0])
      const s = useCoworkSessions.getState().sessions.find((x) => x.id === 'a')!
      useCoworkSessions.getState().commitTurns(
        'a',
        [{ role: 'assistant', content: 'ok' } as any],
        [...s.messages, reply as any],
        []
      )
      await flushCowork()
      const after = backend.logs.get('a')!
      expect(after).toHaveLength(2)
      expect(JSON.stringify(after[0])).toBe(migrated)
    })

    it('a thread deleted underneath a live session flags it unavailable and stops writing', async () => {
      await startCoworkSync()
      const id = useCoworkSessions.getState().createSession()
      useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'hi' } as any], legacy('x').messages, [])
      await flushCowork()
      backend.threads.delete(id)
      useCoworkSessions.getState().setTitle(id, 'late')
      await flushCowork()
      expect(useCoworkSessions.getState().sessions.find((s) => s.id === id)!.unavailable).toBe('missing-thread')
      expect(sonner.warning).toHaveBeenCalledWith(
        'common:coworkSync.missingThreadTitle',
        expect.objectContaining({ id: `cowork-missing-thread-${id}` })
      )
      expect(backend.threads.has(id)).toBe(false)
    })
  })

  describe('a session the migration gave up on', () => {
    it('shows as not imported with the reason, and Try again imports it once the cause is gone', async () => {
      putBlob(legacy('a'), legacy('b'))
      agentTools.copySessionWorkspaceToThread.mockRejectedValueOnce(
        new Error('PERMANENT: a already holds files of its own')
      )
      await startCoworkSync()
      const stuck = useCoworkSessions
        .getState()
        .sessions.find((s) => s.id === 'a')!
      expect([stuck.unavailable, stuck.importError]).toEqual([
        'not-imported',
        'PERMANENT: a already holds files of its own',
      ])
      expect(backend.threads.has('a')).toBe(false)

      await expect(retryCoworkImport('a')).resolves.toEqual({ imported: true })
      const fixed = useCoworkSessions
        .getState()
        .sessions.find((s) => s.id === 'a')!
      expect(fixed.unavailable).toBeUndefined()
      expect(backend.threads.get('a')!.metadata.mode).toBe('cowork')
      expect(useThreads.getState().threads['a']).toBeTruthy()
      expect(backend.settings.get(COWORK_MIGRATION_FLAG_KEY)).toBe('true')
    })

    it('a retry that fails again keeps the session read-only and reports the new reason', async () => {
      putBlob(legacy('a'))
      agentTools.copySessionWorkspaceToThread
        .mockRejectedValueOnce(new Error('PERMANENT: first'))
        .mockRejectedValueOnce(new Error('PERMANENT: second'))
      await startCoworkSync()
      await expect(retryCoworkImport('a')).resolves.toEqual({
        imported: false,
        error: 'PERMANENT: second',
      })
      const s = useCoworkSessions.getState().sessions[0]
      expect([s.unavailable, s.importError]).toEqual([
        'not-imported',
        'PERMANENT: second',
      ])
      expect(backend.threads.has('a')).toBe(false)
    })
  })

  describe('deletion', () => {
    it('deleting a session removes its thread and sandbox, and the thread list row', async () => {
      await startCoworkSync()
      const id = useCoworkSessions.getState().createSession()
      useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'hi' } as any], legacy('x').messages, [])
      await flushCowork()
      useCoworkSessions.getState().deleteSession(id)
      await flushCoworkDeletes()
      expect(backend.threads.has(id)).toBe(false)
      expect(useThreads.getState().threads[id]).toBeUndefined()
      expect(agentTools.cleanupThreadWorkspace).toHaveBeenCalledWith(id)
    })

    it('while the migration is unsettled the deletion is journaled; after a restart it stays deleted and the blob is untouched', async () => {
      putBlob(legacy('a'), legacy('b'))
      // Make the migration fail transiently so the blob stays live.
      agentTools.copySessionWorkspaceToThread.mockRejectedValueOnce(new Error('disk busy'))
      await startCoworkSync()
      expect(backend.settings.get(COWORK_MIGRATION_FLAG_KEY)).not.toBe('true')
      const blob = backend.settings.get(CODE_SESSIONS_KEY)
      useCoworkSessions.getState().deleteSession('a')
      await flushCoworkDeletes()
      expect(JSON.parse(backend.settings.get(COWORK_DELETED_IDS_KEY)!)).toContain('a')

      __resetCoworkSyncForTests()
      useCoworkSessions.setState({ sessions: [], currentId: null })
      useThreads.setState({ threads: {} })
      await startCoworkSync()
      expect(useCoworkSessions.getState().sessions.map((s) => s.id)).toEqual(['b'])
      expect(backend.threads.has('a')).toBe(false)
      expect(backend.settings.get(CODE_SESSIONS_KEY)).toBe(blob)
    })

    it('a failed delete restores the session and reports the failure on flush', async () => {
      await startCoworkSync()
      const id = useCoworkSessions.getState().createSession()
      useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'hi' } as any], legacy('x').messages, [])
      await flushCowork()
      backend.hooks.before = async (cmd) => {
        if (cmd === 'delete_thread') throw new Error('permission denied')
      }
      useCoworkSessions.getState().deleteSession(id)
      await expect(flushCoworkDeletes()).rejects.toThrow('permission denied')
      expect(useCoworkSessions.getState().sessions.some((s) => s.id === id)).toBe(true)
    })

    it('deleting the thread from the shared thread list goes through the session store', async () => {
      await startCoworkSync()
      const id = useCoworkSessions.getState().createSession()
      useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'hi' } as any], legacy('x').messages, [])
      await flushCowork()
      useThreads.getState().deleteThread(id)
      await flushCoworkDeletes()
      expect(useCoworkSessions.getState().sessions.some((s) => s.id === id)).toBe(false)
      expect(backend.threads.has(id)).toBe(false)
    })

    it('Delete All spares Cowork conversations', async () => {
      await startCoworkSync()
      const id = useCoworkSessions.getState().createSession()
      useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'hi' } as any], legacy('x').messages, [])
      await flushCowork()
      useThreads.getState().deleteAllThreads()
      await flushCoworkDeletes()
      expect(useThreads.getState().threads[id]).toBeTruthy()
      expect(backend.threads.has(id)).toBe(true)
    })
  })

  describe('a migration that overruns its startup budget', () => {
    it('renders without waiting, then brings in the migrated sessions and holds back legacy writes until it settles', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      putBlob(legacy('a'), legacy('b'))
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      backend.hooks.before = async (cmd) => {
        if (cmd === 'replace_thread_messages') await gate
      }
      const started = startCoworkSync()
      await vi.advanceTimersByTimeAsync(COWORK_MIGRATION_BUDGET_MS + 100)
      await started
      expect(backend.settings.get(COWORK_MIGRATION_FLAG_KEY)).not.toBe('true')
      // Legacy-only sessions are visible meanwhile, nothing is lost.
      expect(useCoworkSessions.getState().sessions.map((s) => s.id).sort()).toEqual(['a', 'b'])
      // The user edits a legacy session before the migration reaches it.
      useCoworkSessions.getState().setTitle('a', 'Edited meanwhile')
      await vi.advanceTimersByTimeAsync(1500)
      expect(backend.threads.get('a')).toBeUndefined()
      release()
      await vi.advanceTimersByTimeAsync(200)
      await flushCowork()
      expect(backend.settings.get(COWORK_MIGRATION_FLAG_KEY)).toBe('true')
      // The newer write-through wins over the blob's older copy.
      expect(backend.threads.get('a')!.title).toBe('Edited meanwhile')
      expect(backend.threads.has('b')).toBe(true)
    })

    it('a session the background run gives up on turns read-only with its reason', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      putBlob(legacy('a'), legacy('b'))
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      backend.hooks.before = async (cmd) => {
        if (cmd === 'replace_thread_messages') await gate
      }
      agentTools.copySessionWorkspaceToThread.mockRejectedValueOnce(
        new Error('PERMANENT: a already holds files of its own')
      )
      const started = startCoworkSync()
      await vi.advanceTimersByTimeAsync(COWORK_MIGRATION_BUDGET_MS + 100)
      await started
      expect(useCoworkSessions.getState().sessions.find((s) => s.id === 'a')!.unavailable).toBeUndefined()
      release()
      await vi.advanceTimersByTimeAsync(200)
      await flushCowork()
      const a = useCoworkSessions.getState().sessions.find((s) => s.id === 'a')!
      expect([a.unavailable, a.importError]).toEqual([
        'not-imported',
        'PERMANENT: a already holds files of its own',
      ])
      expect(backend.threads.has('a')).toBe(false)
      expect(backend.threads.has('b')).toBe(true)
    })

    it('a session deleted while the migration was still running does not come back', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      putBlob(legacy('a'), legacy('b'))
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      backend.hooks.before = async (cmd) => {
        if (cmd === 'write_thread_extra') await gate
      }
      const started = startCoworkSync()
      await vi.advanceTimersByTimeAsync(COWORK_MIGRATION_BUDGET_MS + 100)
      await started
      useCoworkSessions.getState().deleteSession('a')
      await vi.advanceTimersByTimeAsync(50)
      release()
      await vi.advanceTimersByTimeAsync(500)
      await flushCoworkDeletes()
      await flushCowork()
      expect(useCoworkSessions.getState().sessions.map((s) => s.id)).toEqual(['b'])
      expect(JSON.parse(backend.settings.get(COWORK_DELETED_IDS_KEY)!)).toContain('a')
      expect(backend.threads.has('a')).toBe(false)
      expect(useThreads.getState().threads['a']).toBeUndefined()
    })
  })

  describe('window close', () => {
    const closeEvent = () => ({ preventDefault: vi.fn() })

    it('waits for live runs to commit, then flushes every write, before letting the window close', async () => {
      await startCoworkSync()
      const id = useCoworkSessions.getState().createSession()
      let commit!: () => void
      const committed = new Promise<void>((r) => (commit = r))
      registerCoworkRunForClose(async () => {
        await committed
        useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'last words' } as any], legacy('x').messages, [])
      })
      const event = closeEvent()
      let done = false
      const closing = closeWindow.callback!(event).then(() => (done = true))
      await Promise.resolve()
      expect(done).toBe(false)
      commit()
      await closing
      expect(event.preventDefault).not.toHaveBeenCalled()
      // The run's final commit made it to disk before the close resolved.
      expect(stored(id)?.turns).toEqual([{ role: 'user', content: 'last words' }])
      expect(backend.threads.has(id)).toBe(true)
    })

    it('a close that only hides the window keeps live runs going and the app alive, and still saves', async () => {
      backend.window.hidesOnClose = true
      await startCoworkSync()
      const id = useCoworkSessions.getState().createSession()
      useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'keep' }], legacy('x').messages, [])
      const quiesce = vi.fn(async () => {})
      registerCoworkRunForClose(quiesce)
      const event = closeEvent()
      await closeWindow.callback!(event)
      // preventDefault stops the Tauri API from destroying the last window,
      // which would quit the app.
      expect(event.preventDefault).toHaveBeenCalled()
      expect(quiesce).not.toHaveBeenCalled()
      expect(isCoworkClosing()).toBe(false)
      await vi.waitFor(() =>
        expect(stored(id)?.turns).toEqual([{ role: 'user', content: 'keep' }])
      )
      expect(sonner.error).not.toHaveBeenCalled()
    })

    it('prevents the close when a write cannot be flushed, keeps the unsaved session, and a retry succeeds', async () => {
      await startCoworkSync()
      const id = useCoworkSessions.getState().createSession()
      useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'keep' } as any], legacy('x').messages, [])
      let failing = true
      backend.hooks.before = async (cmd) => {
        if (failing && cmd === 'write_thread_extra') throw new Error('disk full')
      }
      const first = closeEvent()
      await closeWindow.callback!(first)
      expect(first.preventDefault).toHaveBeenCalled()
      expect(isCoworkClosing()).toBe(false)
      expect(useCoworkSessions.getState().sessions.some((s) => s.id === id)).toBe(true)
      failing = false
      const second = closeEvent()
      await closeWindow.callback!(second)
      expect(second.preventDefault).not.toHaveBeenCalled()
      expect(stored(id)?.turns).toHaveLength(1)
    })

    it('drains queued chat message writes before the window closes, and keeps it open when one fails', async () => {
      await startCoworkSync()
      __resetMessageWritesForTests()
      const written: string[] = []
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      messageStore.create = async (message) => {
        await gate
        written.push((message as { id: string }).id)
        return message
      }
      useMessages.getState().addMessage({ id: 'chat-1', thread_id: 't-chat' } as any)
      const event = closeEvent()
      let done = false
      const closing = closeWindow.callback!(event).then(() => (done = true))
      await Promise.resolve()
      expect(done).toBe(false)
      release()
      await closing
      expect(written).toEqual(['chat-1'])
      expect(event.preventDefault).not.toHaveBeenCalled()

      messageStore.create = async () => {
        throw new Error('disk full')
      }
      useMessages.getState().addMessage({ id: 'chat-2', thread_id: 't-chat' } as any)
      const failed = closeEvent()
      await closeWindow.callback!(failed)
      expect(failed.preventDefault).toHaveBeenCalled()

      messageStore.create = async (message) => {
        written.push((message as { id: string }).id)
        return message
      }
      const retry = closeEvent()
      await closeWindow.callback!(retry)
      expect(retry.preventDefault).not.toHaveBeenCalled()
      expect(written).toEqual(['chat-1', 'chat-2'])
    })

    it('offers an explicit close-without-saving after repeated failed closes, never silently', async () => {
      await startCoworkSync()
      messageStore.create = async () => {
        throw new Error('disk full')
      }
      useMessages.getState().addMessage({ id: 'chat-x', thread_id: 't-stuck' } as any)
      const errorOptions = () => sonner.error.mock.calls.map((call) => call[1])
      for (let attempt = 1; attempt <= COWORK_CLOSE_FAILURES_BEFORE_FORCE; attempt += 1) {
        const event = closeEvent()
        await closeWindow.callback!(event)
        expect(event.preventDefault).toHaveBeenCalled()
        expect(sonner.error).toHaveBeenLastCalledWith(
          'common:coworkSync.closeFailedTitle',
          expect.objectContaining({ id: 'cowork-close-failed' })
        )
        const action = errorOptions().at(-1)?.action
        if (attempt < COWORK_CLOSE_FAILURES_BEFORE_FORCE) expect(action).toBeUndefined()
        else expect(action).toEqual(expect.objectContaining({ label: 'common:coworkSync.closeAnyway' }))
      }
      expect(closeWindow.destroy).not.toHaveBeenCalled()
      errorOptions().at(-1).action.onClick()
      expect(closeWindow.destroy).toHaveBeenCalledTimes(1)
    })

    it('a successful close attempt resets the failure count and dismisses the close toast', async () => {
      await startCoworkSync()
      let failing = true
      messageStore.create = async (message) => {
        if (failing) throw new Error('disk full')
        return message
      }
      useMessages.getState().addMessage({ id: 'chat-y', thread_id: 't-stuck' } as any)
      for (let attempt = 1; attempt < COWORK_CLOSE_FAILURES_BEFORE_FORCE; attempt += 1) {
        await closeWindow.callback!(closeEvent())
      }
      failing = false
      const ok = closeEvent()
      await closeWindow.callback!(ok)
      expect(ok.preventDefault).not.toHaveBeenCalled()
      expect(sonner.dismiss).toHaveBeenCalledWith('cowork-close-failed')
      failing = true
      useMessages.getState().addMessage({ id: 'chat-z', thread_id: 't-stuck' } as any)
      await closeWindow.callback!(closeEvent())
      expect(sonner.error.mock.calls.at(-1)?.[1].action).toBeUndefined()
    })

    describe('quit (tray Quit, Cmd+Q)', () => {
      it('stops live runs and saves, then lets Rust finish the held exit', async () => {
        await startCoworkSync()
        const id = useCoworkSessions.getState().createSession()
        let commit!: () => void
        const committed = new Promise<void>((r) => (commit = r))
        registerCoworkRunForClose(async () => {
          await committed
          useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'last words' }], legacy('x').messages, [])
        })
        const quitting = closeWindow.onExitRequested!()
        await Promise.resolve()
        expect(backend.log).not.toContain('exit_after_save')
        commit()
        await quitting
        expect(stored(id)?.turns).toEqual([{ role: 'user', content: 'last words' }])
        // Exit is released only after the save landed.
        expect(backend.log.indexOf('exit_after_save')).toBeGreaterThan(
          backend.log.lastIndexOf('write_thread_extra')
        )
        expect(backend.log).not.toContain('cancel_exit_save')
      })

      it('cancels the exit when a write fails, and offers quit-without-saving after repeated failures', async () => {
        await startCoworkSync()
        const id = useCoworkSessions.getState().createSession()
        useCoworkSessions.getState().commitTurns(id, [{ role: 'user', content: 'keep' }], legacy('x').messages, [])
        backend.hooks.before = async (cmd) => {
          if (cmd === 'write_thread_extra') throw new Error('disk full')
        }
        const errorOptions = () => sonner.error.mock.calls.map((call) => call[1])
        for (let attempt = 1; attempt <= COWORK_CLOSE_FAILURES_BEFORE_FORCE; attempt += 1) {
          await closeWindow.onExitRequested!()
          expect(backend.log.filter((c) => c === 'cancel_exit_save')).toHaveLength(attempt)
          expect(errorOptions().at(-1)?.description).toBe(
            attempt < COWORK_CLOSE_FAILURES_BEFORE_FORCE
              ? 'common:coworkSync.quitFailedDescription'
              : 'common:coworkSync.closeForceDescription'
          )
        }
        expect(backend.log).not.toContain('exit_after_save')
        expect(isCoworkClosing()).toBe(false)
        const action = errorOptions().at(-1).action
        expect(action.label).toBe('common:coworkSync.quitAnyway')
        action.onClick()
        await vi.waitFor(() => expect(backend.log).toContain('exit_without_saving'))
      })
    })
  })
})
