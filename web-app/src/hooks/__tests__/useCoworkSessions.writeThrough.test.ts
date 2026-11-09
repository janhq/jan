import { describe, it, expect, beforeEach } from 'vitest'
import { useCoworkSessions } from '../useCoworkSessions'
import {
  isCoworkClosing,
  quiesceCoworkRuns,
  registerCoworkRunForClose,
  resumeCoworkAfterPreventedClose,
  __resetCoworkRunCloseForTests,
} from '../useCoworkRun'
import { todosFromTurns } from '@/lib/coworkTodo'
import type { CoworkTurn } from '@/types/coworkSession'

const todoTurn = (list: unknown, over: Partial<CoworkTurn> = {}): CoworkTurn => ({
  role: 'tool',
  name: 'todo',
  content: '',
  result: JSON.stringify(list),
  status: 'done',
  ...over,
})
const list = (content: string) => ({
  phases: [{ name: 'p', tasks: [{ content, status: 'pending' }] }],
})
const user = (content: string): CoworkTurn => ({ role: 'user', content })
const msg = (id: string, role: 'user' | 'assistant', text = id) =>
  ({ id, role, parts: [{ type: 'text', text }] }) as never

const seed = (turns: CoworkTurn[], messages: never[]) => {
  useCoworkSessions.setState({
    sessions: [{ id: 's', title: 'T', folder: null, turns, messages, updated: 0 }],
    currentId: 's',
  })
}
const get = () => useCoworkSessions.getState().sessions[0]

describe('the in-memory store is no longer persisted', () => {
  it('has no persist middleware (write-through lives in coworkSync)', () => {
    expect('persist' in useCoworkSessions).toBe(false)
  })
})

describe('todosFromTurns', () => {
  it('returns the latest valid finished snapshot and ignores running, failed and malformed results', () => {
    expect(todosFromTurns([])).toBeUndefined()
    expect(
      todosFromTurns([
        todoTurn(list('first')),
        todoTurn(list('second')),
        todoTurn(list('running'), { status: 'running' }),
        todoTurn(list('failed'), { isError: true }),
        todoTurn('not a list'),
        { ...todoTurn(list('other tool')), name: 'write' },
      ])
    ).toEqual(list('second'))
  })
})

describe('rewind, drop and clear keep the todo list in step with the transcript', () => {
  beforeEach(() => seed([], []))

  it('rewindToLastUser restores the todos the kept turns produced', () => {
    seed(
      [user('q1'), todoTurn(list('kept')), user('q2'), todoTurn(list('dropped'))],
      [msg('1', 'user'), msg('2', 'user')]
    )
    useCoworkSessions.setState((s) => ({
      sessions: s.sessions.map((x) => ({ ...x, todos: list('dropped') as never })),
    }))
    useCoworkSessions.getState().rewindToLastUser('s')
    expect(get().todos).toEqual(list('kept'))
  })

  it('dropFromTurn to the very first question empties the session and marks it cleared (stays listed)', () => {
    seed([user('q1'), todoTurn(list('x'))], [msg('1', 'user')])
    useCoworkSessions.getState().dropFromTurn('s', 0)
    expect(get().turns).toEqual([])
    expect(get().todos).toEqual({ phases: [] })
    expect(get().cleared).toBe(true)
    // A cleared session is a used one: it survives the empty-session sweep.
    useCoworkSessions.setState({ currentId: null })
    useCoworkSessions.getState().pruneEmptySessions([])
    expect(useCoworkSessions.getState().sessions).toHaveLength(1)
  })

  it('clearSession keeps the empty session and createSession does not reuse it', () => {
    seed([user('q1')], [msg('1', 'user')])
    useCoworkSessions.getState().clearSession('s')
    expect(get().cleared).toBe(true)
    expect(get().todos).toEqual({ phases: [] })
    const fresh = useCoworkSessions.getState().createSession()
    expect(fresh).not.toBe('s')
  })

  it('an unavailable session is never reused as the blank placeholder', () => {
    useCoworkSessions.setState({
      sessions: [
        {
          id: 'u',
          title: 'T',
          folder: null,
          turns: [],
          messages: [],
          updated: 0,
          unavailable: 'missing-thread',
        },
      ],
      currentId: 'u',
    })
    expect(useCoworkSessions.getState().createSession()).not.toBe('u')
  })

  it('goal, todo and title edits bump `updated` so write-through sees them as changes', () => {
    seed([user('q')], [msg('1', 'user')])
    useCoworkSessions.getState().setTitle('s', 'x')
    expect(get().updated).toBeGreaterThan(0)
    useCoworkSessions.setState((s) => ({
      sessions: s.sessions.map((x) => ({ ...x, updated: 0 })),
    }))
    useCoworkSessions.getState().setTodos('s', list('a') as never)
    expect(get().updated).toBeGreaterThan(0)
    useCoworkSessions.setState((s) => ({
      sessions: s.sessions.map((x) => ({ ...x, updated: 0 })),
    }))
    useCoworkSessions.getState().setGoal('s', null)
    expect(get().updated).toBeGreaterThan(0)
  })

  it('setProject records the project on the session', () => {
    seed([user('q')], [msg('1', 'user')])
    useCoworkSessions.getState().setProject('s', { id: 'p', name: 'P', updated_at: 1 })
    expect(get().project?.id).toBe('p')
  })
})

describe('close registry', () => {
  beforeEach(() => __resetCoworkRunCloseForTests())

  it('stops every registered run, waits for all of them even when one fails, and rejects with the failure', async () => {
    const order: string[] = []
    let finish!: () => void
    const slow = new Promise<void>((r) => (finish = r))
    registerCoworkRunForClose(async () => {
      order.push('bad')
      throw new Error('commit failed')
    })
    registerCoworkRunForClose(async () => {
      order.push('slow-start')
      await slow
      order.push('slow-done')
    })
    const closing = quiesceCoworkRuns()
    expect(isCoworkClosing()).toBe(true)
    let settled = false
    closing.catch(() => {}).finally(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false) // waits for the slow run
    finish()
    await expect(closing).rejects.toThrow('commit failed')
    expect(order).toEqual(['bad', 'slow-start', 'slow-done'])
  })

  it('a prevented close reopens the app and the next close retries the runs', async () => {
    let calls = 0
    registerCoworkRunForClose(async () => {
      calls += 1
      if (calls === 1) throw new Error('first fails')
    })
    await expect(quiesceCoworkRuns()).rejects.toThrow()
    resumeCoworkAfterPreventedClose()
    expect(isCoworkClosing()).toBe(false)
    await expect(quiesceCoworkRuns()).resolves.toBeUndefined()
    expect(calls).toBe(2)
  })

  it('an unregistered run is no longer awaited', async () => {
    let ran = false
    const off = registerCoworkRunForClose(async () => {
      ran = true
    })
    off()
    await quiesceCoworkRuns()
    expect(ran).toBe(false)
  })
})
