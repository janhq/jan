import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}))

import { useCodeSessions } from '../useCodeSessions'
import type { CodeTurn, SubagentRun } from '@/types/codeSession'

const reset = () => useCodeSessions.setState({ sessions: [], currentId: null })

const sub = (runId: string, name: string): SubagentRun => ({
  runId,
  name,
  status: 'done',
  startedAt: 0,
  turns: [],
})

describe('useCodeSessions', () => {
  beforeEach(reset)

  it('starts a session with an empty message list', () => {
    const id = useCodeSessions.getState().createSession()
    const s = useCodeSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.messages).toEqual([])
    expect(s.folder).toBeNull()
  })

  it('appends turns and replaces the message list on commit', () => {
    const id = useCodeSessions.getState().createSession()
    const turn: CodeTurn = { role: 'user', content: 'hi' }
    const msgs = [{ id: 'm1', role: 'user', parts: [] }] as never
    useCodeSessions.getState().commitTurns(id, [turn], msgs, [])
    useCodeSessions.getState().commitTurns(id, [turn], msgs, [])
    const s = useCodeSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.turns).toHaveLength(2)
    expect(s.messages).toHaveLength(1)
  })

  // A later run that dispatches no subagents must not erase what an earlier
  // run in the same session already finished.
  it('merges subagents by runId across runs instead of replacing', () => {
    const id = useCodeSessions.getState().createSession()
    useCodeSessions.getState().commitTurns(id, [], [], [sub('r1', 'alpha')])
    useCodeSessions.getState().commitTurns(id, [], [], [])
    let s = useCodeSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.subagents?.map((r) => r.runId)).toEqual(['r1'])

    useCodeSessions.getState().commitTurns(id, [], [], [sub('r1', 'renamed')])
    s = useCodeSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.subagents).toHaveLength(1)
    expect(s.subagents?.[0].name).toBe('renamed')
  })

  it('keeps the last usage when a run reports none', () => {
    const id = useCodeSessions.getState().createSession()
    useCodeSessions.getState().commitTurns(id, [], [], [], { total_tokens: 42 })
    useCodeSessions.getState().commitTurns(id, [], [], [])
    const s = useCodeSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.lastUsage?.total_tokens).toBe(42)
  })

  it('clears the transcript, messages and subagents together', () => {
    const id = useCodeSessions.getState().createSession()
    useCodeSessions
      .getState()
      .commitTurns(
        id,
        [{ role: 'user', content: 'hi' }],
        [{ id: 'm1', role: 'user', parts: [] }] as never,
        [sub('r1', 'alpha')],
        { total_tokens: 1 }
      )
    useCodeSessions.getState().clearSession(id)
    const s = useCodeSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.turns).toEqual([])
    expect(s.messages).toEqual([])
    expect(s.subagents).toEqual([])
    expect(s.lastUsage).toBeUndefined()
  })

  it('toggles plan mode and detaches a folder', () => {
    const id = useCodeSessions.getState().createSession()
    useCodeSessions.getState().setPlanMode(id, true)
    useCodeSessions.getState().setFolder(id, '/tmp/project')
    let s = useCodeSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.planMode).toBe(true)
    expect(s.folder).toBe('/tmp/project')

    useCodeSessions.getState().setFolder(id, null)
    s = useCodeSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.folder).toBeNull()
  })
})

describe('useCodeSessions persist migration', () => {
  // v0 sessions carry `turns` but no `messages`. Losing the tool turns on
  // upgrade would leave the agent replaying a conversation with holes in it.
  it('rebuilds messages from turns for a v0 session', () => {
    const migrate = useCodeSessions.persist.getOptions().migrate!
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
    expect(
      parts.some((p: { type?: string }) => p.type === 'tool-write')
    ).toBe(true)
  })

  it('leaves an already-migrated session alone', () => {
    const migrate = useCodeSessions.persist.getOptions().migrate!
    const existing = [{ id: 's1', turns: [], messages: [{ id: 'keep' }] }]
    const out = migrate({ sessions: existing }, 1) as {
      sessions: Array<{ messages: Array<{ id: string }> }>
    }
    expect(out.sessions[0].messages[0].id).toBe('keep')
  })
})
