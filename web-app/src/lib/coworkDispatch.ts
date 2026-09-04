import {
  executeAgentTool,
  listAgentMonitors,
  startAgentMonitor,
  stopAgentMonitor,
} from '@/lib/agentTools'
import { useCoworkConfig } from '@/hooks/useCoworkConfig'
import {
  ASK_TOOL_NAME,
  PLAN_DENIED_TOOLS,
  TASK_TOOL_NAME,
  TODO_TOOL_NAME,
} from '@/lib/coworkTools'
import {
  MONITOR_TOOL_NAME,
  monitorSpecFromArgs,
  type MonitorLane,
} from '@/lib/coworkMonitor'
import type { PendingToolCall, ToolOutcome } from '@/lib/coworkRunner'
import { WEB_TOOL_NAMES, executeWebTool } from '@/lib/webSearchTool'

export type DispatchContext = {
  sessionId: string
  readOnlyFolder: string | null
  planMode: boolean
  /** Mirrors the advertised set. Refused when off, so a call to a tool that was
   * never advertised cannot reach the network the user switched off. */
  webSearch: boolean
  /** Applies one `todo` operation and persists the result. */
  onTodo: (input: unknown) => Promise<ToolOutcome>
  /** Suspends until the user answers, or the run is aborted. */
  onAsk: (toolCallId: string, input: unknown) => Promise<ToolOutcome>
  /** Runs a nested subagent to completion. */
  onTask: (toolCallId: string, input: unknown) => Promise<ToolOutcome>
  /** The session's monitor lane; `null` for a subagent's dispatch, which
   * refuses the tool (a child has no turn of its own for a match to start). */
  monitors: MonitorLane | null
}

/**
 * Refusal text for a tool plan mode withholds.
 *
 * Withholding alone is not authoritative — a model can emit a call to a tool
 * that was never advertised, and the SDK still surfaces it — so the dispatcher
 * refuses by name too. The wording tells the model what to do instead, or it
 * simply retries.
 */
function planRefusal(toolName: string): ToolOutcome {
  return {
    output:
      `The \`${toolName}\` tool is disabled in plan mode, which is read-only. ` +
      'Finish investigating, stage the plan with the `todo` tool, then call ' +
      '`ask` for plan review.',
    isError: true,
  }
}

/**
 * One `monitor` op. The watcher runs in Rust; this routes the call and keeps
 * the session's `MonitorLane` in step, so matches queue as pings and the rail
 * tracks each watcher.
 */
async function runMonitorOp(
  input: unknown,
  ctx: DispatchContext
): Promise<ToolOutcome> {
  const monitors = ctx.monitors
  if (!monitors) {
    return {
      output: 'The monitor belongs to the agent that dispatched you.',
      isError: true,
    }
  }
  const args = (input ?? {}) as { op?: unknown; monitor_id?: unknown }
  const op = typeof args.op === 'string' ? args.op : ''
  if (op === 'start') {
    const started = await startAgentMonitor(
      ctx.sessionId,
      input,
      (update) => monitors.update(update),
      ctx.readOnlyFolder,
      useCoworkConfig.getState().networkEnabled,
      // Cowork mounts the attached folder writable (shared-folder mode).
      true
    )
    if (!started.isError)
      monitors.started(started.output, monitorSpecFromArgs(input))
    return { output: started.output, isError: started.isError }
  }
  if (op === 'stop') {
    const monitorId = typeof args.monitor_id === 'string' ? args.monitor_id : ''
    const result = await stopAgentMonitor(ctx.sessionId, monitorId)
    monitors.stopped(monitorId, result)
    return { output: result, isError: result.startsWith('ERROR') }
  }
  if (op === 'list') {
    return { output: await listAgentMonitors(ctx.sessionId) }
  }
  return { output: `ERROR: unknown monitor op '${op}'`, isError: true }
}

/**
 * Route one tool call. Always resolves: a rejection here would abort the run,
 * where the model can usually recover from being told what went wrong.
 */
export async function dispatchCoworkTool(
  call: PendingToolCall,
  ctx: DispatchContext
): Promise<ToolOutcome> {
  const { toolName } = call

  if (ctx.planMode && PLAN_DENIED_TOOLS.has(toolName)) {
    return planRefusal(toolName)
  }

  try {
    if (toolName === TODO_TOOL_NAME) return await ctx.onTodo(call.input)
    if (toolName === ASK_TOOL_NAME) {
      return await ctx.onAsk(call.toolCallId, call.input)
    }
    if (toolName === TASK_TOOL_NAME) {
      return await ctx.onTask(call.toolCallId, call.input)
    }
    if (toolName === MONITOR_TOOL_NAME) {
      return await runMonitorOp(call.input, ctx)
    }

    if (WEB_TOOL_NAMES.has(toolName)) {
      if (!ctx.webSearch) {
        return {
          output:
            `The \`${toolName}\` tool is off: web access is disabled in ` +
            'Settings. Work from what you can read locally.',
          isError: true,
        }
      }
      const web = await executeWebTool(toolName, call.input ?? {})
      if (web.error) return { output: web.error, isError: true }
      return {
        output:
          typeof web.content === 'string'
            ? web.content
            : JSON.stringify(web.content ?? ''),
      }
    }

    // `'session'`, not the default `'thread'`: a Cowork session id lives in its
    // own namespace, and the thread sweep would otherwise delete this sandbox
    // because no chat thread claims it. The network flag follows Cowork's own
    // setting (on by default), read per call so a toggle in Settings applies to
    // the next command; chat's shell stays network-closed regardless.
    // The attached folder is writable on this surface: Cowork's shared folder
    // takes writes and edits in place, unlike chat's read-only attachment.
    const result = await executeAgentTool(
      toolName,
      call.input,
      ctx.sessionId,
      ctx.readOnlyFolder,
      'session',
      useCoworkConfig.getState().networkEnabled,
      true
    )
    if (result.error) return { output: result.error, isError: true }
    return {
      output:
        typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content ?? ''),
      diff: result.diff,
      images: result.images,
    }
  } catch (e) {
    return {
      output: e instanceof Error ? e.message : String(e),
      isError: true,
    }
  }
}
