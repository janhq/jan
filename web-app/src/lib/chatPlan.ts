/** Positive allowlist: MCP tools cannot be assumed read-only from their names. */
const PLAN_RAG_TOOLS = new Set(['retrieve', 'list_attachments', 'get_chunks'])
const PLAN_READ_TOOLS = new Set([
  'read', 'ls', 'find', 'grep', 'skill_list', 'skill_read',
  'memory', 'todo', 'ask', 'web_search', 'web_fetch',
])

export function chatPlanToolRefusal(
  enabled: boolean, name: string, input?: unknown, mcp = false, trustedRag = false
): string | undefined {
  if (!enabled) return
  if (mcp || (!PLAN_READ_TOOLS.has(name) && !(trustedRag && PLAN_RAG_TOOLS.has(name)))) {
    return `The \`${name}\` tool is disabled in Plan mode, which is read-only. Stage changes in the plan and ask the user to leave Plan mode before implementation.`
  }
  if (name === 'memory') {
    const op = input && typeof input === 'object' ? (input as { op?: unknown }).op : undefined
    if (op !== 'view' && op !== 'search') return 'Plan mode only permits memory view and search.'
  }
}
