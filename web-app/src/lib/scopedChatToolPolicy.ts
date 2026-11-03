import { resolveConversationCapabilities } from './conversationCapabilities'

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
  // shell is advertised unconditionally; the shellNetwork grant is NOT
  // consulted here or in authorizeThreadTool. Network confinement is enforced
  // at the native sandbox boundary, not by advertisement or schema authority.
  'shell',
  'skill_list',
  'skill_read',
] as const)

/** This policy emits only the NAME 'memory'; it builds no schema and filters
 * none. Shaping the advertised schema to read-only ops (view/search) is the
 * integrator's job when it attaches schemas. Chat dispatch refuses every
 * mutation op regardless of memoryWrite; that grant controls skill_write,
 * not mutation through this read-only memory tool. */
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
  /** Snapshot view only; dispatch re-reads the effective grant per call.
   * Equivalent to advertisesNativeTool('skill_write') today; kept as explicit
   * API until the integration consumes it, so callers name the intent rather
   * than a tool string. */
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

const MEMORY_READ_OPS = ['view', 'search'] as const

/** Read-only view of the Rust-owned `memory` parameter schema: `op` is narrowed
 * to view/search and the move-only `to` argument is dropped. Returns null (so
 * the caller withholds the tool) when the schema is not the expected shape,
 * rather than guessing. Chat dispatch independently refuses mutation ops,
 * regardless of the memoryWrite grant. Never mutates the cached input. */
export function memoryReadOnlyParameters(
  parameters: unknown
): Record<string, unknown> | null {
  const p = parameters as { properties?: Record<string, unknown>; required?: unknown } | null
  const op = p?.properties?.op as { enum?: unknown } | undefined
  if (!p || typeof p !== 'object' || !op || !Array.isArray(op.enum)) return null
  const ops = MEMORY_READ_OPS.filter((o) => (op.enum as unknown[]).includes(o))
  if (ops.length === 0) return null
  const properties = { ...(p.properties as Record<string, unknown>) }
  delete properties.to
  delete properties.title
  // The Rust per-property text documents mutation; replace it with read-only text.
  if (properties.name && typeof properties.name === 'object') {
    properties.name = { ...(properties.name as object), description: MEMORY_READ_NAME_DESCRIPTION }
  }
  delete properties.content
  delete properties.old
  delete properties.new
  return {
    ...(p as Record<string, unknown>),
    properties: {
      ...properties,
      op: { ...op, enum: ops, description: MEMORY_READ_OP_DESCRIPTION },
    },
  }
}

/** Read-only advertisement text for `memory`; the Rust description teaches
 * write/edit/delete/move and "no op asks the user", which is false here. */
export const MEMORY_READ_DESCRIPTION =
  'Read your long-term memory: durable notes kept across sessions. Use `view` for the index, a folder, or one note, and `search` to find notes by keyword. Only the read-only `view` and `search` operations are available here.'
const MEMORY_READ_OP_DESCRIPTION =
  'view: the index (no name), a folder\'s notes (`folder/`), or a note\'s content. search: keyword search over titles and bodies, archived notes included.'
const MEMORY_READ_NAME_DESCRIPTION =
  'Note name without .md: `note` or `folder/note` (this project), `user:note` (every project), `project:<slug>` or `project:<slug>/note` (another project). Optional for view.'

/* NOTE on roots: there is NO caller-supplied roots channel. The native API
 * takes only threadId/name/args plus the per-call effective-grant getter;
 * dispatch roots (scratch + any folder grant) are derived INSIDE the native
 * boundary from that per-call grant intersection. A former
 * scopedChatDispatchRoots helper was removed because it implied an
 * out-of-band roots parameter that does not and must not exist. */
