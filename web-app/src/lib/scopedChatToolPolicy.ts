import {
  resolveConversationCapabilities,
  type ConversationCapabilitiesV1,
} from './conversationCapabilities'

/** Pure Chat-surface advertisement policy for the scoped native tool namespace.
 *
 * Advertisement is not authority: schema building, ordering, freezing, MCP
 * approval and the existing Chat tool-approval path stay with their current
 * owners, and every invocation still passes through the scoped dispatch
 * boundary (scopedToolDispatch) with a per-call effective-grant getter. This
 * module only decides which native names a Chat turn may advertise, from a
 * per-turn snapshot, so schemas stay stable within a turn.
 */

/** Scratch-safe native tools advertised whenever the scoped namespace is
 * active. They operate inside the conversation scratch root by default and
 * grant neither project roots nor network. */
export const SCOPED_CHAT_SCRATCH_TOOLS = Object.freeze([
  'read',
  'ls',
  'find',
  'grep',
  'write',
  'edit',
  'shell',
  'skill_list',
  'skill_read',
] as const)

/** memory is advertised with its read (view/search) schema whenever active;
 * mutation ops are gated at dispatch by the memoryWrite grant, never by
 * swapping schemas mid-turn. */
export const SCOPED_CHAT_MEMORY_TOOL = 'memory'

/** Durable-mutation-only tools: advertised only when the turn snapshot already
 * carries the memoryWrite grant, and still re-checked at dispatch. */
export const SCOPED_CHAT_MEMORY_WRITE_TOOLS = Object.freeze(['skill_write'] as const)

/** Session/orchestration and browser/web identities that MUST NOT enter the
 * scoped Chat native allowlist, with or without grants. Web search keeps its
 * separate non-native route; monitor/task/screenshot are Cowork-session scoped. */
export const SCOPED_CHAT_EXCLUDED_NATIVE_TOOLS = Object.freeze([
  'screenshot',
  'web_search',
  'web_fetch',
  'fetch',
  'monitor',
  'task',
] as const)

/** Client-rendered tools. todo/ask ride the client channel, not the native
 * allowlist; their Chat route integration is a later, separate change. */
export const SCOPED_CHAT_CLIENT_TOOLS = Object.freeze(['todo', 'ask'] as const)

export type ScopedChatPolicyInput = {
  /** Builder-level Chat gate: the selected model advertises tool support. */
  modelSupportsTools: boolean
  /** The native scratch sandbox is actually available on this platform. */
  sandboxAvailable: boolean
}

export type ScopedChatToolPolicy = {
  /** Whether the scoped native namespace is advertised at all this turn. */
  active: boolean
  /** Frozen, per-turn-stable advertisement list (never a dispatch authority). */
  advertisedNativeTools: readonly string[]
  advertisesNativeTool: (name: string) => boolean
  /** Snapshot view only; dispatch re-reads the effective grant per call. */
  memoryMutationAdvertised: boolean
}

/** No settings reads or new defaults: the caller supplies its existing model
 * snapshot and the turn's capability-grant snapshot. Malformed or unknown
 * grant metadata fails closed via resolveConversationCapabilities, so a
 * corrupt snapshot can never advertise skill_write. */
export function resolveScopedChatToolPolicy(
  input: ScopedChatPolicyInput,
  turnGrantSnapshot: unknown
): ScopedChatToolPolicy {
  const active = input.modelSupportsTools && input.sandboxAvailable
  const grant = resolveConversationCapabilities(turnGrantSnapshot)
  const advertised: readonly string[] = active
    ? Object.freeze([
        ...SCOPED_CHAT_SCRATCH_TOOLS,
        SCOPED_CHAT_MEMORY_TOOL,
        ...(grant.memoryWrite ? SCOPED_CHAT_MEMORY_WRITE_TOOLS : []),
      ])
    : Object.freeze([])
  const names = new Set(advertised)
  return {
    active,
    advertisedNativeTools: advertised,
    advertisesNativeTool: (name: string) => names.has(name),
    memoryMutationAdvertised: active && grant.memoryWrite,
  }
}

/** Dispatch-time root resolution only. A folder grant extends the scratch
 * root scope when a call is invoked; it is never advertised as an
 * arbitrary-root schema parameter and never changes the advertised tool set.
 * Native containment (paths, symlinks, permissions) remains authoritative. */
export function scopedChatDispatchRoots(grant: ConversationCapabilitiesV1): {
  scratch: true
  folder: { path: string; access: 'read' | 'write' } | null
} {
  return { scratch: true, folder: grant.folderScope }
}
