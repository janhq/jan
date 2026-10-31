import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createCoworkPersistence,
  loadCoworkSessions,
  sessionFromThread,
  sessionToThreadRecord,
  COWORK_CURRENT_ID_KEY,
} from '../coworkPersistence'
import {
  CODE_SESSIONS_KEY,
  COWORK_DELETED_IDS_KEY,
} from '../migrateCoworkSessions'

type Json = Record<string, any>

// In-memory backend with the same semantics as the Rust commands: the sidecar
// write refuses a thread with no thread.json unless `create` is set.
function makeBackend(opts: { failNext?: { cmd: string; times: number } } = {}) {
  const settings = new Map<string, string>()
  const threads = new Map<string, Json>()
  const extras = new Map<string, any>()
  const log: string[] = []
  let failure = opts.failNext
  const invoke = async (cmd: string, args: Record<string, any> = {}) => {
    log.push(cmd === 'write_thread_extra' ? `${cmd}:${args.threadId}` : cmd)
    if (failure && failure.cmd === cmd && failure.times > 0) {
      failure.times -= 1
      throw new Error(`${cmd} failed`)
    }
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
        if (!args.create && !threads.has(args.threadId)) {
          throw new Error('no thread.json')
        }
        extras.set(args.threadId, JSON.parse(JSON.stringify(args.value)))
        return
      case 'read_thread_extra':
        return extras.get(args.threadId) ?? null
      case 'create_thread': {
        const existing = threads.get(args.thread.id)
        if (existing) return existing
        threads.set(args.thread.id, JSON.parse(JSON.stringify(args.thread)))
        return args.thread
      }
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
  return { invoke: invoke as any, settings, threads, extras, log }
}

const session = (id: string, extra: Json = {}): any => ({
  id,
  title: 'T ' + id,
  model: { id: 'gpt', provider: 'openai' },
  folder: '/proj',
  turns: [{ role: 'user', content: 'hi' }],
  messages: [{ id: 'm', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
  updated: 1_700_000_000_000,
  ...extra,
})

describe('coworkPersistence write protocol', () => {
  let b: ReturnType<typeof makeBackend>
  beforeEach(() => {
    vi.useFakeTimers()
    b = makeBackend()
  })
  afterEach(() => vi.useRealTimers())

  it('debounces: many schedules for a session produce one write of the latest snapshot', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 100 })
    p.schedule(session('a', { title: 'one' }))
    p.schedule(session('a', { title: 'two' }))
    p.schedule(session('a', { title: 'three' }))
    await vi.advanceTimersByTimeAsync(150)
    await p.flush()
    expect(b.log.filter((c) => c === 'create_thread')).toHaveLength(1)
    expect(b.threads.get('a')!.title).toBe('three')
  })

  it('first commit is sidecar first, thread.json last', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10 })
    p.schedule(session('a'))
    await p.flush()
    expect(b.log.indexOf('write_thread_extra:a')).toBeLessThan(b.log.indexOf('create_thread'))
    expect(b.threads.get('a')!.metadata.mode).toBe('cowork')
  })

  it('writes only the changed session', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10 })
    p.schedule(session('a'))
    p.schedule(session('b'))
    await p.flush()
    b.log.length = 0
    p.schedule(session('a', { title: 'changed' }))
    await p.flush()
    expect(b.log).not.toContain('write_thread_extra:b')
    expect(b.log).toContain('write_thread_extra:a')
  })

  it('never writes a new empty session, but does write a persisted one that became empty', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10 })
    p.schedule(session('a', { turns: [], messages: [] }))
    await p.flush()
    expect(b.threads.has('a')).toBe(false)

    p.schedule(session('a'))
    await p.flush()
    expect(b.extras.get('a').turns).toHaveLength(1)

    p.schedule(session('a', { turns: [], messages: [] })) // /clear
    await p.flush()
    expect(b.extras.get('a').turns).toHaveLength(0)
  })

  it('a failed write keeps the session dirty and retries', async () => {
    b = makeBackend({ failNext: { cmd: 'create_thread', times: 1 } })
    const onError = vi.fn()
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10, retryMs: 50, onError })
    p.schedule(session('a'))
    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()
    expect(onError).toHaveBeenCalled()
    expect(b.threads.has('a')).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    await p.flush()
    expect(b.threads.has('a')).toBe(true)
  })

  it.each(['write_thread_extra', 'create_thread', 'modify_thread'])(
    'rejects flush after bounded %s failures and recovers the latest snapshot',
    async (cmd) => {
      const failure = { cmd, times: 0 }
      b = makeBackend({ failNext: failure })
      const onError = vi.fn()
      const p = createCoworkPersistence(b.invoke, { onError, retryMs: 50 })
      if (cmd === 'modify_thread') {
        p.schedule(session('a'))
        await p.flush()
      }
      failure.times = 6
      p.schedule(session('a', { title: 'unsaved' }))
      await expect(p.flush()).rejects.toThrow('pending writes: a')
      expect(onError).toHaveBeenCalledTimes(3)
      await expect(p.flush()).rejects.toThrow('pending writes: a')
      expect(onError).toHaveBeenCalledTimes(6)
      p.schedule(session('a', { title: 'latest' }))
      await p.flush()
      expect(b.threads.get('a')!.title).toBe('latest')
      expect(b.extras.get('a').messages).toEqual(session('a').messages)
      await vi.advanceTimersByTimeAsync(100)
      expect(onError).toHaveBeenCalledTimes(6)
    }
  )

  it('counts failures from an already in-flight write and rejects instead of losing dirty work', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const onError = vi.fn()
    let failing = true
    const p = createCoworkPersistence(async (cmd, args) => {
      if (cmd === 'write_thread_extra' && failing) {
        await gate
        throw new Error('disk full')
      }
      return b.invoke(cmd, args)
    }, { debounceMs: 10, onError })
    p.schedule(session('a'))
    await vi.advanceTimersByTimeAsync(10)
    const flushed = expect(p.flush()).rejects.toThrow('pending writes: a')
    release()
    await flushed
    expect(onError).toHaveBeenCalledTimes(3)
    failing = false
    await p.flush()
    expect(b.threads.get('a')!.title).toBe('T a')
  })

  it('retains a failed snapshot for automatic background recovery after rejected flush', async () => {
    b = makeBackend({ failNext: { cmd: 'write_thread_extra', times: 3 } })
    const p = createCoworkPersistence(b.invoke, { retryMs: 50 })
    p.schedule(session('a'))
    await expect(p.flush()).rejects.toThrow('pending writes: a')
    await vi.advanceTimersByTimeAsync(50)
    expect(b.threads.get('a')!.title).toBe('T a')
    await p.flush()
  })

  it.each(['settings_set', 'settings_remove'])(
    'rejects flush after bounded current-id %s failures and retries without a new selection',
    async (cmd) => {
      b = makeBackend({ failNext: { cmd, times: 3 } })
      b.settings.set(COWORK_CURRENT_ID_KEY, 'old')
      const onError = vi.fn()
      const p = createCoworkPersistence(b.invoke, { onError })
      p.setCurrentId(cmd === 'settings_set' ? 'new' : null)
      await expect(p.flush()).rejects.toThrow('pending writes: current-id')
      expect(onError).toHaveBeenCalledTimes(3)
      expect(onError).toHaveBeenLastCalledWith('current-id', expect.any(Error))
      expect(b.settings.get(COWORK_CURRENT_ID_KEY)).toBe('old')
      await p.flush()
      expect(b.settings.get(COWORK_CURRENT_ID_KEY)).toBe(cmd === 'settings_set' ? 'new' : undefined)
    }
  )

  it('flush writes pending work immediately without waiting for the debounce', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 60_000 })
    p.schedule(session('a'))
    expect(b.threads.has('a')).toBe(false)
    await p.flush()
    expect(b.threads.has('a')).toBe(true)
  })

  it('a mutation during an in-flight write is written after it, in order', async () => {
    const order: string[] = []
    const slow = async (cmd: string, args: any) => {
      if (cmd === 'write_thread_extra') {
        await new Promise((r) => setTimeout(r, 50))
        order.push(`extra:${args.value.turns.length}`)
      }
      return b.invoke(cmd, args)
    }
    const p = createCoworkPersistence(slow as any, { debounceMs: 5 })
    p.schedule(session('a'))
    await vi.advanceTimersByTimeAsync(10) // first write now in flight
    p.schedule(session('a', { turns: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }))
    const done = p.flush()
    await vi.advanceTimersByTimeAsync(500)
    await done
    expect(order).toEqual(['extra:1', 'extra:2'])
    expect(b.extras.get('a').turns).toHaveLength(2)
  })

  it('delete cancels a pending write and drops late writes (no resurrection)', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 100 })
    p.schedule(session('a'))
    await p.flush()
    p.schedule(session('a', { title: 'pending edit' }))
    await p.remove('a')
    p.schedule(session('a', { title: 'late edit' }))
    await vi.advanceTimersByTimeAsync(500)
    await p.flush()
    expect(b.threads.has('a')).toBe(false)
    expect(b.extras.has('a')).toBe(false)
  })

  it('delete during an in-flight write drains it first, then removes the thread', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const gated = async (cmd: string, args: any) => {
      if (cmd === 'write_thread_extra') await gate
      return b.invoke(cmd, args)
    }
    const p = createCoworkPersistence(gated as any, { debounceMs: 5 })
    p.schedule(session('a'))
    await vi.advanceTimersByTimeAsync(10)
    const removed = p.remove('a')
    release()
    await vi.advanceTimersByTimeAsync(10)
    await removed
    expect(b.threads.has('a')).toBe(false)
    expect(b.extras.has('a')).toBe(false)
  })

  it('records a deleted id when asked, so the legacy blob cannot resurrect it', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 5 })
    p.schedule(session('a'))
    await p.flush()
    await p.remove('a', { recordDeleted: true })
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!)).toEqual(['a'])
  })

  it('serializes the shared deletion journal for concurrent removals', async () => {
    const p = createCoworkPersistence(b.invoke)
    await Promise.all([p.remove('a', { recordDeleted: true }), p.remove('b', { recordDeleted: true })])
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!).sort()).toEqual(['a', 'b'])
  })

  it('rolls back failed deletion intent so a legacy-only session survives rehydration', async () => {
    b = makeBackend({ failNext: { cmd: 'delete_thread', times: 1 } })
    b.settings.set(CODE_SESSIONS_KEY, JSON.stringify({
      state: { sessions: [session('a')] }, version: 1,
    }))
    const p = createCoworkPersistence(b.invoke)
    await expect(p.remove('a', { recordDeleted: true })).rejects.toThrow('delete_thread failed')
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!)).toEqual([])
    // No retry write has persisted a thread before this simulated restart.
    expect(b.threads.has('a')).toBe(false)
    const loaded = await loadCoworkSessions(b.invoke, { migrationSettled: false })
    expect(loaded.sessions.map((s) => s.id)).toEqual(['a'])
    expect([...loaded.legacyIds]).toEqual(['a'])
    p.schedule(session('a', { title: 'still editable' }), { legacy: true })
    await p.flush()
    expect(b.threads.get('a')!.title).toBe('still editable')
  })

  it('retries transient rollback failure before rejecting so immediate legacy hydration recovers', async () => {
    b.settings.set(CODE_SESSIONS_KEY, JSON.stringify({
      state: { sessions: [session('a')] }, version: 1,
    }))
    let rollbackAttempts = 0
    const invoke = async (cmd: string, args: any) => {
      if (cmd === 'delete_thread') throw new Error('delete failed')
      if (cmd === 'settings_set' && args.key === COWORK_DELETED_IDS_KEY && args.value === '[]') {
        if (++rollbackAttempts === 1) throw new Error('rollback failed')
      }
      return b.invoke(cmd, args)
    }
    const p = createCoworkPersistence(invoke as any)
    await expect(p.remove('a', { recordDeleted: true })).rejects.toThrow('delete failed')
    expect(rollbackAttempts).toBe(2)
    expect(b.threads.has('a')).toBe(false)
    const loaded = await loadCoworkSessions(b.invoke, { migrationSettled: false })
    expect(loaded.sessions.map((s) => s.id)).toEqual(['a'])
    expect([...loaded.legacyIds]).toEqual(['a'])
  })

  it('retries a failed rollback read without erasing unrelated deletion markers', async () => {
    b.settings.set(COWORK_DELETED_IDS_KEY, JSON.stringify(['other']))
    let rollbackReads = 0
    let deleting = false
    const invoke = async (cmd: string, args: any) => {
      if (cmd === 'delete_thread') {
        deleting = true
        throw new Error('delete failed')
      }
      if (deleting && cmd === 'settings_get' && args.key === COWORK_DELETED_IDS_KEY) {
        if (++rollbackReads === 1) throw new Error('read failed')
      }
      return b.invoke(cmd, args)
    }
    const p = createCoworkPersistence(invoke as any)
    await expect(p.remove('a', { recordDeleted: true })).rejects.toThrow('delete failed')
    expect(rollbackReads).toBe(2)
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!)).toEqual(['other'])
    expect(b.log.filter((cmd) => cmd === 'settings_set')).toHaveLength(2)
  })

  it.each(['{invalid', '{}', 'null', '["other", 42]', ''])(
    'does not overwrite invalid journal %j during rollback and reports pending recovery',
    async (raw) => {
      b.settings.set(COWORK_DELETED_IDS_KEY, JSON.stringify(['other']))
      const invoke = async (cmd: string, args: any) => {
        if (cmd === 'delete_thread') {
          b.settings.set(COWORK_DELETED_IDS_KEY, raw)
          throw new Error('delete failed')
        }
        return b.invoke(cmd, args)
      }
      const p = createCoworkPersistence(invoke as any)
      await expect(p.remove('a', { recordDeleted: true })).rejects.toThrow('deletion recovery pending')
      await expect(p.flush()).rejects.toThrow()
      expect(b.settings.get(COWORK_DELETED_IDS_KEY)).toBe(raw)
      expect(b.log.filter((cmd) => cmd === 'settings_set')).toHaveLength(1)
      b.settings.set(COWORK_DELETED_IDS_KEY, JSON.stringify(['other', 'a']))
      await p.flush()
      expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!)).toEqual(['other'])
    }
  )

  it('does not erase existing markers or delete files when the intent read fails', async () => {
    b = makeBackend({ failNext: { cmd: 'settings_get', times: 1 } })
    b.settings.set(COWORK_DELETED_IDS_KEY, JSON.stringify(['other']))
    const p = createCoworkPersistence(b.invoke)
    await expect(p.remove('a', { recordDeleted: true })).rejects.toThrow('settings_get failed')
    expect(b.settings.get(COWORK_DELETED_IDS_KEY)).toBe('["other"]')
    expect(b.log).not.toContain('settings_set')
    expect(b.log).not.toContain('delete_thread')
    await p.remove('a', { recordDeleted: true })
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!)).toEqual(['other', 'a'])
  })

  it.each(['{invalid', '{}', 'null', '["other", 42]', ''])(
    'rejects invalid journal %j before recording intent or deleting files',
    async (raw) => {
      b.settings.set(COWORK_DELETED_IDS_KEY, raw)
      const p = createCoworkPersistence(b.invoke)
      await expect(p.remove('a', { recordDeleted: true })).rejects.toThrow()
      expect(b.settings.get(COWORK_DELETED_IDS_KEY)).toBe(raw)
      expect(b.log).not.toContain('settings_set')
      expect(b.log).not.toContain('delete_thread')
    }
  )

  it('surfaces persistent rollback failure, retains compensation for bounded flush retry and queued edits', async () => {
    b.settings.set(CODE_SESSIONS_KEY, JSON.stringify({
      state: { sessions: [session('a')] }, version: 1,
    }))
    let broken = true
    let rollbackAttempts = 0
    const invoke = async (cmd: string, args: any) => {
      if (cmd === 'delete_thread') throw new Error('delete failed')
      if (cmd === 'settings_set' && args.key === COWORK_DELETED_IDS_KEY && args.value === '[]') {
        rollbackAttempts++
        if (broken) throw new Error('rollback failed')
      }
      return b.invoke(cmd, args)
    }
    const onError = vi.fn()
    const p = createCoworkPersistence(invoke as any, { onError })
    await expect(p.remove('a', { recordDeleted: true })).rejects.toThrow('deletion recovery pending')
    expect(onError).toHaveBeenCalledWith('a', expect.objectContaining({ message: expect.stringContaining('rollback failed') }))
    expect(rollbackAttempts).toBe(3)
    // The sync catch restores this snapshot; it must not be silently discarded.
    p.schedule(session('a', { title: 'restored edit' }), { legacy: true })
    await expect(p.flush()).rejects.toThrow('rollback failed')
    expect(rollbackAttempts).toBe(6)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(rollbackAttempts).toBe(6)
    expect(b.threads.has('a')).toBe(false)
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!)).toEqual(['a'])
    // Disk is still broken: do not pretend this is restart-safe recovery.
    expect((await loadCoworkSessions(b.invoke, { migrationSettled: false })).sessions).toEqual([])
    broken = false
    await p.flush()
    expect(rollbackAttempts).toBe(7)
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!)).toEqual([])
    expect(b.threads.get('a')!.title).toBe('restored edit')
    expect((await loadCoworkSessions(b.invoke, { migrationSettled: false })).sessions.map((s) => s.id)).toEqual(['a'])
    await p.flush()
    expect(rollbackAttempts).toBe(7)
  })

  it('rollback preserves concurrent deletion intent and successful deletes cannot resurrect', async () => {
    b.settings.set(COWORK_DELETED_IDS_KEY, JSON.stringify(['already-deleted']))
    b.settings.set(CODE_SESSIONS_KEY, JSON.stringify({
      state: { sessions: ['a', 'b', 'already-deleted'].map((id) => session(id)) }, version: 1,
    }))
    let rejectDelete!: (e: Error) => void
    let started!: () => void
    const deleting = new Promise<void>((resolve) => (started = resolve))
    const gate = new Promise<void>((_resolve, reject) => (rejectDelete = reject))
    const invoke = async (cmd: string, args: any) => {
      if (cmd === 'delete_thread' && args.threadId === 'a') {
        started()
        await gate
      }
      return b.invoke(cmd, args)
    }
    const p = createCoworkPersistence(invoke as any)
    const failed = expect(p.remove('a', { recordDeleted: true })).rejects.toThrow('delete failed')
    await deleting
    await p.remove('b', { recordDeleted: true })
    rejectDelete(new Error('delete failed'))
    await failed
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!).sort()).toEqual(['already-deleted', 'b'])
    p.schedule(session('b', { title: 'late edit' }))
    await p.flush()
    expect(b.threads.has('b')).toBe(false)
    const loaded = await loadCoworkSessions(b.invoke, { migrationSettled: false })
    expect(loaded.sessions.map((s) => s.id)).toEqual(['a'])
  })

  it('does not roll back a pre-existing legitimate deletion marker', async () => {
    b = makeBackend({ failNext: { cmd: 'delete_thread', times: 1 } })
    b.settings.set(COWORK_DELETED_IDS_KEY, JSON.stringify(['a', 'other']))
    const p = createCoworkPersistence(b.invoke)
    await expect(p.remove('a', { recordDeleted: true })).rejects.toThrow('delete_thread failed')
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!)).toEqual(['a', 'other'])
  })

  it('keeps deletion intent if notification fails after the backend has deleted the thread', async () => {
    const p = createCoworkPersistence(b.invoke, {
      onThreadRemoved: () => { throw new Error('notification failed') },
    })
    await expect(p.remove('a', { recordDeleted: true })).rejects.toThrow('notification failed')
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!)).toEqual(['a'])
  })

  it('does not delete files when journaling fails and the journal queue remains usable', async () => {
    b = makeBackend({ failNext: { cmd: 'settings_set', times: 1 } })
    const p = createCoworkPersistence(b.invoke)
    await expect(p.remove('a', { recordDeleted: true })).rejects.toThrow('settings_set failed')
    expect(b.log).not.toContain('delete_thread')
    await p.remove('b', { recordDeleted: true })
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!)).toEqual(['b'])
  })

  it('a failed deletion is surfaced and does not permanently block session writes', async () => {
    b = makeBackend({ failNext: { cmd: 'delete_thread', times: 1 } })
    const p = createCoworkPersistence(b.invoke)
    p.schedule(session('a'))
    await p.flush()
    await expect(p.remove('a')).rejects.toThrow('delete_thread failed')
    p.schedule(session('a', { title: 'still editable' }))
    await p.flush()
    expect(b.threads.get('a')!.title).toBe('still editable')
  })

  it('deleting a collision placeholder never deletes or unlists the unrelated chat', async () => {
    b.threads.set('collision', { id: 'collision', title: 'Original chat' })
    const onRemoved = vi.fn()
    const p = createCoworkPersistence(b.invoke, { onThreadRemoved: onRemoved })
    await p.remove('collision', { preserveThread: true, recordDeleted: true })
    expect(b.threads.get('collision')!.title).toBe('Original chat')
    expect(onRemoved).not.toHaveBeenCalled()
    expect(JSON.parse(b.settings.get(COWORK_DELETED_IDS_KEY)!)).toContain('collision')
  })

  it('never writes sessions flagged unavailable (files are preserved)', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 5 })
    p.schedule(session('a', { unavailable: 'unreadable-sidecar' }))
    await p.flush()
    expect(b.log).not.toContain('create_thread')
    expect(b.log).not.toContain('write_thread_extra:a')
  })

  it('stamps migratedFrom on legacy-sourced first writes', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 5 })
    p.schedule(session('a'), { legacy: true })
    await p.flush()
    expect(b.threads.get('a')!.metadata.migratedFrom.store).toBe(CODE_SESSIONS_KEY)
  })

  it('a thread that already exists on disk is updated, not duplicated, and keeps its metadata', async () => {
    b.threads.set('a', {
      id: 'a',
      created: 5,
      assistants: [{ id: 'model-only', name: 'Model', model: { id: 'x', engine: 'y' } }],
      metadata: { mode: 'cowork', is_favorite: true, order: 3 },
    })
    const p = createCoworkPersistence(b.invoke, { debounceMs: 5 })
    p.schedule(session('a', { title: 'renamed' }))
    await p.flush()
    const t = b.threads.get('a')!
    expect(t.title).toBe('renamed')
    expect(t.created).toBe(5)
    expect(t.metadata.is_favorite).toBe(true)
    expect(t.metadata.order).toBe(3)
  })

  it('persists the current id and clears it with null', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 5 })
    p.setCurrentId('a')
    await p.flush()
    expect(b.settings.get(COWORK_CURRENT_ID_KEY)).toBe('a')
    p.setCurrentId(null)
    await p.flush()
    expect(b.settings.has(COWORK_CURRENT_ID_KEY)).toBe(false)
  })
})

describe('thread record mapping', () => {
  it('round-trips a session through the thread record (model, folder, plan mode, seconds)', () => {
    const s = session('a', { planMode: true })
    const rec = sessionToThreadRecord(s)
    expect(rec.assistants[0].model).toEqual({ id: 'gpt', engine: 'openai' })
    expect(rec.updated).toBe(1_700_000_000)
    const back = sessionFromThread(rec, {
      version: 1,
      turns: s.turns,
      messages: s.messages,
    })
    expect(back.model).toEqual({ id: 'gpt', provider: 'openai' })
    expect(back.folder).toBe('/proj')
    expect(back.planMode).toBe(true)
    expect(back.updated).toBe(1_700_000_000_000)
  })

  it('does not rewrite created and drops cleared plan mode / goal', () => {
    const rec = sessionToThreadRecord(session('a'), {
      id: 'a',
      created: 9,
      metadata: { mode: 'cowork', planMode: true, goal: { condition: 'x' } },
    })
    expect(rec.created).toBe(9)
    expect(rec.metadata.planMode).toBeUndefined()
    expect(rec.metadata.goal).toBeUndefined()
  })
})

describe('loadCoworkSessions', () => {
  let b: ReturnType<typeof makeBackend>
  beforeEach(() => {
    b = makeBackend()
  })
  const commit = (id: string, extra: Json = {}) => {
    b.threads.set(id, { ...sessionToThreadRecord(session(id, extra)) })
    b.extras.set(id, { version: 1, turns: session(id).turns, messages: session(id).messages })
  }

  it('loads cowork threads only, newest first, and ignores chat threads', async () => {
    commit('old', { updated: 1_600_000_000_000 })
    commit('new', { updated: 1_700_000_000_000 })
    b.threads.set('chat', { id: 'chat', metadata: {} })
    const r = await loadCoworkSessions(b.invoke, { migrationSettled: true })
    expect(r.sessions.map((s) => s.id)).toEqual(['new', 'old'])
  })

  it('shows a session with a corrupt or missing sidecar as unavailable instead of hiding it', async () => {
    commit('ok')
    b.threads.set('bad', sessionToThreadRecord(session('bad')))
    const broken = async (cmd: string, args: any) => {
      if (cmd === 'read_thread_extra' && args.threadId === 'bad') throw new Error('corrupt')
      return b.invoke(cmd, args)
    }
    b.threads.set('gone', sessionToThreadRecord(session('gone')))
    const r = await loadCoworkSessions(broken as any, { migrationSettled: true })
    expect(r.sessions.find((s) => s.id === 'bad')!.unavailable).toBe('unreadable-sidecar')
    expect(r.sessions.find((s) => s.id === 'gone')!.unavailable).toBe('missing-sidecar')
    expect(r.sessions.find((s) => s.id === 'ok')!.unavailable).toBeUndefined()
  })

  it('while the migration is unsettled, adds sessions only in the legacy blob', async () => {
    commit('migrated')
    b.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({ state: { sessions: [session('migrated'), session('only-legacy')] }, version: 1 })
    )
    const r = await loadCoworkSessions(b.invoke, { migrationSettled: false })
    expect(r.sessions.map((s) => s.id).sort()).toEqual(['migrated', 'only-legacy'])
    expect([...r.legacyIds]).toEqual(['only-legacy'])
  })

  it('does not read the legacy blob once the migration is settled', async () => {
    b.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({ state: { sessions: [session('x')] }, version: 1 })
    )
    const r = await loadCoworkSessions(b.invoke, { migrationSettled: true })
    expect(r.sessions).toHaveLength(0)
  })

  it('honours deleted ids and flags an id collision with a chat thread as unavailable', async () => {
    b.threads.set('chat-id', { id: 'chat-id', metadata: {} })
    b.settings.set(COWORK_DELETED_IDS_KEY, JSON.stringify(['deleted']))
    b.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({
        state: { sessions: [session('deleted'), session('chat-id'), session('fine')] },
        version: 1,
      })
    )
    const r = await loadCoworkSessions(b.invoke, { migrationSettled: false })
    const ids = r.sessions.map((s) => s.id).sort()
    expect(ids).toEqual(['chat-id', 'fine'])
    expect(r.sessions.find((s) => s.id === 'chat-id')!.unavailable).toBe('id-collision')
  })

  it('resumes the saved current id only if that session still exists', async () => {
    commit('a')
    b.settings.set(COWORK_CURRENT_ID_KEY, 'a')
    expect((await loadCoworkSessions(b.invoke, { migrationSettled: true })).currentId).toBe('a')
    b.settings.set(COWORK_CURRENT_ID_KEY, 'zzz')
    expect((await loadCoworkSessions(b.invoke, { migrationSettled: true })).currentId).toBeNull()
  })
})
