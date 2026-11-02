import {
  resolveConversationCapabilities,
  type ConversationCapabilitiesV1,
} from './conversationCapabilities'

/** Native Chat tools only. MCP approval and the currentChat tool approval gate
 * belong to the runner, and MUST precede this boundary. Advertisement is not
 * authority. Session tools (task/monitor) cannot enter a thread namespace. */
const THREAD_TOOLS = new Set([
  'read', 'ls', 'find', 'grep', 'write', 'edit', 'shell',
  'memory', 'skill_list', 'skill_read', 'skill_write',
])

/** Native Chat names that dispatch through this boundary. */
export const isScopedThreadTool = (name: string): boolean => THREAD_TOOLS.has(name)

/** Whether a call reaches beyond the conversation scratch root under the CURRENT
 * grant (network or project folder for shell, folder writes, durable memory or
 * skill mutation). Elevated calls need the normal per-call approval; plain
 * scratch calls keep Chat's auto-allow. Malformed grants resolve to the default,
 * so they are never elevated by corrupt metadata. */
export function isElevatedThreadCall(
  name: string,
  args: Record<string, unknown>,
  value: unknown
): boolean {
  const grant = resolveConversationCapabilities(value)
  switch (name) {
    case 'skill_write': return true
    case 'memory': return args.op !== 'view' && args.op !== 'search'
    case 'shell': return grant.shellNetwork || !!grant.folderScope
    case 'write':
    case 'edit': return grant.folderScope?.access === 'write'
    default: return false
  }
}

export function authorizeThreadTool(
  name: string,
  args: Record<string, unknown>,
  value: unknown
): ConversationCapabilitiesV1 {
  if (!THREAD_TOOLS.has(name)) {
    throw new Error(`Tool is not available in scoped Chat: ${name}`)
  }
  const grant = resolveConversationCapabilities(value)
  if ((name === 'skill_write' ||
    (name === 'memory' && args.op !== 'view' && args.op !== 'search')) &&
    !grant.memoryWrite) {
    throw new Error('This conversation has not granted durable memory writes.')
  }
  return grant
}

/** Read the overlay-aware authority immediately before invoking native code,
 * never when schemas are frozen or a turn/child is created. Native independently
 * loads stored consent and intersects these requested limits; this snapshot can
 * narrow persisted consent but cannot widen it. No caller-supplied project or
 * network flags are accepted here. */
export function dispatchThreadTool<T>(
  name: string,
  args: Record<string, unknown>,
  getEffectiveGrant: () => unknown,
  invoke: (grant: ConversationCapabilitiesV1) => Promise<T>
): Promise<T> {
  const grant = authorizeThreadTool(name, args, getEffectiveGrant())
  return invoke(grant)
}
