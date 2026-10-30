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
