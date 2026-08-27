import { describe, it, expect } from 'vitest'
import { applyTodoOp, renderTodoResult, todoProgress } from '../coworkTodo'
import type { TodoList } from '@/types/codeSession'

// Ported from `core/agent/todo.rs`'s own tests: the two implementations drive
// the same schema and the same panel, so they have to agree.

const init = (list: Array<{ phase: string; items: string[] }>) =>
  applyTodoOp(undefined, { op: 'init', list }).list

const active = (l: TodoList) =>
  l.phases.flatMap((p) => p.tasks).find((t) => t.status === 'in_progress')
    ?.content

const statusOf = (l: TodoList, content: string) =>
  l.phases.flatMap((p) => p.tasks).find((t) => t.content === content)?.status

describe('init', () => {
  it('promotes the first task', () => {
    const l = init([{ phase: 'Setup', items: ['a', 'b'] }])
    expect(active(l)).toBe('a')
    expect(todoProgress(l)).toEqual({ done: 0, total: 2 })
  })

  it('accepts the flat items form as one unnamed phase', () => {
    const l = applyTodoOp(undefined, { op: 'init', items: ['x', 'y'] }).list
    expect(l.phases).toHaveLength(1)
    expect(l.phases[0].name).toBe('')
    expect(active(l)).toBe('x')
  })

  it('rejects duplicate phases, duplicate tasks, and cross-phase duplicates', () => {
    for (const list of [
      [
        { phase: 'A', items: ['x'] },
        { phase: 'A', items: ['y'] },
      ],
      [{ phase: 'A', items: ['x', 'x'] }],
      [
        { phase: 'A', items: ['x'] },
        { phase: 'B', items: ['x'] },
      ],
    ]) {
      const r = applyTodoOp(undefined, { op: 'init', list })
      expect(r.error).toBeTruthy()
      // Atomic: a rejected init leaves prior state untouched.
      expect(r.list.phases).toEqual([])
    }
  })

  it('rejects empty task content', () => {
    expect(
      applyTodoOp(undefined, { op: 'init', items: ['  '] }).error
    ).toMatch(/must not be empty/)
  })
})

describe('start', () => {
  it('accepts only the current task', () => {
    const l = init([{ phase: 'A', items: ['a', 'b'] }])
    expect(applyTodoOp(l, { op: 'start', task: 'a' }).error).toBeUndefined()
    expect(applyTodoOp(l, { op: 'start', task: 'b' }).error).toMatch(
      /cannot start/
    )
    expect(applyTodoOp(l, { op: 'start', task: 'missing' }).error).toMatch(
      /unknown task/
    )
  })

  it('rejects a task after an open earlier phase', () => {
    let l = init([
      { phase: 'Phase 1', items: ['one'] },
      { phase: 'Phase 2', items: ['two'] },
      { phase: 'Phase 5', items: ['five'] },
    ])
    l = applyTodoOp(l, { op: 'done', phase: 'Phase 1' }).list
    expect(applyTodoOp(l, { op: 'start', task: 'five' }).error).toBeTruthy()
    expect(active(l)).toBe('two')
  })
})

describe('done and drop', () => {
  it('promotes the next pending task on completion', () => {
    let l = init([{ phase: 'A', items: ['a', 'b'] }])
    l = applyTodoOp(l, { op: 'done', task: 'a' }).list
    expect(active(l)).toBe('b')
    expect(todoProgress(l)).toEqual({ done: 1, total: 2 })
  })

  it('promotes the next pending task on abandonment too', () => {
    let l = init([{ phase: 'A', items: ['a', 'b'] }])
    l = applyTodoOp(l, { op: 'drop', task: 'a' }).list
    expect(statusOf(l, 'a')).toBe('abandoned')
    expect(active(l)).toBe('b')
  })

  // Completing a phase must not resurrect a task the agent deliberately
  // abandoned — the record of that decision is the point of `drop`.
  it('completing a phase leaves already-terminal tasks alone', () => {
    let l = init([{ phase: 'A', items: ['a', 'b', 'c'] }])
    l = applyTodoOp(l, { op: 'drop', task: 'b' }).list
    l = applyTodoOp(l, { op: 'done', phase: 'A' }).list
    expect(statusOf(l, 'a')).toBe('completed')
    expect(statusOf(l, 'b')).toBe('abandoned')
    expect(statusOf(l, 'c')).toBe('completed')
  })

  it('done all closes everything open', () => {
    let l = init([{ phase: 'A', items: ['a', 'b'] }])
    l = applyTodoOp(l, { op: 'done', all: true }).list
    expect(todoProgress(l)).toEqual({ done: 2, total: 2 })
  })
})

describe('rm', () => {
  it('deletes outright where drop preserves the record', () => {
    let l = init([{ phase: 'A', items: ['a', 'b'] }])
    l = applyTodoOp(l, { op: 'drop', task: 'a' }).list
    expect(statusOf(l, 'a')).toBe('abandoned')
    l = applyTodoOp(l, { op: 'rm', task: 'a' }).list
    expect(statusOf(l, 'a')).toBeUndefined()
  })

  it('reports a missing target without mutating', () => {
    const l = init([{ phase: 'A', items: ['a'] }])
    const before = JSON.stringify(l)
    expect(applyTodoOp(l, { op: 'rm', task: 'missing' }).error).toBeTruthy()
    expect(applyTodoOp(l, { op: 'rm', phase: 'missing' }).error).toBeTruthy()
    expect(JSON.stringify(l)).toBe(before)
  })
})

describe('append', () => {
  it('adds to an existing phase and creates a missing one', () => {
    let l = init([{ phase: 'A', items: ['a'] }])
    l = applyTodoOp(l, { op: 'append', phase: 'A', items: ['a2'] }).list
    l = applyTodoOp(l, { op: 'append', phase: 'B', items: ['b1'] }).list
    expect(l.phases.map((p) => p.name)).toEqual(['A', 'B'])
    expect(l.phases[0].tasks.map((t) => t.content)).toEqual(['a', 'a2'])
  })

  it('rejects duplicates against the list and within the call', () => {
    const l = init([{ phase: 'A', items: ['a'] }])
    expect(
      applyTodoOp(l, { op: 'append', phase: 'A', items: ['a'] }).error
    ).toMatch(/duplicate/)
    expect(
      applyTodoOp(l, { op: 'append', phase: 'A', items: ['z', 'z'] }).error
    ).toMatch(/duplicate/)
  })
})

describe('argument handling', () => {
  it('never throws on malformed input', () => {
    for (const args of [undefined, {}, { op: 'nope' }, { op: 'done' }, 42]) {
      const r = applyTodoOp(undefined, args)
      expect(r.error).toBeTruthy()
      expect(r.list).toBeDefined()
    }
  })

  it('view returns the list unchanged', () => {
    const l = init([{ phase: 'A', items: ['a'] }])
    expect(applyTodoOp(l, { op: 'view' })).toEqual({ list: l })
  })
})

describe('renderTodoResult', () => {
  // The whole snapshot goes back as the tool result so a compacted history can
  // still reconstruct the list from the transcript alone.
  it('serialises the full list', () => {
    const l = init([{ phase: 'A', items: ['a'] }])
    expect(JSON.parse(renderTodoResult(l))).toEqual(l)
  })
})
