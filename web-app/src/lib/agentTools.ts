import {
  toolSchemas,
  executeTool,
  sandboxStatus,
  threadWorkspaceDelete,
  threadWorkspaceSweep,
  memoryCatalog,
  memoryRead,
  subagentResultReserve,
  subagentResultFill,
  attachmentImport,
  startMonitor,
  stopMonitor,
  listMonitors,
  stopSessionMonitors,
  type MemoryCatalogEntry,
  type MonitorUpdate,
  type SandboxStatus,
  type ToolSchema,
  type WorkspaceScope,
} from '@janhq/tauri-plugin-agent-tools-api'
import { getServiceHub } from '@/hooks/useServiceHub'

/**
 * The built-in agent tools the desktop can dispatch.
 *
 * `write` and `edit` are included: they can only touch the thread's ephemeral
 * sandbox, which is deleted with the conversation, so `execute_tool` allows them
 * without a prompt. Withholding them while `bash` can write the same files would
 * be a restriction a sibling tool trivially bypasses.
 *
 * `web_search`/`web_fetch` are also built-ins but are already advertised through
 * the websearch plugin (see `webSearchTool.ts`), so they are not duplicated here.
 */
export const AGENT_TOOL_NAMES = new Set([
  'read',
  'ls',
  'find',
  'grep',
  'write',
  'edit',
  'bash',
  'memory_list',
  'memory_read',
  'memory_write',
  'skill_list',
  'skill_read',
  'skill_write',
  // Renders a local .html/.svg with headless Chrome so the agent can see what
  // it built. Read capability: it writes nothing back.
  'screenshot',
])

/**
 * The subset the main chat surface advertises and dispatches: the sandboxed
 * shell alone, with no network. The full toolset above is Cowork's — chat is a
 * conversation that occasionally runs a command, not an agent surface.
 */
export const CHAT_AGENT_TOOL_NAMES = new Set(['bash'])

/**
 * Tools that only run under an enforcing OS sandbox. They stay in
 * `AGENT_TOOL_NAMES` -- the desktop still owns dispatching them -- but are held
 * back from the advertised schemas when no backend can confine them.
 */
const SANDBOX_REQUIRED_TOOLS = new Set(['bash'])

let schemaCache: ToolSchema[] | null = null
let statusCache: Promise<SandboxStatus> | null = null

/**
 * The sandbox backend for this machine, fetched once. A failure is treated as
 * "no sandbox", which withholds `bash` rather than offering something that
 * cannot run.
 */
export function getSandboxStatus(): Promise<SandboxStatus> {
  statusCache ??= sandboxStatus()
    .catch((e) => {
      console.warn('[agentTools] Failed to read sandbox status:', messageOf(e))
      return { backend: 'none', enforces: false }
    })
    .then((s) => {
      enforcesNow = s.enforces
      return s
    })
  return statusCache
}

let enforcesNow = false

/**
 * Re-probe the sandbox, dropping both caches. Installing a backend (bubblewrap
 * on Linux) cannot take effect otherwise: `statusCache` is module-level, and
 * leaving `schemaCache` behind would keep `bash` withheld even once a backend
 * enforces.
 */
export function refreshSandboxStatus(): Promise<SandboxStatus> {
  statusCache = null
  schemaCache = null
  return getSandboxStatus()
}

/**
 * Synchronous view of the sandbox, for building the system prompt. `false` until
 * the probe resolves, which is safe: the prompt is assembled after
 * `getAgentToolSchemas`, so by then the answer is known.
 */
export function sandboxEnforces(): boolean {
  return enforcesNow
}

/**
 * Schemas for the advertised subset. Rust's `schema.rs` is the only source, and
 * the sandbox decides whether `bash` is among them.
 */
export async function getAgentToolSchemas(): Promise<ToolSchema[]> {
  if (schemaCache) return schemaCache
  const [all, sandbox] = await Promise.all([toolSchemas(), getSandboxStatus()])
  schemaCache = all.filter(
    (s) =>
      AGENT_TOOL_NAMES.has(s.function.name) &&
      (sandbox.enforces || !SANDBOX_REQUIRED_TOOLS.has(s.function.name))
  )
  return schemaCache
}

export type { MemoryCatalogEntry }

/**
 * Injection caps for the shared memory store. The *store* is unbounded; what
 * every conversation pays for is not: Cowork's catalog lists at most the 50
 * most recently modified notes, and chat's digest carries at most 2 KiB of
 * whole notes. Beyond that, the settings page is the pruning tool.
 */
export const MEMORY_CATALOG_MAX_NOTES = 50
export const MEMORY_DIGEST_BUDGET = 2048

type MemorySnapshot = { catalog: MemoryCatalogEntry[]; digest: string }

let memoryCache: Promise<MemorySnapshot> | null = null
let digestNow = ''

/**
 * Drop the cached snapshot so the next run/send re-reads the store. Called from
 * every in-app write path (the `memory_write` tool, the settings editors, the
 * chat Remember action); an edit made outside the app is picked up on restart.
 */
export function invalidateMemory(): void {
  memoryCache = null
}

async function loadMemorySnapshot(): Promise<MemorySnapshot> {
  const dataFolder = await getServiceHub().app().getJanDataFolder()
  if (!dataFolder) return { catalog: [], digest: '' }
  const newestFirst = (await memoryCatalog(dataFolder)).sort(
    (a, b) => b.mtimeMs - a.mtimeMs
  )
  const catalog = newestFirst.slice(0, MEMORY_CATALOG_MAX_NOTES)

  // The digest is self-contained: whole notes only, newest first, under a
  // strict budget. A note that does not fit is simply absent -- chat has no
  // memory_read to dereference a truncated one with.
  let remaining = MEMORY_DIGEST_BUDGET
  const parts: string[] = []
  for (const entry of newestFirst) {
    if (remaining <= 0) break
    const body = (await memoryRead(dataFolder, entry.name).catch(() => ''))
      .trim()
    if (!body) continue
    const block = `## ${entry.name}\n${body}`
    // The joiner counts too, or the assembled digest could exceed the budget.
    const cost = block.length + (parts.length > 0 ? 2 : 0)
    if (cost > remaining) continue
    parts.push(block)
    remaining -= cost
  }
  return { catalog, digest: parts.join('\n\n') }
}

function getMemorySnapshot(): Promise<MemorySnapshot> {
  memoryCache ??= loadMemorySnapshot()
    .catch((e) => {
      console.warn('[agentTools] Failed to load memory:', messageOf(e))
      return { catalog: [], digest: '' }
    })
    .then((snapshot) => {
      digestNow = snapshot.digest
      return snapshot
    })
  return memoryCache
}

/**
 * The memory catalog for prompt injection: the newest notes, capped, then
 * name-sorted so the block is stable when nothing changed.
 */
export async function getMemoryCatalog(): Promise<MemoryCatalogEntry[]> {
  const { catalog } = await getMemorySnapshot()
  return [...catalog].sort((a, b) => a.name.localeCompare(b.name))
}

/** Ensure the digest is loaded; chat awaits this before building its prompt. */
export async function refreshMemoryDigest(): Promise<string> {
  return (await getMemorySnapshot()).digest
}

/**
 * Synchronous view of the digest, for the sync prompt builder. `''` until
 * `refreshMemoryDigest` resolves, which `sendMessages` awaits first.
 */
export function memoryDigestNow(): string {
  return digestNow
}

type AgentToolResult = {
  content?: unknown
  error?: string
  /** Unified diff from `write`/`edit`. Display-only; never sent to the model. */
  diff?: string
}

const messageOf = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e)

/**
 * Execute one built-in agent tool.
 *
 * The filesystem tools are confined to this thread's own sandbox, so scratch
 * files from one conversation are invisible to the next; memory and skill tools
 * reach the permanent store instead and persist. No project path is passed --
 * the desktop has no project picker yet, so the plugin uses the permanent store
 * in the Jan data folder.
 *
 * `bash` additionally runs under an OS sandbox whose network access is closed
 * unless the caller opens it. Chat never does; Cowork passes its own setting.
 */
export async function executeAgentTool(
  toolName: string,
  input: unknown,
  threadId: string,
  /**
   * A project folder to attach read-only. Rust validates it and refuses one
   * that overlaps the workspace or the Jan data folder, rather than silently
   * dropping it, so an unusable attachment surfaces as a tool error.
   */
  readOnlyProject?: string | null,
  /**
   * Which sandbox namespace `threadId` names. Load-bearing: a Cowork session id
   * is not a chat thread id, so running one under `'thread'` would put its files
   * where the thread sweep's keep-list can never mention them — and the sweep
   * would delete the only copy of the agent's work.
   */
  scope: WorkspaceScope = 'thread',
  /** Opens the sandboxed shell's network namespace. Closed by default. */
  allowNetwork = false,
  /** Opt the attached folder into writes and edits in place (Cowork's shared
   * folder). Off by default, so chat's attachment stays read-only. */
  projectWritable = false
): Promise<AgentToolResult> {
  try {
    const dataFolder = await getServiceHub().app().getJanDataFolder()
    if (!dataFolder) return { error: 'Jan data folder is unavailable' }
    const args =
      input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : {}
    const result = await executeTool(
      dataFolder,
      threadId,
      toolName,
      args,
      undefined,
      undefined,
      allowNetwork,
      readOnlyProject ?? undefined,
      projectWritable,
      scope
    )
    if (result.isError) return { error: result.content }
    // The store changed, so the recall injections must not keep serving the
    // snapshot taken before this note existed.
    if (toolName === 'memory_write') invalidateMemory()
    return { content: result.content, diff: result.diff ?? undefined }
  } catch (e) {
    return { error: messageOf(e) }
  }
}

export type { MonitorUpdate }

/**
 * Start a file monitor for a Cowork session. `onUpdate` receives every match
 * (and the terminal all-met/timeout update) as it happens; the returned string
 * is the model-facing `monitor` tool result. An error comes back as an
 * `ERROR:`-prefixed output rather than a throw, matching the tool contract.
 */
export async function startAgentMonitor(
  sessionId: string,
  args: unknown,
  onUpdate: (update: MonitorUpdate) => void,
  readOnlyProject?: string | null,
  allowNetwork = false,
  projectWritable = false
): Promise<{ output: string; isError?: boolean }> {
  try {
    const dataFolder = await getServiceHub().app().getJanDataFolder()
    if (!dataFolder) return { output: 'ERROR: Jan data folder is unavailable', isError: true }
    const input =
      args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
    const output = await startMonitor(dataFolder, sessionId, input, onUpdate, {
      allowNetwork,
      readOnlyProject: readOnlyProject ?? undefined,
      projectWritable,
      scope: 'session',
    })
    return { output }
  } catch (e) {
    return { output: `ERROR: ${messageOf(e)}`, isError: true }
  }
}

/** Stop one monitor. The result string is model-facing either way. */
export async function stopAgentMonitor(
  sessionId: string,
  monitorId: string
): Promise<string> {
  try {
    return await stopMonitor(sessionId, monitorId)
  } catch (e) {
    return `ERROR: ${messageOf(e)}`
  }
}

/** One line per active monitor, for `monitor {op:"list"}`. */
export async function listAgentMonitors(sessionId: string): Promise<string> {
  try {
    return await listMonitors(sessionId)
  } catch (e) {
    return `ERROR: ${messageOf(e)}`
  }
}

/**
 * Abort every monitor a session still has. Best-effort teardown at run end: a
 * failure leaves watchers whose updates go nowhere, not user-visible damage.
 */
export async function stopAgentSessionMonitors(sessionId: string): Promise<void> {
  try {
    await stopSessionMonitors(sessionId)
  } catch (e) {
    console.warn('[agentTools] Failed to stop session monitors:', messageOf(e))
  }
}

/** A file claimed for a subagent's answer: the name to fill it by, and the
 * model-visible path (`/tmp/subagents/<id>.md`, where the scratch is mounted
 * over `/tmp`) the parent agent can `read`. */
export type SubagentResultFile = { file: string; path: string }

/**
 * Claim a file in the session scratch for a subagent's answer.
 *
 * Claimed before the child starts, because `task` reports where the answer will
 * be while it is still working. `null` when no scratch is reachable (the web
 * build), in which case the caller falls back to delivering the answer inline.
 */
export async function reserveSubagentResult(
  sessionId: string,
  id: string
): Promise<SubagentResultFile | null> {
  try {
    return await subagentResultReserve(sessionId, id)
  } catch (e) {
    console.warn('[agentTools] Failed to claim a result file:', messageOf(e))
    return null
  }
}

/** Write a finished subagent's answer into the file claimed for it. `false`
 * when it could not be written, so the caller can deliver it inline instead. */
export async function fillSubagentResult(
  sessionId: string,
  file: string,
  content: string
): Promise<boolean> {
  try {
    await subagentResultFill(sessionId, file, content)
    return true
  } catch (e) {
    console.warn('[agentTools] Failed to save subagent result:', messageOf(e))
    return false
  }
}

/**
 * Copy a user attachment into the session workspace, with its extracted text
 * beside it. `null` when it could not be copied, so the caller can tell the
 * agent instead of naming a path that is not there.
 */
export async function importAttachment(
  sessionId: string,
  source: string,
  text?: string
): Promise<{ path: string; textPath: string | null } | null> {
  try {
    const dataFolder = await getServiceHub().app().getJanDataFolder()
    if (!dataFolder) return null
    return await attachmentImport(dataFolder, sessionId, source, text)
  } catch (e) {
    console.warn('[agentTools] Failed to import attachment:', messageOf(e))
    return null
  }
}

/**
 * Delete a thread's sandbox. Best-effort: a failure here leaves a directory
 * behind for the next startup sweep to collect, which is not worth surfacing
 * while the user is deleting a thread.
 */
export async function cleanupThreadWorkspace(threadId: string): Promise<void> {
  try {
    const dataFolder = await getServiceHub().app().getJanDataFolder()
    if (!dataFolder) return
    await threadWorkspaceDelete(dataFolder, threadId)
  } catch (e) {
    console.warn(
      `[agentTools] Failed to delete workspace for thread ${threadId}:`,
      messageOf(e)
    )
  }
}

/**
 * Delete sandboxes left behind by threads that no longer exist, returning how
 * many were removed. Best-effort, same reasoning as above.
 */
export async function sweepThreadWorkspaces(
  liveThreadIds: string[]
): Promise<number> {
  try {
    const dataFolder = await getServiceHub().app().getJanDataFolder()
    if (!dataFolder) return 0
    return await threadWorkspaceSweep(dataFolder, liveThreadIds)
  } catch (e) {
    console.warn('[agentTools] Failed to sweep thread workspaces:', messageOf(e))
    return 0
  }
}
