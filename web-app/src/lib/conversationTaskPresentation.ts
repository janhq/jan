import { isToolUIPart, getToolName, type UIMessage } from 'ai'
import { TODO_TOOL_NAME } from './coworkTools'
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
        if (
          !value ||
          typeof value !== 'object' ||
          !('phases' in value) ||
          !Array.isArray(value.phases)
        )
          continue
        if (
          !value.phases.every((phase: unknown) => {
            if (
              !phase ||
              typeof phase !== 'object' ||
              !('name' in phase) ||
              typeof phase.name !== 'string' ||
              !('tasks' in phase) ||
              !Array.isArray(phase.tasks)
            )
              return false
            return phase.tasks.every(
              (task: unknown) =>
                task &&
                typeof task === 'object' &&
                'content' in task &&
                typeof task.content === 'string' &&
                'status' in task &&
                ['pending', 'in_progress', 'completed', 'abandoned'].includes(
                  String(task.status)
                )
            )
          })
        )
          continue
        latest = value as TodoList
      } catch {
        /* An invalid/error result cannot erase the preceding snapshot. */
      }
    }
  }
  return latest
}
