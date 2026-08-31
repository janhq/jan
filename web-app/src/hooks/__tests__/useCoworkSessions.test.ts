import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}))

import { useCoworkSessions } from '../useCoworkSessions'
import type { CoworkTurn, SubagentRun } from '@/types/coworkSession'

const reset = () =>
  useCoworkSessions.setState({ sessions: [], currentId: null })

const sub = (runId: string, name: string): SubagentRun => ({
  runId,
  name,
  status: 'done',
  startedAt: 0,
  turns: [],
})

describe('useCoworkSessions', () => {
  beforeEach(reset)

  it('starts a session with an empty message list', () => {
    const id = useCoworkSessions.getState().createSession()
    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.messages).toEqual([])
    expect(s.folder).toBeNull()
  })

  it('rewinds a run back to the question that started it', () => {
    const id = useCoworkSessions.getState().createSession()
    const turns: CoworkTurn[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'second' },
      { role: 'tool', content: '', name: 'read', status: 'done' },
      { role: 'assistant', content: 'answer' },
    ]
    const msgs = [
      { id: 'm1', role: 'user', parts: [] },
      { id: 'm2', role: 'assistant', parts: [] },
      { id: 'm3', role: 'user', parts: [] },
      { id: 'm4', role: 'assistant', parts: [] },
    ] as never
    useCoworkSessions.getState().commitTurns(id, turns, msgs, [])
    useCoworkSessions.getState().rewindToLastUser(id)

    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    // The question survives; the chain of tool calls it produced does not.
    expect(s.turns.map((t) => t.content)).toEqual(['first', 'done', 'second'])
    expect(s.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  // Rewinding a session that has never had a turn would otherwise empty it.
  it('leaves a session with no user turn alone', () => {
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions.getState().rewindToLastUser(id)
    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.turns).toEqual([])
    expect(s.messages).toEqual([])
  })

  it('appends turns and replaces the message list on commit', () => {
    const id = useCoworkSessions.getState().createSession()
    const turn: CoworkTurn = { role: 'user', content: 'hi' }
    const msgs = [{ id: 'm1', role: 'user', parts: [] }] as never
    useCoworkSessions.getState().commitTurns(id, [turn], msgs, [])
    useCoworkSessions.getState().commitTurns(id, [turn], msgs, [])
    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.turns).toHaveLength(2)
    expect(s.messages).toHaveLength(1)
  })

  // A later run that dispatches no subagents must not erase what an earlier
  // run in the same session already finished.
  it('merges subagents by runId across runs instead of replacing', () => {
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions.getState().commitTurns(id, [], [], [sub('r1', 'alpha')])
    useCoworkSessions.getState().commitTurns(id, [], [], [])
    let s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.subagents?.map((r) => r.runId)).toEqual(['r1'])

    useCoworkSessions.getState().commitTurns(id, [], [], [sub('r1', 'renamed')])
    s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.subagents).toHaveLength(1)
    expect(s.subagents?.[0].name).toBe('renamed')
  })

  it('keeps the last usage when a run reports none', () => {
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions
      .getState()
      .commitTurns(id, [], [], [], { total_tokens: 42 })
    useCoworkSessions.getState().commitTurns(id, [], [], [])
    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.lastUsage?.total_tokens).toBe(42)
  })

  it('clears the transcript, messages and subagents together', () => {
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions
      .getState()
      .commitTurns(
        id,
        [{ role: 'user', content: 'hi' }],
        [{ id: 'm1', role: 'user', parts: [] }] as never,
        [sub('r1', 'alpha')],
        { total_tokens: 1 }
      )
    useCoworkSessions.getState().clearSession(id)
    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.turns).toEqual([])
    expect(s.messages).toEqual([])
    expect(s.subagents).toEqual([])
    expect(s.lastUsage).toBeUndefined()
  })

  it('toggles plan mode and detaches a folder', () => {
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions.getState().setPlanMode(id, true)
    useCoworkSessions.getState().setFolder(id, '/tmp/project')
    let s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.planMode).toBe(true)
    expect(s.folder).toBe('/tmp/project')

    useCoworkSessions.getState().setFolder(id, null)
    s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.folder).toBeNull()
  })
})

describe('useCoworkSessions createSession reuse', () => {
  beforeEach(reset)

  it('reuses the current session when it is still empty', () => {
    const first = useCoworkSessions.getState().createSession()
    const second = useCoworkSessions.getState().createSession()
    expect(second).toBe(first)
    expect(useCoworkSessions.getState().sessions).toHaveLength(1)
  })

  it('creates a fresh session once the current one has turns', () => {
    const first = useCoworkSessions.getState().createSession()
    useCoworkSessions
      .getState()
      .commitTurns(first, [{ role: 'user', content: 'hi' }], [], [])
    const second = useCoworkSessions.getState().createSession()
    expect(second).not.toBe(first)
    expect(useCoworkSessions.getState().sessions).toHaveLength(2)
  })
})

describe('useCoworkSessions pruneEmptySessions', () => {
  beforeEach(reset)

  const seed = (id: string, turns: CoworkTurn[] = []) => {
    useCoworkSessions.setState((s) => ({
      sessions: [
        {
          id,
          title: id,
          folder: null,
          turns,
          messages: [],
          updated: Date.now(),
        },
        ...s.sessions,
      ],
    }))
  }

  it('drops sessions with no turns', () => {
    seed('empty')
    seed('full', [{ role: 'user', content: 'hi' }])
    useCoworkSessions.setState({ currentId: 'full' })
    useCoworkSessions.getState().pruneEmptySessions([])
    expect(useCoworkSessions.getState().sessions.map((s) => s.id)).toEqual([
      'full',
    ])
  })

  it('keeps the current session even when empty', () => {
    seed('stale')
    seed('current')
    useCoworkSessions.setState({ currentId: 'current' })
    useCoworkSessions.getState().pruneEmptySessions([])
    expect(useCoworkSessions.getState().sessions.map((s) => s.id)).toEqual([
      'current',
    ])
  })

  it('keeps empty sessions named in keepIds (first run still streaming)', () => {
    seed('stale')
    seed('running')
    useCoworkSessions.setState({ currentId: 'stale' })
    useCoworkSessions.getState().pruneEmptySessions(['running'])
    expect(useCoworkSessions.getState().sessions.map((s) => s.id)).toEqual([
      'running',
      'stale',
    ])
  })

  it('is a no-op when nothing qualifies', () => {
    seed('b', [{ role: 'user', content: 'hi' }])
    seed('a', [{ role: 'user', content: 'hi' }])
    useCoworkSessions.setState({ currentId: 'a' })
    const before = useCoworkSessions.getState().sessions
    useCoworkSessions.getState().pruneEmptySessions([])
    expect(useCoworkSessions.getState().sessions).toBe(before)
  })
})

describe('useCoworkSessions persist migration', () => {
  // v0 sessions carry `turns` but no `messages`. Losing the tool turns on
  // upgrade would leave the agent replaying a conversation with holes in it.
  it('rebuilds messages from turns for a v0 session', () => {
    const migrate = useCoworkSessions.persist.getOptions().migrate!
    const out = migrate(
      {
        sessions: [
          {
            id: 's1',
            turns: [
              { role: 'user', content: 'build it' },
              {
                role: 'tool',
                content: '',
                name: 'write',
                callId: 'c1',
                args: { path: 'a.txt' },
                result: 'Created a.txt (3 bytes)',
                status: 'done',
              },
            ],
          },
        ],
      },
      0
    ) as { sessions: Array<{ messages: unknown[] }> }

    const parts = (out.sessions[0].messages as never[]).flatMap(
      (m: { parts?: unknown[] }) => m.parts ?? []
    )
    expect(out.sessions[0].messages.length).toBeGreaterThan(0)
    expect(parts.some((p: { type?: string }) => p.type === 'tool-write')).toBe(
      true
    )
  })

  it('leaves an already-migrated session alone', () => {
    const migrate = useCoworkSessions.persist.getOptions().migrate!
    const existing = [{ id: 's1', turns: [], messages: [{ id: 'keep' }] }]
    const out = migrate({ sessions: existing }, 1) as {
      sessions: Array<{ messages: Array<{ id: string }> }>
    }
    expect(out.sessions[0].messages[0].id).toBe('keep')
  })
})
