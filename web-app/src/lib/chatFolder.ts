import { useThreads } from '@/hooks/useThreads'

/**
 * The file tools a chat gets while a folder is attached to it, on top of the
 * shell. Without a folder chat keeps the shell alone (`CHAT_AGENT_TOOL_NAMES`).
 */
export const CHAT_FOLDER_TOOL_NAMES = new Set([
  'read',
  'ls',
  'find',
  'grep',
  'write',
  'edit',
])

/**
 * Calls that change the attached folder or run in it. With a folder attached
 * they are asked for on every call and no answer is saved: the shell can write
 * the folder as well as `write` and `edit` can. Reads run without asking.
 */
const ASKED_WITH_FOLDER = new Set(['write', 'edit', 'shell'])

/** A stored folder value, or `null` when it is missing or blank. */
export function folderOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * The folder attached to a chat thread, from its record. The record is the
 * authority: Rust reads the same `thread.json` field when the tool runs, so
 * what is offered here and what is reachable there cannot drift apart.
 */
export function chatFolderOf(threadId: string | undefined): string | null {
  if (!threadId) return null
  return folderOf(useThreads.getState().threads[threadId]?.metadata?.folder)
}

/** Whether a built-in chat call must be asked for, given the thread's folder. */
export function chatToolNeedsApproval(
  toolName: string,
  threadId: string
): boolean {
  return ASKED_WITH_FOLDER.has(toolName) && chatFolderOf(threadId) !== null
}
