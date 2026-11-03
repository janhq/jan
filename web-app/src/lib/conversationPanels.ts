import { isToolUIPart, getToolName, type UIMessage } from 'ai'
import { TOOL_DIFF_MAX_CHARS } from './toolDiff'
import type { SubagentRun, TodoList } from '@/types/coworkSession'
import { conversationTodos } from './conversationTaskPresentation'
import { artifactFor, artifactsFromParts, type CoworkArtifact } from './coworkArtifacts'
import type { CoworkFileDiff } from './coworkDiffs'
import { resolveInRoot, resolveInRoots } from './coworkPreview'
import type { ToolCallTiming } from '@/hooks/useToolCallRuntime'
import { TASK_TOOL_NAME } from './coworkTools'

/**
 * Pure projection of a Chat thread's canonical UIMessages into the content the
 * contextual panels show. Nothing here is stored or authoritative: reloading
 * the same messages yields the same projection, and a panel exists only when
 * its projection is non-empty.
 */

export type ConversationPanelKind = 'todos' | 'tasks' | 'files' | 'diff'

export type ConversationPanelContent = {
  todos: TodoList | undefined
  tasks: SubagentRun[]
  artifacts: CoworkArtifact[]
  diffs: CoworkFileDiff[]
}

/** Only these are reachable from a rail control, in display order. */
export const CONVERSATION_PANEL_ORDER: readonly ConversationPanelKind[] = [
  'todos',
  'tasks',
  'files',
  'diff',
]

/** The only places a panel may show or read. `scratch` is the thread's own
 * sandbox, which relative tool paths are written into; `folder` is the
 * consented project folder, reachable by absolute path only. */
export type PanelRoots = {
  scratch: string | null | undefined
  folder: string | null | undefined
}

/**
 * The absolute path a tool-reported path denotes, or null when it falls outside
 * the permitted roots. Relative paths resolve against the thread scratch root
 * (where the tools wrote them), never against the folder; absolute paths must
 * sit inside either root. `..` is collapsed first, so traversal is refused.
 * With no matching root nothing is permitted: fail closed.
 */
export function resolvePanelPath(roots: PanelRoots, path: string): string | null {
  const raw = path.replace(/\\/g, '/')
  const isAbsolute = raw.startsWith('/') || /^[a-z]:\//i.test(raw)
  if (isAbsolute) return resolveInRoots([roots.scratch, roots.folder], path)?.abs ?? null
  return roots.scratch ? resolveInRoot(roots.scratch, path) : null
}

export function isPermittedPath(roots: PanelRoots, path: string): boolean {
  return resolvePanelPath(roots, path) !== null
}

/** Display-only diffs recorded for calls this thread's loop owns. The runtime
 * store is global and call IDs are provider-scoped, so another thread's diff
 * under the same ID must never be projected here. */
export function threadRuntimeDiffs(
  diffs: Readonly<Record<string, string>>,
  timings: Readonly<Record<string, ToolCallTiming>>,
  threadId: string
): Record<string, string> {
  const own: Record<string, string> = {}
  for (const [id, diff] of Object.entries(diffs)) {
    if (timings[id]?.owner === threadId) own[id] = diff
  }
  return own
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output
  if (
    output &&
    typeof output === 'object' &&
    typeof (output as { content?: unknown }).content === 'string'
  )
    return (output as { content: string }).content
  return ''
}

function inputPath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = (input as Record<string, unknown>).path
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** The diff block of a settled write/edit result: from the first hunk header on. */
function diffFromOutput(output: unknown): string | undefined {
  const lines = outputText(output).split('\n')
  const start = lines.findIndex((line) => line.startsWith('@@'))
  return start < 0 ? undefined : lines.slice(start).join('\n')
}

/** Settled write/edit diffs grouped by file. Read-only: derived from the tool
 * result (or the transient runtime diff for the same call), never replayed. */
export function conversationDiffs(
  messages: readonly UIMessage[],
  runtimeDiffs: Readonly<Record<string, string>> = {}
): CoworkFileDiff[] {
  const files = new Map<string, CoworkFileDiff>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const persistedDiffs = new Map<string, string>()
    for (const part of message.parts) {
      const data = (part as { data?: { toolCallId?: unknown; diff?: unknown } }).data
      if (part.type === 'data-tool-diff' && typeof data?.toolCallId === 'string' && typeof data.diff === 'string' && data.diff.length <= TOOL_DIFF_MAX_CHARS) persistedDiffs.set(data.toolCallId, data.diff)
    }
    for (const part of message.parts) {
      if (!isToolUIPart(part) || part.state !== 'output-available') continue
      const name = getToolName(part)
      if (name !== 'write' && name !== 'edit') continue
      const path = inputPath(part.input)
      if (!path) continue
      const diff = runtimeDiffs[part.toolCallId] ?? persistedDiffs.get(part.toolCallId) ?? diffFromOutput(part.output)
      if (!diff) continue
      const lines = diff.split('\n')
      const additions = lines.filter((line) => line.startsWith('+ ')).length
      const deletions = lines.filter((line) => line.startsWith('- ')).length
      const operation = { diff, source: 'main' as const }
      const current = files.get(path)
      if (current) {
        current.additions += additions
        current.deletions += deletions
        current.operations.push(operation)
      } else {
        files.set(path, { path, additions, deletions, operations: [operation] })
      }
    }
  }
  return [...files.values()]
}

const TASK_STATUS_PART = 'data-task-status'

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * One canonical task row -> a panel run, or null when it is not parsable.
 * `allowed` is the set of statuses the carrier may report. `error` has no
 * panel status of its own: it settles as a finished run whose output states
 * the failure, so it is never shown as a success without that text.
 */
function parseTaskRow(
  row: unknown,
  allowed: readonly string[]
): SubagentRun | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (
    typeof r.runId !== 'string' ||
    !r.runId ||
    typeof r.name !== 'string' ||
    !r.name ||
    typeof r.status !== 'string' ||
    !allowed.includes(r.status) ||
    !finiteNumber(r.startedAt) ||
    (r.endedAt !== undefined && !finiteNumber(r.endedAt)) ||
    (r.finalOutput !== undefined && typeof r.finalOutput !== 'string') ||
    (r.error !== undefined && typeof r.error !== 'string')
  )
    return null
  const base = { runId: r.runId, name: r.name, startedAt: r.startedAt, turns: [] }
  if (r.status === 'running') return { ...base, status: 'running' }
  if (!finiteNumber(r.endedAt)) return null
  if (r.status === 'done')
    return {
      ...base,
      status: 'done',
      endedAt: r.endedAt,
      ...(r.finalOutput !== undefined ? { finalOutput: r.finalOutput } : {}),
    }
  // error
  return {
    ...base,
    status: 'done',
    endedAt: r.endedAt,
    finalOutput: `Error: ${r.error?.trim() || r.finalOutput || 'task failed'}`,
  }
}

/**
 * Task rows from persisted canonical carriers, in message order:
 * - `data-task-status` UI parts, `data: { subagents: [{ runId, name, status:
 *   'running'|'done'|'error', startedAt, endedAt?, finalOutput?, error? }] }`
 *   (running rows need no endedAt; done/error rows require it);
 * - settled `task` tool results, JSON of the same shape but `done` rows only.
 * Anything else (the prose dispatch receipt, errors, partial rows) is ignored,
 * so no panel appears until a parsable row exists. A later row for the same
 * runId replaces the earlier one, except that a settled run is never reopened
 * by a stale `running` row.
 */
export function conversationTasks(
  messages: readonly UIMessage[]
): SubagentRun[] {
  const runs = new Map<string, SubagentRun>()
  const add = (run: SubagentRun | null) => {
    if (!run) return
    if (run.status === 'running' && runs.get(run.runId)?.status === 'done') return
    runs.set(run.runId, run)
  }
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if ((part as { type: string }).type === TASK_STATUS_PART) {
        const rows = (part as { data?: { subagents?: unknown } }).data?.subagents
        if (Array.isArray(rows))
          for (const row of rows) add(parseTaskRow(row, ['running', 'done', 'error']))
        continue
      }
      if (
        !isToolUIPart(part) ||
        getToolName(part) !== TASK_TOOL_NAME ||
        part.state !== 'output-available'
      )
        continue
      let value: unknown
      try {
        value =
          typeof part.output === 'string' ? JSON.parse(part.output) : part.output
      } catch {
        continue
      }
      const rows = (value as { subagents?: unknown } | null)?.subagents
      if (!Array.isArray(rows)) continue
      for (const row of rows) add(parseTaskRow(row, ['done']))
    }
  }
  return [...runs.values()]
}

export function projectConversationPanels(
  messages: readonly UIMessage[],
  roots: PanelRoots,
  runtimeDiffs: Readonly<Record<string, string>> = {}
): ConversationPanelContent {
  const parts = messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.parts)
  // Normalise to absolute, permitted paths first so a relative and an absolute
  // spelling of one file are one row and nothing outside the roots survives.
  const artifacts = new Map<string, CoworkArtifact>()
  for (const artifact of artifactsFromParts(
    parts as Parameters<typeof artifactsFromParts>[0]
  )) {
    const abs = resolvePanelPath(roots, artifact.path)
    const resolved = abs ? artifactFor(abs) : null
    if (resolved && !artifacts.has(resolved.path)) artifacts.set(resolved.path, resolved)
  }
  const diffs = new Map<string, CoworkFileDiff>()
  for (const file of conversationDiffs(messages, runtimeDiffs)) {
    const abs = resolvePanelPath(roots, file.path)
    if (!abs) continue
    const current = diffs.get(abs)
    if (current) {
      current.additions += file.additions
      current.deletions += file.deletions
      current.operations.push(...file.operations)
    } else diffs.set(abs, { ...file, path: abs, operations: [...file.operations] })
  }
  return {
    todos: conversationTodos(messages),
    tasks: conversationTasks(messages),
    artifacts: [...artifacts.values()],
    diffs: [...diffs.values()],
  }
}

/** Which panels have relevant settled content. Empty todo lists don't count. */
export function availableConversationPanels(
  content: ConversationPanelContent
): Record<ConversationPanelKind, boolean> {
  return {
    todos: (content.todos?.phases ?? []).some((phase) => phase.tasks.length > 0),
    tasks: content.tasks.length > 0,
    files: content.artifacts.length > 0,
    diff: content.diffs.length > 0,
  }
}
