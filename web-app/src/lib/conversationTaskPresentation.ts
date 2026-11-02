import { isToolUIPart, getToolName, type UIMessage } from 'ai'
import { TODO_TOOL_NAME } from './coworkTools'
import { isTodoList } from './coworkTodo'
import type { TodoList } from '@/types/coworkSession'

/** Project the last valid settled snapshot. No mutable state or replay of ops:
 * compacted/reloaded histories carry the same full tool result. */
export function conversationTodos(
  messages: readonly UIMessage[]
): TodoList | undefined {
  let latest: TodoList | undefined
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (
        !isToolUIPart(part) ||
        getToolName(part) !== TODO_TOOL_NAME ||
        part.state !== 'output-available'
      )
        continue
      try {
        const value: unknown =
          typeof part.output === 'string'
            ? JSON.parse(part.output)
            : part.output
        if (!isTodoList(value)) continue
        latest = value as TodoList
      } catch {
        /* An invalid/error result cannot erase the preceding snapshot. */
      }
    }
  }
  return latest
}

/** Legacy snapshots apply only before any settled todo snapshot. A pending
 * first legacy call must still read its baseline. Rewinds reset that fallback
 * explicitly in the session store, so discarded snapshots cannot revive. */
export function resolveConversationTodos(
  messages: readonly UIMessage[],
  legacy?: TodoList
): TodoList | undefined {
  return conversationTodos(messages) ?? legacy
}
