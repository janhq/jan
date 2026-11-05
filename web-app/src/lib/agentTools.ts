import {
  toolSchemas,
  executeTool,
  executeThreadTool,
  sandboxStatus,
  threadWorkspaceDelete,
  threadWorkspaceSweep,
  sessionWorkspaceDelete,
  sessionWorkspaceSweep,
  memoryCatalog,
  memoryRead,
  subagentResultReserve,
  subagentResultFill,
  blackboardWrite,
  attachmentImport,
  startMonitor,
  stopMonitor,
  listMonitors,
  startThreadMonitor,
  stopThreadMonitor,
  listThreadMonitors,
  stopAllThreadMonitors,
  revokeThreadCapabilities,
  sessionMonitorIds,
  stopSessionMonitors,
  cancelThreadBash,
  type MemoryCatalogEntry,
  type MonitorUpdate,
  type SandboxStatus,
  type ToolImage,
  type ToolSchema,
  type WorkspaceScope,
} from '@janhq/tauri-plugin-agent-tools-api'
import { getServiceHub } from '@/hooks/useServiceHub'
import { notifyMemoryMutation } from '@/lib/memorySaveFeedback'
import {
  dispatchThreadTool,
  intersectConversationCapabilities,
} from './scopedToolDispatch'

/**
 * The built-in agent tools the desktop can dispatch.
 *
 * `write` and `edit` are included: they can only touch the thread's ephemeral
 * sandbox, which is deleted with the conversation, so `execute_tool` allows them
 * without a prompt. Withholding them while `shell` can write the same files would
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
  'shell',
  // One tool for every memory op (view/search/write/edit/delete/move).
  'memory',
  'skill_list',
  'skill_read',
  'skill_write',
  // Renders a local .html/.svg with headless Chrome so the agent can see what
  // it built. Read capability: it writes nothing back.
  'screenshot',
])

/**
 * Whether a recorded tool call ran the shell, for *displaying saved history*
 * only. Turns saved before the tool was renamed carry its old name `bash`; they
 * keep their terminal view and artifacts. Nothing dispatches or allows `bash`:
 * the sets above and below name only `shell`.
 */
export const isRecordedShellCall = (toolName: string): boolean =>
  toolName === 'shell' || toolName === 'bash'

/**
 * The subset the main chat surface advertises and dispatches: the sandboxed
 * shell alone, with no network. The full toolset above is Cowork's — chat is a
 * conversation that occasionally runs a command, not an agent surface.
 */
export { CHAT_AGENT_TOOL_NAMES } from './toolCapabilityPolicy'

/**
 * Tools that only run under an enforcing OS sandbox. They stay in
 * `AGENT_TOOL_NAMES` -- the desktop still owns dispatching them -- but are held
 * back from the advertised schemas when no backend can confine them.
 */
const SANDBOX_REQUIRED_TOOLS = new Set(['shell'])

let schemaCache: ToolSchema[] | null = null
let statusCache: Promise<SandboxStatus> | null = null

/**
 * The sandbox backend for this machine, fetched once. A failure is treated as
 * "no sandbox", which withholds `shell` rather than offering something that
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
 * leaving `schemaCache` behind would keep `shell` withheld even once a backend
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
 * the sandbox decides whether `shell` is among them.
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

export type { MemoryCatalogEntry, ToolImage }

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
 * every in-app write path (a `memory` tool change, the settings editors, the
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
  // memory tool to dereference a truncated one with.
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
  /** Images the tool returned, for a vision model to see. */
  images?: ToolImage[]
}

const messageOf = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e)

/**
 * Execute one built-in agent tool.
 *
 * Thread scope always uses the dedicated native scoped command. Caller folder,
 * network, write and skill-overlay flags are ignored in that scope: only current
 * explicit per-thread consent can request them. Native rechecks persisted consent
 * and canonical containment. Session scope retains Cowork's existing contract.
 * The caller still owns currentChat tool approval; consent does not auto-approve.
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
  projectWritable = false,
  /**
   * A project folder whose project-store skills (`~/.jan/projects/<slug>/skills`)
   * layer on top of the permanent store for `skill_list`/`skill_read`, so an
   * attached folder's skills reach the agent alongside the global ones (#8879).
   * Cowork passes its attached folder; chat leaves it unset, keeping its skills
   * global-only. Memory and skill writes stay on the permanent store regardless.
   */
  skillProject?: string | null,
  /**
   * Thread scope only. Upper bound captured when the caller classified (and
   * approved) this call. The grant read at dispatch is intersected with it, so
   * a grant widened after classification cannot expand the call; a revoke
   * still narrows. Undefined keeps the current-grant-only behaviour.
   */
  effectiveGrantCeiling?: unknown,
  /** Suppresses UI feedback for a result discarded after Stop. */
  signal?: AbortSignal,
  /**
   * Thread scope only. The calling run's latched Plan state, read immediately
   * before native dispatch (after approval waits and async setup). It is OR-ed
   * with the live toolbar state, so enabling Plan late tightens, while turning
   * it off cannot widen a run that latched Plan. The reviewed Execute transition
   * clears both. Native uses it to keep tool hooks inert in Plan.
   *
   * Session scope (legacy Cowork) sends it too, as the sole Plan source: Cowork's
   * run-latched `planMode`. It is required there at runtime: omitting it fails
   * closed with an error before any native call, rather than defaulting Plan off
   * and letting hooks and mutating tools run. The parameter stays optional in the
   * signature only because thread scope does not need it.
   */
  planActive?: () => boolean
): Promise<AgentToolResult> {
  // Session scope has no other Plan source, so a caller that predates the latched
  // provider must not silently run as "Plan off". Mirrors the native commands,
  // which make `planMode` required.
  if (scope === 'session' && typeof planActive !== 'function') {
    return {
      error:
        'Session-scope tool call refused: the run Plan state was not provided (planActive is required).',
    }
  }
  try {
    const dataFolder = await getServiceHub().app().getJanDataFolder()
    if (!dataFolder) return { error: 'Jan data folder is unavailable' }
    const args =
      input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : {}
    // Resolve after asynchronous setup, immediately before native dispatch. The
    // dynamic import avoids useThreads -> cleanup helpers -> useThreads cycles.
    const runTool = async () => {
      if (scope === 'thread') {
        const { useThreads } = await import('@/hooks/useThreads')
        const { chatPlanEnabled } = await import('@/hooks/useChatPlan')
        return dispatchThreadTool(
          toolName,
          args,
          () => {
            const current = useThreads
              .getState()
              .getConversationCapabilities(threadId)
            return effectiveGrantCeiling === undefined
              ? current
              : intersectConversationCapabilities(current, effectiveGrantCeiling)
          },
          (grant) =>
            // Evaluated here, not earlier: the last point before native code.
            executeThreadTool(
              threadId,
              toolName,
              args,
              grant,
              (planActive?.() ?? false) || chatPlanEnabled(threadId)
            )
        )
      }
      return executeTool(
        dataFolder,
        threadId,
        toolName,
        args,
        skillProject ?? undefined,
        undefined,
        allowNetwork,
        readOnlyProject ?? undefined,
        projectWritable,
        scope,
        undefined,
        // Evaluated here, the last point before native code, like the thread path.
        planActive?.() ?? false
      )
    }
    const result = await runTool()
    if (result.isError) return { error: result.content }
    // The store changed, so the recall injections must not keep serving the
    // snapshot taken before this note existed.
    if (toolName === 'memory' && isMemoryChange(args)) {
      invalidateMemory()
      notifyMemoryMutation(args, result.content, signal)
    }
    return {
      content: result.content,
      diff: result.diff ?? undefined,
      images: result.images?.length ? result.images : undefined,
    }
  } catch (e) {
    return { error: messageOf(e) }
  }
}

/** Whether a `memory` call changes the store (anything but view/search). */
function isMemoryChange(args: Record<string, unknown>): boolean {
  return args.op !== 'view' && args.op !== 'search'
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

/**
 * Drop a thread's confirmed elevations in the host process, and stop anything
 * still running under them.
 *
 * Narrow-only, so it can deny but never grant. Awaited by the consent setter
 * before it persists: the frontend's own save queue may still hold an earlier
 * write, and until the host is narrowed a background monitor poll would keep
 * being authorized by the grant being revoked. Throws if the host could not be
 * narrowed, so the caller must not treat the revocation as applied.
 */
export async function revokeThreadCapabilitiesInHost(
  threadId: string
): Promise<void> {
  await revokeThreadCapabilities(threadId)
}

/**
 * Start a monitor owned by a Chat thread.
 *
 * Unlike {@link startAgentMonitor} this passes no data folder, scope, network
 * or writability flag: the host resolves each one from the thread's own
 * consent and re-resolves it before every poll, so a grant captured when the
 * monitor started authorizes nothing later. Chat threads never go through the
 * Cowork session surface.
 */
export async function startThreadAgentMonitor(
  threadId: string,
  args: unknown,
  onUpdate: (update: MonitorUpdate) => void,
  /** The grant the run captured when it classified (and had approved) this
   * start. Required: the host keeps its intersection with current authority as
   * the monitor's ceiling for every poll. */
  effectiveGrantCeiling: unknown,
  /** The run's latched Plan state; the host refuses a start under Plan. */
  planActive: () => boolean
): Promise<{ output: string; isError?: boolean }> {
  try {
    const input =
      args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
    const { useThreads } = await import('@/hooks/useThreads')
    const { chatPlanEnabled } = await import('@/hooks/useChatPlan')
    const grant = intersectConversationCapabilities(
      useThreads.getState().getConversationCapabilities(threadId),
      effectiveGrantCeiling
    )
    return {
      output: await startThreadMonitor(
        threadId,
        input,
        onUpdate,
        grant,
        planActive() || chatPlanEnabled(threadId)
      ),
    }
  } catch (e) {
    return { output: `ERROR: ${messageOf(e)}`, isError: true }
  }
}

/** Stop one of a thread's monitors. The result string is model-facing. */
export async function stopThreadAgentMonitor(
  threadId: string,
  monitorId: string
): Promise<string> {
  try {
    return await stopThreadMonitor(threadId, monitorId)
  } catch (e) {
    return `ERROR: ${messageOf(e)}`
  }
}

/** One line per active monitor on a thread, for `monitor {op:"list"}`. */
export async function listThreadAgentMonitors(
  threadId: string
): Promise<string> {
  try {
    return await listThreadMonitors(threadId)
  } catch (e) {
    return `ERROR: ${messageOf(e)}`
  }
}

/**
 * Stop every monitor a thread still has. Best-effort: used at teardown, where
 * a failure must not block the caller.
 */
export async function stopAllThreadAgentMonitors(
  threadId: string
): Promise<void> {
  try {
    await stopAllThreadMonitors(threadId)
  } catch {
    // Teardown only; the host also reaps on revoke and delete.
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
 * The ids of a session's still-active monitors, for the rail to reconcile
 * against. Best-effort: on failure the caller keeps its current rail rather
 * than clearing them, so a transient error never wrongly settles a live watcher.
 */
export async function activeAgentMonitorIds(sessionId: string): Promise<string[] | null> {
  try {
    return await sessionMonitorIds(sessionId)
  } catch (e) {
    console.warn('[agentTools] Failed to list active monitors:', messageOf(e))
    return null
  }
}

/**
 * Abort every monitor a session still has. Best-effort teardown when the
 * session is deleted: a failure leaves watchers whose updates go nowhere, not
 * user-visible damage.
 */
export async function stopAgentSessionMonitors(sessionId: string): Promise<void> {
  try {
    await stopSessionMonitors(sessionId)
  } catch (e) {
    console.warn('[agentTools] Failed to stop session monitors:', messageOf(e))
  }
}

/**
 * Kill every `shell` tree this session started when the user presses Stop.
 * Best-effort: aborting the JS run already unwinds the turn, so a failure here
 * only means a shell keeps running, not user-visible damage.
 */
export async function cancelAgentThreadBash(sessionId: string): Promise<void> {
  try {
    await cancelThreadBash(sessionId)
  } catch (e) {
    console.warn('[agentTools] Failed to cancel session shells:', messageOf(e))
  }
}

/** Close must confirm native teardown rather than treating it as best-effort. */
export async function cancelAgentThreadBashStrict(sessionId: string): Promise<void> {
  await cancelThreadBash(sessionId)
}

/** A file claimed for a subagent's answer: the name to fill it by, and its
 * real path in the session scratch, which the parent agent can `read`. */
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
 * Write a finished subagent's answer to `blackboard/<name>.md` in the session
 * scratch -- the name-keyed coordination file a phased dispatch's next phase
 * reads. Returns the model-visible path, or `null` when no scratch is reachable
 * (the web build), so the caller can fall back to delivering the answer inline.
 */
export async function writeBlackboard(
  sessionId: string,
  name: string,
  content: string
): Promise<string | null> {
  try {
    return await blackboardWrite(sessionId, name, content)
  } catch (e) {
    console.warn('[agentTools] Failed to write the blackboard:', messageOf(e))
    return null
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
export async function cleanupThreadWorkspace(
  threadId: string,
  scope: WorkspaceScope = 'thread'
): Promise<void> {
  try {
    const dataFolder = await getServiceHub().app().getJanDataFolder()
    if (!dataFolder) return
    if (scope === 'session') {
      await sessionWorkspaceDelete(dataFolder, threadId)
    } else {
      await threadWorkspaceDelete(dataFolder, threadId)
    }
  } catch (e) {
    console.warn(
      `[agentTools] Failed to delete workspace for thread ${threadId}:`,
      messageOf(e)
    )
  }
}

/**
 * Collect Cowork (session-scope) sandboxes whose conversation is gone. The
 * caller must only run this once the Cowork migration has finished: while it is
 * partial, the live-id list is incomplete and the sweep would delete the
 * sandboxes of sessions not yet migrated.
 */
export async function sweepSessionWorkspaces(
  liveSessionIds: string[]
): Promise<number> {
  try {
    const dataFolder = await getServiceHub().app().getJanDataFolder()
    if (!dataFolder) return 0
    return await sessionWorkspaceSweep(dataFolder, liveSessionIds)
  } catch (e) {
    console.warn('[agentTools] Failed to sweep session workspaces:', messageOf(e))
    return 0
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
