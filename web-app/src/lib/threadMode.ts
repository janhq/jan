import type { WorkspaceScope } from '@janhq/tauri-plugin-agent-tools-api'

/**
 * A conversation is started either as a Chat or as a Cowork task. The mode is
 * stored on the thread as `metadata.mode`; absent means chat, so every thread
 * written before Cowork was merged into threads is a chat.
 */
export type ThreadMode = 'chat' | 'cowork'

type WithMetadata = { metadata?: Record<string, unknown> | null } | null | undefined

export function getThreadMode(thread: WithMetadata): ThreadMode {
  return thread?.metadata?.mode === 'cowork' ? 'cowork' : 'chat'
}

export const isCoworkThread = (thread: WithMetadata): boolean =>
  getThreadMode(thread) === 'cowork'

/**
 * Which sandbox scope a conversation's workspace lives in. Cowork keeps its
 * `agent-workspace/sessions/<id>` sandboxes (no files move when a session
 * becomes a thread), so the scope follows the mode, not the storage.
 */
export function workspaceScopeFor(thread: WithMetadata): WorkspaceScope {
  return isCoworkThread(thread) ? 'session' : 'thread'
}
