/**
 * The tool set advertised to a Cowork run.
 *
 * Schemas for the built-ins come from Rust (`toolSchemas()`), so there is one
 * source of truth for what they accept. The three client-only tools below are
 * transcribed from their Rust counterparts (`todo.rs`, `interaction.rs`,
 * `subagent.rs`) so the CLI and the desktop advertise the same contract.
 */
import { jsonSchema, type Tool } from 'ai'
import { getAgentToolSchemas } from '@/lib/agentTools'
import { MONITOR_TOOL_NAME, monitorTool } from '@/lib/coworkMonitor'
import {
  WEB_FETCH_DESCRIPTION,
  WEB_FETCH_INPUT_SCHEMA,
  WEB_SEARCH_DESCRIPTION,
  WEB_SEARCH_INPUT_SCHEMA,
} from '@/lib/webSearchTool'

/** Tools that can mutate something. Withheld, and refused, in plan mode. */
export const PLAN_DENIED_TOOLS = new Set([
  'write',
  'edit',
  'bash',
  'memory_write',
  'skill_write',
  'task',
  // Starting one schedules shell scripts, which is exec-class work.
  MONITOR_TOOL_NAME,
])

/** Named `todo` to match the Rust tool: the plan-mode addendum instructs the
 * model to call `todo` by name, so renaming it here breaks that prompt. */
export const TODO_TOOL_NAME = 'todo'
export const ASK_TOOL_NAME = 'ask'
export const TASK_TOOL_NAME = 'task'

/** Tools Cowork dispatches itself rather than handing to the Rust plugin. */
export const CLIENT_TOOL_NAMES = new Set([
  TODO_TOOL_NAME,
  ASK_TOOL_NAME,
  TASK_TOOL_NAME,
  MONITOR_TOOL_NAME,
])

const todoTool: Tool = {
  description:
    'Manage the canonical session todo list: init/start/done/drop/rm/append/view. One call applies one operation. Tasks advance automatically in phase and task order after done or drop; start only confirms the current task. init takes `list` or `items`, never `phase`/`task` directly.',
  inputSchema: jsonSchema({
    type: 'object',
    properties: {
      op: {
        type: 'string',
        enum: ['init', 'start', 'done', 'drop', 'rm', 'append', 'view'],
      },
      list: {
        type: 'array',
        description: 'For init: [{phase, items}]',
        items: {
          type: 'object',
          properties: {
            phase: { type: 'string' },
            items: { type: 'array', items: { type: 'string' } },
          },
          required: ['phase', 'items'],
        },
      },
      items: {
        type: 'array',
        description: 'For init (flat, single unnamed phase) or append.',
        items: { type: 'string' },
      },
      task: { type: 'string' },
      phase: { type: 'string' },
      all: { type: 'boolean' },
    },
    required: ['op'],
  }),
} as Tool

const askTool: Tool = {
  description:
    'Ask the user one or more structured questions. Use only when the answer materially changes the work.',
  inputSchema: jsonSchema({
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            question: { type: 'string' },
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 5,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['label'],
                additionalProperties: false,
              },
            },
            multi: { type: 'boolean' },
            recommended: { type: 'integer', minimum: 0 },
          },
          required: ['id', 'question', 'options'],
          additionalProperties: false,
        },
      },
    },
    required: ['questions'],
    additionalProperties: false,
  }),
} as Tool

/**
 * The dispatch schema, ported from `subagent_tool_schemas` in Rust: a flat
 * `{ subagents: [ {name, task, phase?, allowed_tools?} ] }`. An optional per-
 * subagent `phase` groups them into ordered stages (omit it for a plain fan-
 * out). A name matching a saved subagent uses that role and tools; any other
 * name runs as a focused general-purpose agent, so there is no `system_prompt`
 * and no unknown-name failure. Wording tracks the Rust description.
 */
function taskTool(subagentNames: string[]): Tool {
  const phasesDesc =
    ' List all the subagents in one call. To PIPELINE them, give a subagent a `phase`: subagents sharing a phase run together, lower phases run first, and each later phase is handed the previous phase\'s results automatically. Omit `phase` for a plain fan-out (one stage, everyone at once); use it to stage work (e.g. phase 0 researches in parallel, phase 1 synthesizes).'
  const bg =
    " Subagents run in the BACKGROUND, concurrently (more than the running cap are queued). You keep working and get a note the moment each finishes. Each subagent's final answer is written to blackboard/<name>.md in a shared scratch directory the whole plan can read from and write to."
  const saved = subagentNames.length
    ? ` A subagent whose name matches a saved one uses that role and tools; otherwise it runs as a focused general-purpose agent. Saved subagents: ${subagentNames.join(', ')}.`
    : ' No saved subagents yet; each runs as a focused general-purpose agent defined by its task.'
  return {
    description:
      'Dispatch one or more subagents -- nested, isolated agents -- to do work for you.' +
      phasesDesc +
      bg +
      saved,
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        subagents: {
          type: 'array',
          description:
            'The subagents to run. With no phases they all run concurrently; otherwise they run grouped and ordered by their `phase`.',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description:
                  "Short identity for this subagent, unique across the whole call: letters, digits, '-' and '_' only. It is also the blackboard file its answer is written to (blackboard/<name>.md). If it matches a saved subagent, that role and tools are used; otherwise it runs as a focused general-purpose agent.",
              },
              task: {
                type: 'string',
                description:
                  "The subagent's sole instruction. Include everything it needs; it does not see this conversation. A subagent in a later phase also receives the previous phase's results automatically, so tell it what to DO with them.",
              },
              phase: {
                type: 'integer',
                minimum: 0,
                description:
                  'Optional stage (default 0). Subagents with the same phase run concurrently; a phase starts only after every lower phase has finished. Omit it entirely for a plain fan-out.',
              },
              allowed_tools: {
                type: 'array',
                items: { type: 'string' },
                description:
                  "Optional tool allowlist. OMIT to give the subagent the parent's full toolset (the usual choice -- one that runs tests needs bash, one that edits needs write). Provide a list ONLY to restrict it; for a saved subagent it further narrows that subagent's own tools (never widens). An empty list is treated as omitted.",
              },
            },
            required: ['name', 'task'],
          },
        },
      },
      required: ['subagents'],
      additionalProperties: false,
    }),
  } as Tool
}

export type CoworkToolOptions = {
  planMode: boolean
  subagentNames: string[]
  /** Depth 1+ cannot spawn further subagents; mirrors the Rust loop's cap. */
  allowSubagents: boolean
  /**
   * Follows the global web-search setting, the same one chat reads. Cowork has
   * no toggle of its own: the surface configures nothing about its tool set, so
   * this is a Settings-level capability rather than a per-session choice.
   */
  webSearch: boolean
}

/**
 * The signature that must stay stable for the KV prefix to survive a run.
 *
 * Any change to advertised tool JSON changes the prompt prefix, and an agent
 * turn re-prefills 20+ times — so the record is frozen for a run's lifetime and
 * a mode change only takes effect on the next message.
 */
export function coworkToolSignature(
  opts: CoworkToolOptions,
  sandboxEnforces: boolean
): string {
  return [
    opts.planMode ? 'plan' : 'normal',
    sandboxEnforces ? 'jail' : 'nojail',
    opts.allowSubagents ? opts.subagentNames.join(',') : 'nosub',
    opts.webSearch ? 'web' : 'noweb',
  ].join('|')
}

/** Filter a name list down to what this mode may call. */
export function allowedToolNames(
  names: string[],
  opts: CoworkToolOptions
): string[] {
  return names.filter((name) => {
    if (opts.planMode && PLAN_DENIED_TOOLS.has(name)) return false
    if (name === TASK_TOOL_NAME && !opts.allowSubagents) return false
    return true
  })
}

export async function buildCoworkTools(
  opts: CoworkToolOptions
): Promise<Record<string, Tool>> {
  const schemas = await getAgentToolSchemas()
  const tools: Record<string, Tool> = {}

  for (const s of schemas) {
    const name = s.function.name
    if (opts.planMode && PLAN_DENIED_TOOLS.has(name)) continue
    tools[name] = {
      description: s.function.description,
      inputSchema: jsonSchema(
        s.function.parameters as Record<string, unknown>
      ),
    } as Tool
  }

  // Reads, so plan mode keeps them: research is most of what planning is.
  if (opts.webSearch) {
    tools['web_search'] = {
      description: WEB_SEARCH_DESCRIPTION,
      inputSchema: jsonSchema(WEB_SEARCH_INPUT_SCHEMA as Record<string, unknown>),
    } as Tool
    tools['web_fetch'] = {
      description: WEB_FETCH_DESCRIPTION,
      inputSchema: jsonSchema(WEB_FETCH_INPUT_SCHEMA as Record<string, unknown>),
    } as Tool
  }

  tools[TODO_TOOL_NAME] = todoTool
  tools[ASK_TOOL_NAME] = askTool
  if (opts.allowSubagents && !opts.planMode) {
    tools[TASK_TOOL_NAME] = taskTool(opts.subagentNames)
  }
  if (!opts.planMode) {
    tools[MONITOR_TOOL_NAME] = monitorTool()
  }
  return tools
}
