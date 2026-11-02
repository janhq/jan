import type { Tool } from 'ai'
import { subagentTools, parentToolNames } from './coworkSubagent'

/** Child-task narrowing for scoped Chat, reusing the ONE existing subagent
 * policy. INTEGRATOR REQUIREMENT (not enforced here): the future caller MUST
 * run children with the SAME threadId and the SAME per-call effective grant
 * getter as their parent — this wrapper cannot see or enforce either. This
 * module only narrows which of the parent's advertised tools a child sees.
 * The withheld set (task/ask/todo/monitor/memory) always applies, an
 * allowlist can only narrow, and a name the parent does not advertise can
 * never reach a child. No session flags, no separate authority. */
export function chatChildTools(
  parentTools: Record<string, Tool>,
  allowedTools: string[] | null
): Record<string, Tool> {
  return subagentTools(parentTools, allowedTools)
}

/** Names a Chat child may request, for narrowing nested dispatches. */
export function chatChildToolNames(tools: Record<string, Tool>): string[] {
  return parentToolNames(tools)
}
