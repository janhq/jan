import { executeAgentTool } from '@/lib/agentTools'
import {
  ASK_TOOL_NAME,
  PLAN_DENIED_TOOLS,
  TASK_TOOL_NAME,
  TODO_TOOL_NAME,
} from '@/lib/coworkTools'
import type { PendingToolCall, ToolOutcome } from '@/lib/coworkRunner'

export type DispatchContext = {
  sessionId: string
  readOnlyFolder: string | null
  planMode: boolean
  /** Applies one `todo` operation and persists the result. */
  onTodo: (input: unknown) => Promise<ToolOutcome>
  /** Suspends until the user answers, or the run is aborted. */
  onAsk: (toolCallId: string, input: unknown) => Promise<ToolOutcome>
  /** Runs a nested subagent to completion. */
  onTask: (toolCallId: string, input: unknown) => Promise<ToolOutcome>
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

    const result = await executeAgentTool(
      toolName,
      call.input,
      ctx.sessionId,
      ctx.readOnlyFolder
    )
    if (result.error) return { output: result.error, isError: true }
    return {
      output:
        typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content ?? ''),
      diff: result.diff,
    }
  } catch (e) {
    return {
      output: e instanceof Error ? e.message : String(e),
      isError: true,
    }
  }
}
