import type { TodoItem, TodoList, TodoPhase } from '@/types/coworkSession'

/**
 * The `todo` tool's reducer, ported from `core/agent/todo.rs`.
 *
 * Kept behaviourally identical to the Rust version because both drive the same
 * tool schema and the same panel: task content is the stable id, tasks advance
 * in phase then task order, and exactly one task is in progress at a time.
 */

export type TodoOp =
  | 'init'
  | 'start'
  | 'done'
  | 'drop'
  | 'rm'
  | 'append'
  | 'view'

export type TodoArgs = {
  op?: string
  list?: Array<{ phase?: string; items?: string[] }>
  items?: string[]
  task?: string
  phase?: string
  all?: boolean
}

type Target =
  | { kind: 'task'; value: string }
  | { kind: 'phase'; value: string }
  | { kind: 'all' }

export type TodoResult = { list: TodoList; error?: string }

const EMPTY: TodoList = { phases: [] }

const clone = (list: TodoList): TodoList => ({
  phases: list.phases.map((p) => ({
    name: p.name,
    tasks: p.tasks.map((t) => ({ ...t })),
  })),
})

const allTasks = (list: TodoList) => list.phases.flatMap((p) => p.tasks)

const activeTask = (list: TodoList): TodoItem | undefined =>
  allTasks(list).find((t) => t.status === 'in_progress')

const isTerminal = (t: TodoItem) =>
  t.status === 'completed' || t.status === 'abandoned'

/**
 * After a mutation leaves nothing in progress, promote the earliest pending
 * task in phase then task order. This is what makes `done` advance the list
 * without the model having to call `start`.
 */
function promoteNext(list: TodoList): void {
  if (activeTask(list)) return
  for (const phase of list.phases) {
    const next = phase.tasks.find((t) => t.status === 'pending')
    if (next) {
      next.status = 'in_progress'
      return
    }
  }
}

function parseTarget(args: TodoArgs): Target | string {
  if (typeof args.task === 'string') return { kind: 'task', value: args.task }
  if (typeof args.phase === 'string') return { kind: 'phase', value: args.phase }
  if (args.all === true) return { kind: 'all' }
  return 'target requires exactly one of: task, phase, all'
}

function phasesFromArgs(args: TodoArgs): TodoPhase[] | string {
  if (Array.isArray(args.list)) {
    return args.list.map((entry) => ({
      name: entry.phase ?? '',
      tasks: (entry.items ?? []).map((content) => ({
        content,
        status: 'pending' as const,
      })),
    }))
  }
  if (Array.isArray(args.items)) {
    // A flat items array becomes one unnamed phase, matching the Rust form.
    return [
      {
        name: '',
        tasks: args.items.map((content) => ({
          content,
          status: 'pending' as const,
        })),
      },
    ]
  }
  return 'init requires `list` or `items`'
}

function validateInit(phases: TodoPhase[]): string | null {
  const names = new Set<string>()
  const contents = new Set<string>()
  for (const phase of phases) {
    if (names.has(phase.name)) return `duplicate phase name '${phase.name}'`
    names.add(phase.name)
    for (const task of phase.tasks) {
      if (!task.content.trim()) return 'task content must not be empty'
      // Content is the stable id, so a duplicate anywhere is ambiguous.
      if (contents.has(task.content)) {
        return `duplicate task '${task.content}'`
      }
      contents.add(task.content)
    }
  }
  return null
}

/**
 * Confirm a task is in progress. Refuses to jump ahead of open work, so the
 * list reflects the order the agent actually declared.
 */
function start(list: TodoList, content: string): string | null {
  const flat: Array<{ task: TodoItem }> = []
  for (const phase of list.phases) {
    for (const task of phase.tasks) flat.push({ task })
  }
  const index = flat.findIndex((e) => e.task.content === content)
  if (index === -1) return `unknown task '${content}'`

  const target = flat[index].task
  if (target.status === 'in_progress') return null
  if (target.status !== 'pending') return `task '${content}' is not pending`

  for (let i = 0; i < index; i += 1) {
    if (!isTerminal(flat[i].task)) {
      return `cannot start '${content}' before completing or abandoning '${flat[i].task.content}'`
    }
  }
  for (const { task } of flat) {
    if (task.status === 'in_progress') task.status = 'pending'
  }
  target.status = 'in_progress'
  return null
}

function setStatus(
  list: TodoList,
  target: Target,
  status: TodoItem['status']
): string | null {
  if (target.kind === 'task') {
    const task = allTasks(list).find((t) => t.content === target.value)
    if (!task) return `unknown task '${target.value}'`
    task.status = status
  } else if (target.kind === 'phase') {
    const phases = list.phases.filter((p) => p.name === target.value)
    if (phases.length === 0) return `unknown phase '${target.value}'`
    for (const phase of phases) {
      for (const task of phase.tasks) {
        // Already-terminal tasks are left alone rather than resurrected.
        if (!isTerminal(task)) task.status = status
      }
    }
  } else {
    for (const task of allTasks(list)) {
      if (!isTerminal(task)) task.status = status
    }
  }
  promoteNext(list)
  return null
}

function remove(list: TodoList, target: Target): string | null {
  if (target.kind === 'task') {
    if (!allTasks(list).some((t) => t.content === target.value)) {
      return `unknown task '${target.value}'`
    }
    for (const phase of list.phases) {
      phase.tasks = phase.tasks.filter((t) => t.content !== target.value)
    }
  } else if (target.kind === 'phase') {
    if (!list.phases.some((p) => p.name === target.value)) {
      return `unknown phase '${target.value}'`
    }
    list.phases = list.phases.filter((p) => p.name !== target.value)
  } else {
    list.phases = []
  }
  // Drop a phase left both empty and unnamed; a named one stays as a heading.
  list.phases = list.phases.filter((p) => p.tasks.length > 0 || p.name !== '')
  promoteNext(list)
  return null
}

function append(
  list: TodoList,
  phaseName: string,
  items: string[]
): string | null {
  const seen = new Set<string>()
  for (const content of items) {
    if (!content.trim()) return 'task content must not be empty'
    if (allTasks(list).some((t) => t.content === content)) {
      return `duplicate task '${content}'`
    }
    if (seen.has(content)) return `duplicate task '${content}' in append`
    seen.add(content)
  }
  let phase = list.phases.find((p) => p.name === phaseName)
  if (!phase) {
    phase = { name: phaseName, tasks: [] }
    list.phases.push(phase)
  }
  phase.tasks.push(
    ...items.map((content) => ({ content, status: 'pending' as const }))
  )
  promoteNext(list)
  return null
}

/**
 * Apply one operation. Never throws: a bad call comes back as an error string
 * the model can read and correct, alongside the unchanged list.
 */
export function applyTodoOp(
  current: TodoList | undefined,
  rawArgs: unknown
): TodoResult {
  const list = clone(current ?? EMPTY)
  const args = (rawArgs ?? {}) as TodoArgs
  const op = args.op as TodoOp | undefined

  if (!op) return { list, error: 'missing `op`' }
  if (op === 'view') return { list }

  if (op === 'init') {
    const phases = phasesFromArgs(args)
    if (typeof phases === 'string') return { list, error: phases }
    const invalid = validateInit(phases)
    if (invalid) return { list, error: invalid }
    const next: TodoList = { phases }
    promoteNext(next)
    return { list: next }
  }

  if (op === 'append') {
    const items = args.items
    if (!Array.isArray(items) || items.length === 0) {
      return { list, error: 'append requires `items`' }
    }
    const error = append(list, args.phase ?? '', items)
    return error ? { list: clone(current ?? EMPTY), error } : { list }
  }

  if (op === 'start') {
    if (typeof args.task !== 'string') {
      return { list, error: 'start requires `task`' }
    }
    const error = start(list, args.task)
    return error ? { list: clone(current ?? EMPTY), error } : { list }
  }

  const target = parseTarget(args)
  if (typeof target === 'string') return { list, error: target }

  if (op === 'done' || op === 'drop') {
    const error = setStatus(
      list,
      target,
      op === 'done' ? 'completed' : 'abandoned'
    )
    return error ? { list: clone(current ?? EMPTY), error } : { list }
  }

  if (op === 'rm') {
    const error = remove(list, target)
    return error ? { list: clone(current ?? EMPTY), error } : { list }
  }

  return { list, error: `unknown op '${op}'` }
}

/**
 * The tool result body: the whole resulting snapshot, matching
 * `todo.rs::render_result`, so a compacted history can still reconstruct the
 * list from the transcript alone.
 */
export function renderTodoResult(list: TodoList): string {
  return JSON.stringify(list)
}

export function todoProgress(list: TodoList): { done: number; total: number } {
  const tasks = allTasks(list)
  return { done: tasks.filter(isTerminal).length, total: tasks.length }
}
