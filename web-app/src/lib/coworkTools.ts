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

function taskTool(subagentNames: string[]): Tool {
  const known = subagentNames.length
    ? ` Saved subagents: ${subagentNames.join(', ')}.`
    : ''
  return {
    description:
      'Start a subagent: a nested, isolated agent with its own system prompt and narrowed tools. It does not see this conversation, so state everything it needs in `description`. Runs in the BACKGROUND and returns immediately with the file its answer will be written to; call it several times in one step to fan work out, keep working, and a note tells you the moment each one finishes.' +
      known,
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        subagent_name: { type: 'string' },
        description: { type: 'string' },
        system_prompt: {
          type: 'string',
          description: 'For a one-off subagent with no saved definition.',
        },
        allowed_tools: { type: 'array', items: { type: 'string' } },
      },
      required: ['subagent_name', 'description'],
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
  return tools
}
