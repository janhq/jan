import { invoke } from '@tauri-apps/api/core'
import { SkillMeta, ToolResult, ToolSchema } from './types'

export { SkillMeta, ToolResult, ToolSchema } from './types'

/**
 * Every call takes the Jan data folder, because the plugin derives its
 * directories from it (`<dataFolder>/agent-workspace`) while the app remains the
 * owner of where the data folder actually is.
 *
 * Two roots, with different lifetimes:
 *
 * - the **permanent store** (`memory/`, `skills/`) survives every conversation
 * - a **thread sandbox** (`threads/<threadId>/`) is where the filesystem tools
 *   run and is deleted with its thread
 *
 * `project` overrides which store is used and is unused for now: there is no
 * project picker yet. It exists so adding one later needs no signature change.
 */

/** Ensure the permanent store exists and return its path. */
export async function workspacePath(dataFolder: string): Promise<string> {
  return await invoke('plugin:agent-tools|workspace_path', { dataFolder })
}

/** Ensure a thread's sandbox exists and return its path. */
export async function threadWorkspacePath(
  dataFolder: string,
  threadId: string
): Promise<string> {
  return await invoke('plugin:agent-tools|thread_workspace_path', {
    dataFolder,
    threadId,
  })
}

/**
 * Delete a thread's sandbox. Memory and skills are untouched. Idempotent: a
 * thread that never ran a tool resolves successfully.
 */
export async function threadWorkspaceDelete(
  dataFolder: string,
  threadId: string
): Promise<void> {
  return await invoke('plugin:agent-tools|thread_workspace_delete', {
    dataFolder,
    threadId,
  })
}

/**
 * Delete every sandbox not belonging to a surviving thread, returning how many
 * were removed. For startup: a crash, or a thread deleted while the app was
 * closed, would otherwise leave one behind.
 */
export async function threadWorkspaceSweep(
  dataFolder: string,
  keep: string[]
): Promise<number> {
  return await invoke('plugin:agent-tools|thread_workspace_sweep', {
    dataFolder,
    keep,
  })
}

export async function skillList(
  dataFolder: string,
  project?: string
): Promise<SkillMeta[]> {
  return await invoke('plugin:agent-tools|skill_list', { dataFolder, project })
}

/** Raw SKILL.md text, frontmatter included. */
export async function skillRead(
  dataFolder: string,
  name: string,
  project?: string
): Promise<string> {
  return await invoke('plugin:agent-tools|skill_read', {
    dataFolder,
    project,
    name,
  })
}

/** Create or overwrite a skill. New skills are written as `<name>/SKILL.md`. */
export async function skillWrite(
  dataFolder: string,
  name: string,
  content: string,
  project?: string
): Promise<void> {
  return await invoke('plugin:agent-tools|skill_write', {
    dataFolder,
    project,
    name,
    content,
  })
}

/** Delete a skill. Idempotent: a missing skill resolves successfully. */
export async function skillDelete(
  dataFolder: string,
  name: string,
  project?: string
): Promise<void> {
  return await invoke('plugin:agent-tools|skill_delete', {
    dataFolder,
    project,
    name,
  })
}

/** Memory note names (stems), sorted. */
export async function memoryList(
  dataFolder: string,
  project?: string
): Promise<string[]> {
  return await invoke('plugin:agent-tools|memory_list', { dataFolder, project })
}

export async function memoryRead(
  dataFolder: string,
  name: string,
  project?: string
): Promise<string> {
  return await invoke('plugin:agent-tools|memory_read', {
    dataFolder,
    project,
    name,
  })
}

export async function memoryWrite(
  dataFolder: string,
  name: string,
  content: string,
  project?: string
): Promise<void> {
  return await invoke('plugin:agent-tools|memory_write', {
    dataFolder,
    project,
    name,
    content,
  })
}

/** Delete a memory note. Idempotent: a missing note resolves successfully. */
export async function memoryDelete(
  dataFolder: string,
  name: string,
  project?: string
): Promise<void> {
  return await invoke('plugin:agent-tools|memory_delete', {
    dataFolder,
    project,
    name,
  })
}

/**
 * Function schemas for every built-in tool. Callers pick which subset to
 * advertise; the schemas are never re-typed in TypeScript.
 */
export async function toolSchemas(): Promise<ToolSchema[]> {
  return await invoke('plugin:agent-tools|tool_schemas')
}

/** Which OS sandbox, if any, can confine a shell on this machine. */
export type SandboxStatus = {
  /** `bubblewrap`, `seatbelt`, `appcontainer`, or `none`. */
  backend: string
  enforces: boolean
}

/**
 * Report the sandbox backend. Callers should advertise `bash` to a model only
 * when this reports `enforces`: without a backend every call is refused, and
 * offering a tool that cannot run wastes a turn and reads as a bug.
 */
export async function sandboxStatus(): Promise<SandboxStatus> {
  return await invoke('plugin:agent-tools|sandbox_status')
}

/**
 * Execute one built-in tool.
 *
 * The filesystem tools run in `threadId`'s sandbox, which is created on demand,
 * so the caller need not ensure it first. Memory and skill tools reach the
 * permanent store instead, so what the model records outlives the conversation.
 *
 * The permission gate decides in Rust, so tools that need user approval
 * (`write`, `edit`, and reads that escape the sandbox) reject regardless of what
 * is requested here. `bash` runs only under an enforcing OS sandbox; see
 * `sandboxStatus`.
 *
 * `allowNetwork` opens the sandboxed shell's network namespace. It defaults to
 * off, so omitting it is the safe choice.
 */
export async function executeTool(
  dataFolder: string,
  threadId: string,
  name: string,
  args: Record<string, unknown>,
  project?: string,
  enabledSkills?: string[],
  allowNetwork?: boolean
): Promise<ToolResult> {
  return await invoke('plugin:agent-tools|execute_tool', {
    dataFolder,
    threadId,
    project,
    name,
    args,
    enabledSkills,
    allowNetwork,
  })
}
