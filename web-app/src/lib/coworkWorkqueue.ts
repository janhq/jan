/**
 * The shared work queue + observability tools on the Cowork surface.
 *
 * The queue and per-agent status live in Rust (`tools/workqueue.rs`,
 * `tools/observ.rs`), reached through the plugin's guest-js commands. What lives
 * here is the client half: the transcribed schemas (like `task`/`monitor`, so
 * both surfaces advertise the same contract), and a dispatcher that routes a
 * call to the matching command and applies the post-mutation snapshot to the
 * session store so the rail stays live.
 */
import { jsonSchema, type Tool } from 'ai'
import {
  claimWork,
  completeWork,
  listWork,
  postWork,
  readAgent,
  type WorkCommandResult,
  type WorkItemView,
} from '@/lib/agentTools'
import type { ToolOutcome } from '@/lib/coworkRunner'

export const POST_WORK_TOOL = 'post_work'
export const CLAIM_WORK_TOOL = 'claim_work'
export const COMPLETE_WORK_TOOL = 'complete_work'
export const LIST_WORK_TOOL = 'list_work'
export const READ_AGENT_TOOL = 'read_agent'

/** Every work-queue / observability tool Cowork dispatches itself. */
export const WORK_TOOL_NAMES = new Set([
  POST_WORK_TOOL,
  CLAIM_WORK_TOOL,
  COMPLETE_WORK_TOOL,
  LIST_WORK_TOOL,
  READ_AGENT_TOOL,
])

/** The queue-mutating tools, withheld in plan mode. (list_work and read_agent
 * are no longer advertised at all -- see `workqueueTools`.) */
export const WORK_MUTATION_NAMES = new Set([
  POST_WORK_TOOL,
  CLAIM_WORK_TOOL,
  COMPLETE_WORK_TOOL,
])

/** Wording ported from `work_tool_schemas` in Rust; the two surfaces advertise
 * the same contract. Only the three queue mutators are offered -- list_work and
 * read_agent are un-advertised, matching the Rust loop -- and plan mode drops
 * even those, so it returns an empty set there. */
export function workqueueTools(planMode: boolean): Record<string, Tool> {
  const tools: Record<string, Tool> = {}
  if (!planMode) {
    tools[POST_WORK_TOOL] = {
      description:
        'Post a task to the shared work queue for a worker to pick up. Fan out independent work by posting several, then dispatching generic workers that each claim and complete one. deps names work ids whose results this task needs (each must already be posted); the task is claimable only once they finish, and their results are handed to whoever claims it. Returns the new work id.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'What the worker should do, self-contained.',
          },
          deps: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Work ids (e.g. ["w-1"]) this task depends on; each must already be posted. Optional.',
          },
          title: {
            type: 'string',
            description:
              'Optional short label shown on the queue (defaults to the task).',
          },
        },
        required: ['task'],
      }),
    } as Tool
    tools[CLAIM_WORK_TOOL] = {
      description:
        'Claim the next ready task from the shared work queue and receive its instructions and any dependency results. Call this as a worker: claim, do the work, then complete_work. If it reports nothing is ready, stop -- you will be pinged when new work appears; do not loop on it.',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
    } as Tool
    tools[COMPLETE_WORK_TOOL] = {
      description:
        'Report the result of a work item you claimed. Its result is saved and delivered to anything that depends on it. You must have claimed the item first.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          work_id: {
            type: 'string',
            description: 'The id you claimed (from claim_work).',
          },
          result: {
            type: 'string',
            description: 'The finished result for this item.',
          },
        },
        required: ['work_id', 'result'],
      }),
    } as Tool
  }
  // list_work and read_agent are not advertised (matching the Rust loop): the
  // queue and each peer's status are visible to the user via the rail and the
  // background-tasks view, and a worker's claim->do->complete loop does not need
  // to poll them. Their constants and `runWorkOp` arms stay, so a named call is
  // still handled and the change is reversible.
  return tools
}

/** What `runWorkOp` needs: the session, the caller's collaboration id (the
 * poster/claimer/completer of record), and a sink for the fresh snapshot. */
export type WorkDispatch = {
  sessionId: string
  agentId: string
  onWorkQueue?: (items: WorkItemView[]) => void
}

/** Route one work-queue / observability tool call to its guest-js command and
 * apply the post-mutation snapshot. Always resolves to a model-facing result. */
export async function runWorkOp(
  toolName: string,
  input: unknown,
  ctx: WorkDispatch
): Promise<ToolOutcome> {
  const args =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  if (toolName === READ_AGENT_TOOL) {
    const output = await readAgent(ctx.sessionId, ctx.agentId, args)
    return { output, isError: output.startsWith('ERROR') }
  }
  let res: WorkCommandResult | null
  switch (toolName) {
    case POST_WORK_TOOL:
      res = await postWork(ctx.sessionId, ctx.agentId, args)
      break
    case CLAIM_WORK_TOOL:
      res = await claimWork(ctx.sessionId, ctx.agentId)
      break
    case COMPLETE_WORK_TOOL:
      res = await completeWork(ctx.sessionId, ctx.agentId, args)
      break
    case LIST_WORK_TOOL:
      res = await listWork(ctx.sessionId)
      break
    default:
      return { output: `ERROR: unknown work tool '${toolName}'`, isError: true }
  }
  if (!res) {
    return { output: 'ERROR: the work queue is unavailable', isError: true }
  }
  ctx.onWorkQueue?.(res.items)
  return { output: res.message, isError: res.message.startsWith('ERROR') }
}
