import { describe, it, expect, beforeEach } from 'vitest'
import {
  migrateCoworkSessionsToThreads,
  isCoworkMigrationSettled,
  CODE_SESSIONS_KEY,
  COWORK_MIGRATION_FLAG_KEY,
} from '../migrateCoworkSessions'

type Json = Record<string, any>

// In-memory backend with the same command surface the migration uses.
function makeBackend(opts: { failCreateFor?: string; failWriteFor?: string } = {}) {
  const settings = new Map<string, string>()
  const threads = new Map<string, Json>()
  const extras = new Map<string, unknown>()
  const calls: string[] = []
  const invoke = async (cmd: string, args: Record<string, any> = {}) => {
    calls.push(cmd)
    switch (cmd) {
      case 'settings_get':
        return settings.get(args.key) ?? null
      case 'settings_set':
        settings.set(args.key, args.value)
        return
      case 'list_threads':
        return [...threads.values()]
      case 'write_thread_extra':
        if (args.threadId === opts.failWriteFor) throw new Error('disk full')
        // Mimic serde_json (sorted keys) by round-tripping through JSON.
        extras.set(`${args.threadId}/${args.name}`, JSON.parse(JSON.stringify(args.value)))
        return
      case 'read_thread_extra':
        return extras.get(`${args.threadId}/${args.name}`) ?? null
      case 'create_thread':
        if (args.thread.id === opts.failCreateFor) throw new Error('boom')
        threads.set(args.thread.id, args.thread)
        return args.thread
      default:
        throw new Error(`unexpected command ${cmd}`)
    }
  }
  return { invoke: invoke as any, settings, threads, extras, calls }
}

const session = (id: string, extra: Json = {}): any => ({
  id,
  title: `Session ${id}`,
  model: { id: 'gpt', provider: 'openai' },
  folder: '/work/proj',
  turns: [{ role: 'user', content: 'hi' }],
  messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
  updated: 1_700_000_000_000,
  ...extra,
})

const envelope = (sessions: any[], version = 1) =>
  JSON.stringify({ state: { sessions, currentId: null }, version })

describe('migrateCoworkSessionsToThreads', () => {
  let b: ReturnType<typeof makeBackend>
  beforeEach(() => {
    b = makeBackend()
  })

  it('sets the marker and writes nothing when there is no blob (stable path)', async () => {
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.status).toBe('nothing-to-migrate')
    expect(b.settings.get(COWORK_MIGRATION_FLAG_KEY)).toBe('true')
    expect(b.threads.size).toBe(0)
    expect(b.calls).not.toContain('create_thread')
  })

  it('maps a session to a cowork thread and a lossless sidecar', async () => {
    const s = session('s1', {
      planMode: true,
      goal: { condition: 'done', turns: 1, status: 'active', lastReason: '' },
      todos: { phases: [] },
      subagents: [{ runId: 'r1' }],
      history: [{ role: 'user', content: 'old' }],
    })
    b.settings.set(CODE_SESSIONS_KEY, envelope([s]))
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.status).toBe('complete')
    expect(r.migrated).toEqual(['s1'])

    const t = b.threads.get('s1')!
    expect(t.metadata.mode).toBe('cowork')
    expect(t.metadata.folder).toBe('/work/proj')
    expect(t.metadata.planMode).toBe(true)
    expect(t.metadata.migratedFrom).toEqual({ store: CODE_SESSIONS_KEY, updated: s.updated })
    expect(t.assistants[0].model).toEqual({ id: 'gpt', engine: 'openai' })
    // ms -> seconds
    expect(t.updated).toBe(1_700_000_000)
    expect(t.created).toBe(1_700_000_000)

    const side: any = b.extras.get('s1/cowork')
    expect(side.turns).toEqual(s.turns)
    expect(side.messages).toEqual(s.messages)
    expect(side.history).toEqual(s.history)
    expect(side.subagents).toEqual(s.subagents)
    expect(side.todos).toEqual(s.todos)
  })

  it('never touches the source blob', async () => {
    const raw = envelope([session('s1')])
    b.settings.set(CODE_SESSIONS_KEY, raw)
    await migrateCoworkSessionsToThreads(b.invoke)
    expect(b.settings.get(CODE_SESSIONS_KEY)).toBe(raw)
  })

  it('is a no-op once the marker is set', async () => {
    b.settings.set(CODE_SESSIONS_KEY, envelope([session('s1')]))
    await migrateCoworkSessionsToThreads(b.invoke)
    b.calls.length = 0
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.status).toBe('already-migrated')
    expect(b.calls).toEqual(['settings_get'])
  })

  it('is idempotent when the marker is lost: committed sessions are skipped, not rewritten', async () => {
    b.settings.set(CODE_SESSIONS_KEY, envelope([session('s1')]))
    await migrateCoworkSessionsToThreads(b.invoke)
    b.settings.delete(COWORK_MIGRATION_FLAG_KEY)
    b.calls.length = 0
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.status).toBe('complete')
    expect(r.skipped).toContain('s1')
    expect(b.calls).not.toContain('write_thread_extra')
    expect(b.calls).not.toContain('create_thread')
  })

  it('skips empty sessions', async () => {
    b.settings.set(
      CODE_SESSIONS_KEY,
      envelope([session('full'), session('empty', { turns: [], messages: [] })])
    )
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.migrated).toEqual(['full'])
    expect(r.skipped).toContain('empty')
    expect(b.threads.has('empty')).toBe(false)
  })

  it('crash recovery: a sidecar without thread.json is redone, not skipped', async () => {
    b.settings.set(CODE_SESSIONS_KEY, envelope([session('s1')]))
    // Simulate a crash after the sidecar write: sidecar exists, no thread.json.
    b.extras.set('s1/cowork', { version: 1, turns: [], messages: [] })
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.migrated).toEqual(['s1'])
    expect(b.threads.has('s1')).toBe(true)
    expect((b.extras.get('s1/cowork') as any).turns).toHaveLength(1)
  })

  it('partial failure leaves the marker unset and migrates the rest', async () => {
    b = makeBackend({ failCreateFor: 's2' })
    b.settings.set(CODE_SESSIONS_KEY, envelope([session('s1'), session('s2'), session('s3')]))
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.status).toBe('partial')
    expect(r.migrated).toEqual(['s1', 's3'])
    expect(r.failed).toEqual([{ id: 's2', error: 'boom' }])
    expect(b.settings.has(COWORK_MIGRATION_FLAG_KEY)).toBe(false)
    expect(await isCoworkMigrationSettled(b.invoke)).toBe(false)
  })

  it('a failed sidecar write never commits thread.json', async () => {
    b = makeBackend({ failWriteFor: 's1' })
    b.settings.set(CODE_SESSIONS_KEY, envelope([session('s1')]))
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.status).toBe('partial')
    expect(b.threads.has('s1')).toBe(false)
  })

  it('an id collision with a chat thread is reported, not overwritten', async () => {
    b.threads.set('s1', { id: 's1', title: 'My chat', metadata: {} })
    b.settings.set(CODE_SESSIONS_KEY, envelope([session('s1')]))
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.status).toBe('partial')
    expect(r.failed[0].id).toBe('s1')
    expect(b.threads.get('s1')!.title).toBe('My chat')
    expect(b.extras.has('s1/cowork')).toBe(false)
    expect(b.settings.has(COWORK_MIGRATION_FLAG_KEY)).toBe(false)
  })

  it('rebuilds messages for version-0 sessions that have none', async () => {
    const v0 = session('old', { turns: [{ role: 'user', content: 'hello' }] })
    delete v0.messages
    b.settings.set(CODE_SESSIONS_KEY, envelope([v0], 0))
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.migrated).toEqual(['old'])
    const side: any = b.extras.get('old/cowork')
    expect(side.messages.length).toBeGreaterThan(0)
  })

  it('a corrupt blob does not throw into startup and leaves the marker unset', async () => {
    b.settings.set(CODE_SESSIONS_KEY, '{not json')
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.status).toBe('partial')
    expect(b.settings.has(COWORK_MIGRATION_FLAG_KEY)).toBe(false)
  })
})
