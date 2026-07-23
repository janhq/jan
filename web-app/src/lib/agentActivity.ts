import type { CodeTurn, SubagentRun } from '@/hooks/useCodeSessions'

export type ActivityLabel = { text: string; startedAt: number } | null

const MAX_COMMAND_LEN = 60

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? normalized : normalized.slice(idx + 1) || normalized
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function stringArg(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function humanizeToolName(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim()
  if (!spaced) return 'tool'
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const VERB_BY_TOOL: Record<string, string> = {
  write: 'Writing',
  edit: 'Editing',
  bash: 'Running',
  read: 'Reading',
  ls: 'Listing',
  find: 'Finding',
  grep: 'Searching',
}

const NO_DETAIL_TOOLS: Record<string, string> = {
  memory_write: 'Saving memory',
  memory_read: 'Reading memory',
  memory_list: 'Reading memory',
}

/** Text for one tool call, given its name and args. Pure formatting, no timestamp. */
export function toolActivityText(toolName: string, input: unknown): string {
  const fixed = NO_DETAIL_TOOLS[toolName]
  if (fixed) return fixed

  const verb = VERB_BY_TOOL[toolName]
  if (!verb) return humanizeToolName(toolName)

  if (toolName === 'bash') {
    const command = stringArg(input, 'command')
    return command ? `${verb} ${truncate(command, MAX_COMMAND_LEN)}` : verb
  }

  const path = stringArg(input, 'path')
  return path ? `${verb} ${basename(path)}` : verb
}

type ToolPartLike = {
  type: string
  state?: string
  toolCallId?: string
  input?: unknown
}

const PENDING_STATES = new Set(['input-available', 'submitted'])

/** Finds the first pending tool part; returns its id, name, and activity text. */
export function activeToolPart(
  parts: ToolPartLike[]
): { toolCallId: string; toolName: string; text: string } | null {
  for (const part of parts) {
    if (!part.type.startsWith('tool-')) continue
    if (!part.state || !PENDING_STATES.has(part.state)) continue
    if (!part.toolCallId) continue
    const toolName = part.type.slice('tool-'.length)
    return {
      toolCallId: part.toolCallId,
      toolName,
      text: toolActivityText(toolName, part.input),
    }
  }
  return null
}

function lastRunningToolTurn(turns: CodeTurn[]): CodeTurn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.role === 'tool' && turn.status === 'running') return turn
  }
  return undefined
}

/** null if no subagent is running; else a combined label + earliest startedAt. */
export function subagentActivityLabel(subagents: SubagentRun[]): ActivityLabel {
  const running = subagents.filter((s) => s.status === 'running')
  if (running.length === 0) return null

  if (running.length === 1) {
    const run = running[0]
    const activeTurn = lastRunningToolTurn(run.turns)
    const detail = activeTurn
      ? toolActivityText(activeTurn.name ?? 'tool', activeTurn.args)
      : 'working'
    return { text: `${run.name}: ${detail}`, startedAt: run.startedAt }
  }

  const startedAt = Math.min(...running.map((s) => s.startedAt))
  return { text: `${running.length} subagents working`, startedAt }
}
