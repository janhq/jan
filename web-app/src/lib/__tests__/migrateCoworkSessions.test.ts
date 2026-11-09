import { describe, it, expect, beforeEach } from 'vitest'
import {
  migrateCoworkSessionsToThreads,
  CODE_SESSIONS_KEY,
  COWORK_MIGRATION_FLAG_KEY,
  type Invoke,
} from '../migrateCoworkSessions'
import type { CoworkSession } from '@/hooks/useCoworkSessions'

type Json = Record<string, unknown>
type Args = Record<string, unknown>

type BackendOptions = {
  failCreateFor?: string
  failWriteFor?: string
  // Fails the first create_thread only, like a crash before the commit.
  crashFirstCreate?: boolean
}

// In-memory backend with the same command surface the migration uses.
function makeBackend(opts: BackendOptions = {}) {
  const settings = new Map<string, string>()
  const threads = new Map<string, Json>()
  const extras = new Map<string, unknown>()
  // The messages.jsonl text per thread, so tests can compare bytes.
  const logs = new Map<string, string>()
  let crashPending = opts.crashFirstCreate ?? false
  const calls: string[] = []
  const invoke: Invoke = async <T = unknown>(cmd: string, args: Args = {}) => {
    calls.push(cmd)
    const threadId = args.threadId as string
    const key = args.key as string
    switch (cmd) {
      case 'settings_get':
        return (settings.get(key) ?? null) as T
      case 'settings_set':
        settings.set(key, args.value as string)
        return undefined as T
      case 'list_threads':
        return [...threads.values()] as T
      case 'write_thread_extra':
        if (threadId === opts.failWriteFor) throw new Error('disk full')
        if (!args.create && !threads.has(threadId))
          throw new Error('no thread.json')
        // Mimic serde_json by round-tripping through JSON.
        extras.set(
          `${threadId}/${args.name}`,
          JSON.parse(JSON.stringify(args.value))
        )
        return undefined as T
      case 'read_thread_extra':
        return (extras.get(`${threadId}/${args.name}`) ?? null) as T
      case 'replace_thread_messages': {
        if (!args.create && !threads.has(threadId))
          throw new Error('no thread.json')
        // Replace, never append: the same contract as the Rust command.
        const lines = (args.messages as Json[]).map((m) => JSON.stringify(m))
        logs.set(threadId, lines.map((l) => `${l}\n`).join(''))
        return undefined as T
      }
      case 'list_messages':
        return (logs.get(threadId) ?? '')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l)) as T
      case 'create_thread': {
        const thread = args.thread as Json & { id: string }
        if (thread.id === opts.failCreateFor) throw new Error('boom')
        if (crashPending) {
          crashPending = false
          throw new Error('crash before commit')
        }
        threads.set(thread.id, thread)
        return thread as T
      }
      default:
        throw new Error(`unexpected command ${cmd}`)
    }
  }
  return { invoke, settings, threads, extras, logs, calls }
}

const session = (id: string, extra: Partial<CoworkSession> = {}) =>
  ({
    id,
    title: `Session ${id}`,
    model: { id: 'gpt', provider: 'openai' },
    folder: '/work/proj',
    turns: [{ role: 'user', content: 'hi' }],
    messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    updated: 1_700_000_000_000,
    ...extra,
  }) as unknown as CoworkSession

const envelope = (sessions: unknown[], version = 1) =>
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
    } as unknown as Partial<CoworkSession>)
    b.settings.set(CODE_SESSIONS_KEY, envelope([s]))
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.status).toBe('complete')
    expect(r.migrated).toEqual(['s1'])

    const t = b.threads.get('s1') as {
      metadata: Json
      assistants: { id: string; model: unknown }[]
      updated: number
      created: number
    }
    expect(t.metadata.mode).toBe('cowork')
    expect(t.metadata.folder).toBe('/work/proj')
    expect(t.metadata.planMode).toBe(true)
    expect(t.metadata.migratedFrom).toEqual({
      store: CODE_SESSIONS_KEY,
      updated: s.updated,
    })
    // Same assistant shape main's thread service writes for a model-only chat.
    expect(t.assistants[0].id).toBe('model-only')
    expect(t.assistants[0].model).toEqual({ id: 'gpt', engine: 'openai' })
    // ms -> seconds
    expect(t.updated).toBe(1_700_000_000)
    expect(t.created).toBe(1_700_000_000)

    const side = b.extras.get('s1/cowork') as Json
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
    expect(b.settings.get(COWORK_MIGRATION_FLAG_KEY)).toBe('true')
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
    expect((b.extras.get('s1/cowork') as { turns: unknown[] }).turns).toHaveLength(1)
  })

  it('writes the sidecar before thread.json, which is the commit marker', async () => {
    b.settings.set(CODE_SESSIONS_KEY, envelope([session('s1')]))
    await migrateCoworkSessionsToThreads(b.invoke)
    expect(b.calls.indexOf('write_thread_extra')).toBeGreaterThan(-1)
    expect(b.calls.indexOf('write_thread_extra')).toBeLessThan(
      b.calls.indexOf('create_thread')
    )
  })

  it('partial failure leaves the marker unset and migrates the rest', async () => {
    b = makeBackend({ failCreateFor: 's2' })
    b.settings.set(
      CODE_SESSIONS_KEY,
      envelope([session('s1'), session('s2'), session('s3')])
    )
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.status).toBe('partial')
    expect(r.migrated).toEqual(['s1', 's3'])
    expect(r.failed).toEqual([{ id: 's2', error: 'boom' }])
    expect(b.settings.has(COWORK_MIGRATION_FLAG_KEY)).toBe(false)
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

  it('fails a session when the backend assigns a different thread id', async () => {
    const invoke: Invoke = async <T = unknown>(cmd: string, args?: Args) =>
      cmd === 'create_thread'
        ? ({ ...(args!.thread as Json), id: 'other' } as T)
        : b.invoke<T>(cmd, args)
    b.settings.set(CODE_SESSIONS_KEY, envelope([session('s1')]))
    const r = await migrateCoworkSessionsToThreads(invoke)
    expect(r.status).toBe('partial')
    expect(r.failed[0].id).toBe('s1')
    expect(b.settings.has(COWORK_MIGRATION_FLAG_KEY)).toBe(false)
  })

  it('rebuilds messages for version-0 sessions that have none', async () => {
    const v0: Partial<CoworkSession> = {
      ...session('old', { turns: [{ role: 'user', content: 'hello' }] as never }),
    }
    delete v0.messages
    b.settings.set(CODE_SESSIONS_KEY, envelope([v0], 0))
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.migrated).toEqual(['old'])
    const side = b.extras.get('old/cowork') as { messages: unknown[] }
    expect(side.messages.length).toBeGreaterThan(0)
  })

  it('a corrupt blob does not throw into startup and leaves the marker unset', async () => {
    b.settings.set(CODE_SESSIONS_KEY, '{not json')
    const r = await migrateCoworkSessionsToThreads(b.invoke)
    expect(r.status).toBe('partial')
    expect(b.settings.has(COWORK_MIGRATION_FLAG_KEY)).toBe(false)
  })

  it('a rejected settings read does not throw into startup', async () => {
    const invoke: Invoke = async () => {
      throw new Error('backend not ready')
    }
    const r = await migrateCoworkSessionsToThreads(invoke)
    expect(r.status).toBe('partial')
    expect(r.failed[0].error).toContain('backend not ready')
  })

  describe('transcript in messages.jsonl', () => {
    const rich = () =>
      session('s1', {
        messages: [
          { id: 'u', role: 'user', parts: [{ type: 'text', text: 'read it' }] },
          {
            id: 'a',
            role: 'assistant',
            parts: [
              { type: 'reasoning', text: 'hmm' },
              {
                type: 'tool-read',
                toolCallId: 'c1',
                input: { path: 'a' },
                state: 'output-available',
                output: 'body',
              },
              { type: 'tool-shell', toolCallId: 'c2', input: {}, state: 'input-available' },
              { type: 'text', text: 'done' },
            ],
          },
        ],
      } as unknown as Partial<CoworkSession>)

    const logOf = (id: string) =>
      b.invoke<Json[]>('list_messages', { threadId: id })

    it('writes the converted transcript before thread.json commits the thread', async () => {
      b.settings.set(CODE_SESSIONS_KEY, envelope([rich()]))
      await migrateCoworkSessionsToThreads(b.invoke)
      expect(b.calls.indexOf('replace_thread_messages')).toBeGreaterThan(-1)
      expect(b.calls.indexOf('replace_thread_messages')).toBeLessThan(
        b.calls.indexOf('create_thread')
      )
      const log = await logOf('s1')
      expect(log.map((m) => m.id)).toEqual(['s1-msg-0', 's1-msg-1'])
    })

    it('replaces rather than appends, even through the create path', async () => {
      b.settings.set(CODE_SESSIONS_KEY, envelope([rich()]))
      const calls = new Map<string, Args>()
      const invoke: Invoke = async <T = unknown>(cmd: string, args?: Args) => {
        if (cmd === 'replace_thread_messages') calls.set(cmd, args!)
        return b.invoke<T>(cmd, args)
      }
      await migrateCoworkSessionsToThreads(invoke)
      expect(calls.get('replace_thread_messages')?.create).toBe(true)
      expect(b.calls).not.toContain('create_message')
    })

    it('a crash between the messages write and the commit retries to identical bytes with no duplicates', async () => {
      b = makeBackend({ crashFirstCreate: true })
      b.settings.set(CODE_SESSIONS_KEY, envelope([rich()]))

      const first = await migrateCoworkSessionsToThreads(b.invoke)
      expect(first.status).toBe('partial')
      expect(b.threads.has('s1')).toBe(false)
      const afterCrash = b.logs.get('s1')
      expect(afterCrash).toBeTruthy()

      const retry = await migrateCoworkSessionsToThreads(b.invoke)
      expect(retry.status).toBe('complete')
      expect(b.threads.has('s1')).toBe(true)
      expect(b.logs.get('s1')).toBe(afterCrash)
      expect(await logOf('s1')).toHaveLength(2)
    })

    it('a retry replaces a stale partial log left by an older run', async () => {
      b.logs.set('s1', '{"id":"junk","thread_id":"s1"}\n')
      b.settings.set(CODE_SESSIONS_KEY, envelope([rich()]))
      await migrateCoworkSessionsToThreads(b.invoke)
      expect((await logOf('s1')).map((m) => m.id)).toEqual(['s1-msg-0', 's1-msg-1'])
    })

    it('two independent migrations of the same session write identical bytes', async () => {
      const other = makeBackend()
      b.settings.set(CODE_SESSIONS_KEY, envelope([rich()]))
      other.settings.set(CODE_SESSIONS_KEY, envelope([rich()]))
      await migrateCoworkSessionsToThreads(b.invoke)
      await migrateCoworkSessionsToThreads(other.invoke)
      expect(b.logs.get('s1')).toBeTruthy()
      expect(other.logs.get('s1')).toBe(b.logs.get('s1'))
    })

    it('every persisted tool call has its result or a recorded error', async () => {
      b.settings.set(CODE_SESSIONS_KEY, envelope([rich()]))
      await migrateCoworkSessionsToThreads(b.invoke)
      const assistant = (await logOf('s1'))[1] as {
        content: { type: string; tool_call_id?: string; output?: unknown }[]
        metadata: { toolErrors: Record<string, string> }
      }
      for (const c of assistant.content.filter((x) => x.type === 'tool_call')) {
        const answered =
          c.output !== undefined || c.tool_call_id! in assistant.metadata.toolErrors
        expect(answered).toBe(true)
      }
    })

    it('a failed messages write never commits thread.json', async () => {
      const invoke: Invoke = async <T = unknown>(cmd: string, args?: Args) => {
        if (cmd === 'replace_thread_messages') throw new Error('disk full')
        return b.invoke<T>(cmd, args)
      }
      b.settings.set(CODE_SESSIONS_KEY, envelope([rich()]))
      const r = await migrateCoworkSessionsToThreads(invoke)
      expect(r.status).toBe('partial')
      expect(b.threads.has('s1')).toBe(false)
    })

    it('fails the session when the messages do not read back identically', async () => {
      const invoke: Invoke = async <T = unknown>(cmd: string, args?: Args) =>
        cmd === 'list_messages' ? ([] as T) : b.invoke<T>(cmd, args)
      b.settings.set(CODE_SESSIONS_KEY, envelope([rich()]))
      const r = await migrateCoworkSessionsToThreads(invoke)
      expect(r.status).toBe('partial')
      expect(b.threads.has('s1')).toBe(false)
    })
  })
})
