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
