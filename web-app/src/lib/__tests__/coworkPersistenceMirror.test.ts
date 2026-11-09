import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createCoworkPersistence,
  loadCoworkSessions,
  sessionToThreadRecord,
} from '../coworkPersistence'
import {
  CODE_SESSIONS_KEY,
  COWORK_MIGRATED_IDS_KEY,
  COWORK_MIGRATION_ABANDONED_KEY,
} from '../migrateCoworkSessions'
import { coworkSessionToThreadMessages } from '../coworkThreadMessages'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>

// In-memory backend with the Rust commands' semantics for the surface the
// write-through uses, plus switches to inject failures.
function makeBackend() {
  const settings = new Map<string, string>()
  const threads = new Map<string, Json>()
  const extras = new Map<string, any>()
  const logs = new Map<string, any[]>()
  const log: string[] = []
  const messageFailure: { error: unknown } = { error: null }
  const invoke = async (cmd: string, args: Record<string, any> = {}) => {
    log.push(cmd === 'write_thread_extra' ? `${cmd}:${args.threadId}` : cmd)
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
          throw new Error('thread_missing: Thread has no thread.json')
        }
        extras.set(args.threadId, JSON.parse(JSON.stringify(args.value)))
        return
      case 'replace_thread_messages':
        if (!args.create && !threads.has(args.threadId)) {
          throw new Error('thread_missing: Thread has no thread.json')
        }
        if (messageFailure.error) throw messageFailure.error
        logs.set(args.threadId, JSON.parse(JSON.stringify(args.messages)))
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
        logs.delete(args.threadId)
        return
      default:
        throw new Error(`unexpected ${cmd}`)
    }
  }
  return { invoke: invoke as any, settings, threads, extras, logs, log, messageFailure }
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

const reply = { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'answer' }] }

describe('messages.jsonl mirror (derived projection)', () => {
  let b: ReturnType<typeof makeBackend>
  beforeEach(() => {
    vi.useFakeTimers()
    b = makeBackend()
  })
  afterEach(() => vi.useRealTimers())

  it('writes the sidecar first, then the converted messages, then thread.json last', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10 })
    p.schedule(session('a'))
    await p.flush()
    const order = b.log.filter((c) =>
      ['write_thread_extra:a', 'replace_thread_messages', 'create_thread'].includes(c)
    )
    expect(order).toEqual(['write_thread_extra:a', 'replace_thread_messages', 'create_thread'])
    const anchor = b.threads.get('a')!.metadata.messagesAnchorMs as number
    expect(b.logs.get('a')).toEqual(
      JSON.parse(JSON.stringify(coworkSessionToThreadMessages(session('a'), { anchorMs: anchor })))
    )
  })

  it('the first mirror creates the directory, later ones need the thread', async () => {
    const creates: unknown[] = []
    const spy = async (cmd: string, args: any) => {
      if (cmd === 'replace_thread_messages') creates.push(args.create)
      return b.invoke(cmd, args)
    }
    const p = createCoworkPersistence(spy as any, { debounceMs: 10 })
    const s = session('a')
    p.schedule(s)
    await p.flush()
    p.schedule({ ...s, messages: [...s.messages, reply] })
    await p.flush()
    expect(creates).toEqual([true, false])
  })

  it('is idempotent: re-flushing an unchanged transcript rewrites nothing', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10 })
    const s = session('a')
    p.schedule(s)
    await p.flush()
    b.log.length = 0
    // A title edit keeps the very same transcript arrays.
    p.schedule({ ...s, title: 'renamed' })
    await p.flush()
    expect(b.log).not.toContain('replace_thread_messages')
    expect(b.threads.get('a')!.title).toBe('renamed')
  })

  it('appending a turn never changes the stamps or ids of messages already written (prefix stays byte-stable)', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10 })
    const s1 = session('a')
    p.schedule(s1)
    await p.flush()
    const first = JSON.stringify(b.logs.get('a')![0])
    p.schedule({
      ...s1,
      updated: s1.updated + 999_000,
      messages: [...s1.messages, reply],
      turns: [...s1.turns, { role: 'assistant', content: 'answer' }],
    })
    await p.flush()
    const after = b.logs.get('a')!
    expect(after).toHaveLength(2)
    expect(JSON.stringify(after[0])).toBe(first)
    expect(after[1].created_at).toBeGreaterThan(after[0].created_at)
  })

  it('a failed mirror retries on its own, never blocks the sidecar or the record, and does not reject flush', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10, retryMs: 50 })
    b.messageFailure.error = new Error('disk full')
    p.schedule(session('a'))
    await p.flush() // resolves: the authoritative data is durable
    expect(b.extras.has('a')).toBe(true)
    expect(b.threads.has('a')).toBe(true)
    expect(b.logs.has('a')).toBe(false)
    b.messageFailure.error = null
    await vi.advanceTimersByTimeAsync(100)
    await p.flush()
    expect(b.logs.has('a')).toBe(true)
  })

  it('a failed mirror does not stop a later sidecar write from landing', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10, retryMs: 10_000 })
    p.schedule(session('a'))
    await p.flush()
    b.messageFailure.error = new Error('disk full')
    p.schedule(session('a', { title: 'newer', turns: [], messages: [], cleared: true }))
    await p.flush()
    expect(b.extras.get('a').turns).toHaveLength(0)
    expect(b.threads.get('a')!.title).toBe('newer')
  })

  it('a PERMANENT mirror refusal is reported once and not retried', async () => {
    const onError = vi.fn()
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10, retryMs: 20, onError })
    b.messageFailure.error = new Error('PERMANENT: Thread has messages but no thread.json')
    p.schedule(session('a'))
    await p.flush()
    const errors = onError.mock.calls.length
    await vi.advanceTimersByTimeAsync(500)
    expect(onError.mock.calls.length).toBe(errors)
    expect(b.extras.has('a')).toBe(true)
  })

  it('a missing thread during a later write flags the session instead of recreating it', async () => {
    const onThreadMissing = vi.fn()
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10, onThreadMissing })
    p.schedule(session('a'))
    await p.flush()
    b.threads.delete('a') // deleted underneath us
    p.schedule(session('a', { title: 'late' }))
    await p.flush()
    expect(onThreadMissing).toHaveBeenCalledWith('a', expect.anything())
    expect(b.threads.has('a')).toBe(false)
  })

  it('delete drops a pending mirror and removes the log with the thread', async () => {
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10 })
    p.schedule(session('a'))
    await p.flush()
    p.schedule(session('a', { title: 'x', messages: [] }))
    await p.remove('a')
    await vi.advanceTimersByTimeAsync(100)
    expect(b.logs.has('a')).toBe(false)
    expect(b.threads.has('a')).toBe(false)
  })

  it('a crash between the sidecar and thread.json lists nothing, and the retry replaces (never appends)', async () => {
    let crash = true
    const flaky = async (cmd: string, args: any) => {
      if (cmd === 'create_thread' && crash) {
        crash = false
        throw new Error('process died')
      }
      return b.invoke(cmd, args)
    }
    const p = createCoworkPersistence(flaky as any, { debounceMs: 10, retryMs: 20 })
    p.schedule(session('a'))
    await vi.advanceTimersByTimeAsync(15)
    expect(b.threads.has('a')).toBe(false) // not committed, so not listed
    await vi.advanceTimersByTimeAsync(100)
    await p.flush()
    expect(b.threads.has('a')).toBe(true)
    expect(b.logs.get('a')).toHaveLength(1)
  })
})

describe('legacy sessions and the deletion journal', () => {
  let b: ReturnType<typeof makeBackend>
  beforeEach(() => {
    vi.useFakeTimers()
    b = makeBackend()
  })
  afterEach(() => vi.useRealTimers())

  it('a legacy session edited during the background migration is written only after it settles', async () => {
    let release!: () => void
    const legacyGate = new Promise<void>((r) => (release = r))
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10, legacyGate })
    p.schedule(session('legacy'), { legacy: true })
    p.schedule(session('fresh'))
    await vi.advanceTimersByTimeAsync(50)
    expect(b.extras.has('fresh')).toBe(true) // a non-legacy session is never held back
    expect(b.extras.has('legacy')).toBe(false)
    release()
    await p.flush()
    expect(b.extras.has('legacy')).toBe(true)
  })

  it('a rejected gate still releases the held write', async () => {
    const p = createCoworkPersistence(b.invoke, {
      debounceMs: 10,
      legacyGate: Promise.reject(new Error('migration blew up')),
    })
    p.schedule(session('legacy'), { legacy: true })
    await p.flush()
    expect(b.extras.has('legacy')).toBe(true)
  })

  it('a deleted legacy session is journaled and never comes back from the untouched blob', async () => {
    b.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({ state: { sessions: [session('gone'), session('stay')] }, version: 1 })
    )
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10 })
    await p.remove('gone', { recordDeleted: true })
    const blobBefore = b.settings.get(CODE_SESSIONS_KEY)
    const r = await loadCoworkSessions(b.invoke, { migrationSettled: false })
    expect(r.sessions.map((s) => s.id)).toEqual(['stay'])
    expect(b.settings.get(CODE_SESSIONS_KEY)).toBe(blobBefore) // rollback source untouched
  })

  it('a migrated id whose thread is gone stays deleted; a present one is not duplicated', async () => {
    b.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({ state: { sessions: [session('m-gone'), session('m-here')] }, version: 1 })
    )
    b.settings.set(COWORK_MIGRATED_IDS_KEY, JSON.stringify(['m-gone', 'm-here']))
    b.threads.set('m-here', sessionToThreadRecord(session('m-here')))
    b.extras.set('m-here', {
      version: 1,
      turns: session('m-here').turns,
      messages: session('m-here').messages,
    })
    const r = await loadCoworkSessions(b.invoke, { migrationSettled: false })
    expect(r.sessions.map((s) => s.id)).toEqual(['m-here'])
  })

  it('an abandoned legacy session stays visible but read-only (never written)', async () => {
    b.settings.set(
      CODE_SESSIONS_KEY,
      JSON.stringify({ state: { sessions: [session('bad')] }, version: 1 })
    )
    b.settings.set(
      COWORK_MIGRATION_ABANDONED_KEY,
      JSON.stringify([{ id: 'bad', error: 'PERMANENT: nope' }])
    )
    // Even a settled migration shows it: nothing disappears silently.
    const r = await loadCoworkSessions(b.invoke, { migrationSettled: true })
    expect(r.sessions.map((s) => [s.id, s.unavailable])).toEqual([['bad', 'id-collision']])
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10 })
    p.schedule(r.sessions[0])
    await p.flush()
    expect(b.extras.has('bad')).toBe(false)
  })

  it('a PERMANENT write refusal stops retries and reports the session once', async () => {
    const onWriteRefused = vi.fn()
    const refusing = async (cmd: string, args: any) => {
      if (cmd === 'write_thread_extra') throw new Error('PERMANENT: Invalid thread id')
      return b.invoke(cmd, args)
    }
    const p = createCoworkPersistence(refusing as any, {
      debounceMs: 10,
      retryMs: 20,
      onWriteRefused,
    })
    p.schedule(session('a'))
    await p.flush()
    await vi.advanceTimersByTimeAsync(500)
    expect(onWriteRefused).toHaveBeenCalledTimes(1)
    expect(b.threads.has('a')).toBe(false)
  })

  it('edits made in the shared thread list (rename, favorite, order, project) survive the next write-through', async () => {
    const live: Json = {}
    const p = createCoworkPersistence(b.invoke, { debounceMs: 10, liveRecord: () => live })
    const s = session('a')
    p.schedule(s)
    await p.flush()
    live.title = 'Renamed by the user'
    live.metadata = {
      titleSetManually: true,
      is_favorite: true,
      order: 3,
      project: { id: 'p', name: 'P', updated_at: 1 },
    }
    p.schedule({
      ...s,
      title: 'Auto title',
      turns: [...s.turns, { role: 'assistant', content: 'more' }],
    })
    await p.flush()
    const rec = b.threads.get('a')!
    expect(rec.title).toBe('Renamed by the user')
    expect(rec.metadata.is_favorite).toBe(true)
    expect(rec.metadata.order).toBe(3)
    expect(rec.metadata.project.id).toBe('p')
  })
})
