import {
  toolSchemas,
  executeTool,
  sandboxStatus,
  threadWorkspaceDelete,
  threadWorkspaceSweep,
  type SandboxStatus,
  type ToolSchema,
} from '@janhq/tauri-plugin-agent-tools-api'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useAgentToolsConfig } from '@/hooks/useAgentToolsConfig'

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
])

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
 * `bash` additionally runs under an OS sandbox, whose network access follows the
 * `bashNetworkEnabled` setting. It is read here, per call, rather than captured
 * once, so toggling it takes effect on the next command instead of the next
 * restart.
 */
export async function executeAgentTool(
  toolName: string,
  input: unknown,
  threadId: string
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
      useAgentToolsConfig.getState().bashNetworkEnabled
    )
    if (result.isError) return { error: result.content }
    return { content: result.content, diff: result.diff ?? undefined }
  } catch (e) {
    return { error: messageOf(e) }
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
