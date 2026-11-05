import { describe, it, expect, beforeEach, vi } from 'vitest'

import { coworkTurnsToUIMessages } from '@/lib/coworkTurns'
import { startNewSession, useCoworkSessions } from '../useCoworkSessions'
import type { CoworkTurn, SubagentRun, TodoList } from '@/types/coworkSession'

const reset = () =>
  useCoworkSessions.setState({ sessions: [], currentId: null })

const sub = (runId: string, name: string): SubagentRun => ({
  runId,
  name,
  status: 'done',
  startedAt: 0,
  turns: [],
})

describe('startNewSession', () => {
  beforeEach(reset)

  /// The Cowork tab is the start page: it must not land on the session viewed
  /// last, but it also must not pile up empties on repeated clicks.
  it('opens a fresh session when the current one has a conversation', () => {
    const store = useCoworkSessions.getState()
    const used = store.createSession()
    store.commitTurns(used, [{ role: 'user', content: 'hi' }], [], [])
    const fresh = startNewSession([])
    expect(fresh).not.toBe(used)
    expect(useCoworkSessions.getState().currentId).toBe(fresh)
    expect(useCoworkSessions.getState().sessions.map((s) => s.id)).toEqual([
      fresh,
      used,
    ])
  })

  it('does not reuse an unavailable current session', () => {
    const broken = useCoworkSessions.getState().createSession()
    useCoworkSessions.setState((s) => ({
      sessions: s.sessions.map((x) => (x.id === broken ? { ...x, unavailable: 'missing-sidecar' as const } : x)),
    }))
    const fresh = useCoworkSessions.getState().createSession()
    expect(fresh).not.toBe(broken)
    expect(useCoworkSessions.getState().sessions.find((x) => x.id === fresh)?.unavailable).toBeUndefined()
  })

  it('does not reuse a cleared session as a new one, and pruning keeps it', () => {
    const store = useCoworkSessions.getState()
    const used = store.createSession()
    store.commitTurns(used, [{ role: 'user', content: 'hi' }], [], [])
    store.clearSession(used)
    const fresh = useCoworkSessions.getState().createSession()
    expect(fresh).not.toBe(used)
    useCoworkSessions.getState().selectSession(fresh)
    useCoworkSessions.getState().pruneEmptySessions([])
    expect(useCoworkSessions.getState().sessions.map((x) => x.id)).toEqual([fresh, used])
  })

  it('reuses an untouched current session', () => {
    const empty = useCoworkSessions.getState().createSession()
    expect(startNewSession([])).toBe(empty)
    expect(useCoworkSessions.getState().sessions).toHaveLength(1)
  })

  it('opens a different session while the current first response is still streaming', () => {
    const running = useCoworkSessions.getState().createSession()
    const fresh = startNewSession([running])
    expect(fresh).not.toBe(running)
    expect(useCoworkSessions.getState().currentId).toBe(fresh)
    expect(useCoworkSessions.getState().sessions.map((s) => s.id)).toEqual([
      fresh,
      running,
    ])
  })

  it('sweeps abandoned empties but keeps one whose first run is streaming', () => {
    const store = useCoworkSessions.getState()
    const used = store.createSession()
    store.commitTurns(used, [{ role: 'user', content: 'hi' }], [], [])
    useCoworkSessions.setState((s) => ({
      sessions: [
        { ...s.sessions[0], id: 'abandoned', turns: [] },
        { ...s.sessions[0], id: 'streaming', turns: [] },
        ...s.sessions,
      ],
    }))
    const fresh = startNewSession(['streaming'])
    const ids = useCoworkSessions.getState().sessions.map((s) => s.id)
    expect(ids).toContain(fresh)
    expect(ids).toContain('streaming')
    expect(ids).toContain(used)
    expect(ids).not.toContain('abandoned')
  })
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

  /// A subagent ping is a user message with no transcript row, so counting it
  /// as the question would cut the two histories at different points and
  /// resume the run from a note about a subagent.
  it('rewinds past a subagent ping to the real question', () => {
    const id = useCoworkSessions.getState().createSession()
    const turns: CoworkTurn[] = [
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'answer' },
    ]
    const msgs = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'second' }] },
      { id: 'm2', role: 'assistant', parts: [] },
      {
        id: 'ping-2',
        role: 'user',
        parts: [{ type: 'text', text: '<SYSTEM>\nalpha done\n</SYSTEM>' }],
      },
      { id: 'm3', role: 'assistant', parts: [] },
    ] as never
    useCoworkSessions.getState().commitTurns(id, turns, msgs, [])
    useCoworkSessions.getState().rewindToLastUser(id)

    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.turns.map((t) => t.content)).toEqual(['second'])
    expect(s.messages.map((m) => m.id)).toEqual(['m1'])
  })

  /// Editing or deleting a question partway up the transcript cuts both lists
  /// at that question. The wire history has messages the transcript has no row
  /// for, so the cut is counted in questions, not in indices.
  it('drops a question and everything it produced', () => {
    const id = useCoworkSessions.getState().createSession()
    const turns: CoworkTurn[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer one' },
      { role: 'user', content: 'second' },
      { role: 'tool', content: '', name: 'read', status: 'done' },
      { role: 'assistant', content: 'answer two' },
    ]
    const msgs = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
      { id: 'm2', role: 'assistant', parts: [] },
      {
        id: 'ping-2',
        role: 'user',
        parts: [{ type: 'text', text: '<SYSTEM>\nalpha done\n</SYSTEM>' }],
      },
      { id: 'm3', role: 'user', parts: [{ type: 'text', text: 'second' }] },
      { id: 'm4', role: 'assistant', parts: [] },
    ] as never
    useCoworkSessions.getState().commitTurns(id, turns, msgs, [])
    useCoworkSessions.getState().dropFromTurn(id, 2)

    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.turns.map((t) => t.content)).toEqual(['first', 'answer one'])
    // The ping belongs to the first question's run, so it survives with it.
    expect(s.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'ping-2'])
  })

  /// The answers to a question cannot outlive it, so an assistant or tool turn
  /// is not a place the transcript can be cut.
  it('refuses to cut anywhere but a question', () => {
    const id = useCoworkSessions.getState().createSession()
    const turns: CoworkTurn[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
    ]
    const msgs = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
      { id: 'm2', role: 'assistant', parts: [] },
    ] as never
    useCoworkSessions.getState().commitTurns(id, turns, msgs, [])
    useCoworkSessions.getState().dropFromTurn(id, 1)
    useCoworkSessions.getState().dropFromTurn(id, 9)

    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.turns).toHaveLength(2)
    expect(s.messages).toHaveLength(2)
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

describe('useCoworkSessions setFolder (unacknowledged)', () => {
  beforeEach(reset)

  it('drops any previous or legacy-default access when the folder changes', () => {
    const st = useCoworkSessions.getState()
    const id = st.createSession()
    st.setFolderGrant(id, { path: '/a', access: 'write' })
    st.setFolder(id, '/b')
    const s = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(s.folder).toBe('/b')
    expect(s.folderAccess).toBeNull()
  })

  it('a fresh local attach does not fall back to the undefined (write) default', () => {
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions.getState().setFolder(id, '/b')
    expect(useCoworkSessions.getState().sessions.find((x) => x.id === id)!.folderAccess).toBeNull()
  })

  it('re-setting the same folder keeps the host-acknowledged access', () => {
    const st = useCoworkSessions.getState()
    const id = st.createSession()
    st.setFolderGrant(id, { path: '/a', access: 'read' })
    st.setFolder(id, '/a')
    expect(useCoworkSessions.getState().sessions.find((x) => x.id === id)!.folderAccess).toBe('read')
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


describe('useCoworkSessions todo history cuts', () => {
  beforeEach(reset)
  const empty: TodoList = { phases: [] }
  const earlier: TodoList = { phases: [{ name: 'Earlier', tasks: [{ content: 'Keep', status: 'pending' }] }] }
  const stale: TodoList = { phases: [{ name: 'Later', tasks: [{ content: 'Discard', status: 'completed' }] }] }
  const todo = (list: TodoList): CoworkTurn => ({ role: 'tool', name: 'todo', callId: 'todo', content: '', status: 'done', result: JSON.stringify(list) })
  const seed = (prefix: CoworkTurn[]) => {
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions.getState().commitTurns(id, [...prefix, { role: 'user', content: 'Last question' }, todo(stale), { role: 'assistant', content: 'Last answer' }], [], [])
    useCoworkSessions.setState((state) => ({ sessions: state.sessions.map((session) => ({ ...session, messages: coworkTurnsToUIMessages(session.turns) })) }))
    useCoworkSessions.getState().setTodos(id, stale)
    return id
  }
  it.each(['rewind', 'drop'] as const)('%s canonicalizes the surviving snapshot, including an explicit empty one', (action) => {
    for (const list of [earlier, empty]) {
      reset()
      const prefix: CoworkTurn[] = [{ role: 'user', content: 'First' }, todo(list)]
      const id = seed(prefix)
      const store = useCoworkSessions.getState()
      if (action === 'rewind') store.rewindToLastUser(id)
      else store.dropFromTurn(id, prefix.length)
      const session = useCoworkSessions.getState().sessions[0]
      expect(session.todos).toEqual(list)
      expect(session.turns).toEqual(action === 'rewind' ? [...prefix, { role: 'user', content: 'Last question' }] : prefix)
    }
  })
  it.each(['rewind', 'drop', 'clear'] as const)('%s resets a legacy-only sidecar to explicit empty', (action) => {
    const id = useCoworkSessions.getState().createSession()
    const store = useCoworkSessions.getState()
    store.commitTurns(id, [{ role: 'user', content: 'Legacy question' }, { role: 'assistant', content: 'Legacy answer' }], [], [])
    useCoworkSessions.setState((state) => ({ sessions: state.sessions.map((session) => ({ ...session, messages: coworkTurnsToUIMessages(session.turns) })) }))
    store.setTodos(id, stale)
    if (action === 'rewind') store.rewindToLastUser(id)
    else if (action === 'drop') store.dropFromTurn(id, 0)
    else store.clearSession(id)
    expect(useCoworkSessions.getState().sessions[0].todos).toEqual(empty)
  })
  it('clear removes transcript-owned and legacy todo state together', () => {
    const id = seed([{ role: 'user', content: 'First' }, todo(earlier)])
    useCoworkSessions.getState().clearSession(id)
    expect(useCoworkSessions.getState().sessions[0]).toMatchObject({ turns: [], messages: [], todos: empty })
  })
})
