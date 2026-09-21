import type { CoworkTurn } from '@/types/coworkSession'

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

  if (toolName === 'skill_read') {
    const name = stringArg(input, 'name')
    return name ? `Reading ${name}` : 'Reading skill'
  }

  const verb = VERB_BY_TOOL[toolName]
  if (!verb) return humanizeToolName(toolName)

  if (toolName === 'bash') {
    const command = stringArg(input, 'command')
    return command ? `${verb} ${truncate(command, MAX_COMMAND_LEN)}` : verb
  }

  const path = stringArg(input, 'path')
  return path ? `${verb} ${basename(path)}` : verb
}

export function completedToolLabel(
  toolName: string,
  input: unknown,
  state: string
): string {
  if (toolName === 'skill_read' && state === 'output-available') {
    const name = stringArg(input, 'name')
    return name ? `Used ${name}` : 'Used skill'
  }
  return toolActivityText(toolName, input)
}

type ToolPartLike = {
  type: string
  state?: string
  input?: unknown
}

export function usedSkillNames(parts: ToolPartLike[]): string[] {
  const names = new Set<string>()
  for (const part of parts) {
    if (part.type !== 'tool-skill_read' || part.state !== 'output-available') {
      continue
    }
    const name = stringArg(part.input, 'name')
    if (name) names.add(name)
  }
  return [...names]
}

/**
 * Whether a running agent is waiting on the model with nothing to show for it.
 *
 * True in the two gaps an agent loop leaves: before the first token, and again
 * after each tool result. Streaming text and a running tool already report
 * themselves, so a generic "Working…" beside them is noise.
 */
export function awaitsModel(running: boolean, turns: CoworkTurn[]): boolean {
  if (!running) return false
  const last = turns.at(-1)
  if (!last) return true
  // A question or a note the run just folded in: both are followed by a model
  // call, with nothing on screen until it answers.
  if (last.role === 'user' || last.role === 'system') return true
  return last.role === 'tool' && last.status === 'done'
}
