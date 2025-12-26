import type { UIMessage } from 'ai'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { MESSAGE_ROLE, CONTENT_TYPE } from '@/constants'

/**
 * Find the index of the preceding user message before an assistant message
 * @param messages - Array of UI messages
 * @param assistantIndex - Index of the assistant message
 * @returns Index of the preceding user message, or -1 if not found
 */
export function findPrecedingUserMessageIndex(
  messages: UIMessage[],
  assistantIndex: number
): number {
  for (let i = assistantIndex - 1; i >= 0; i--) {
    if (messages[i].role === MESSAGE_ROLE.USER) {
      return i
    }
  }
  return -1
}

/**
 * Find the index of the preceding assistant message before a user message
 * @param messages - Array of UI messages
 * @param userIndex - Index of the user message
 * @returns Index of the preceding assistant message, or -1 if not found
 */
export function findPrecedingAssistantMessageIndex(
  messages: UIMessage[],
  userIndex: number
): number {
  for (let i = userIndex - 1; i >= 0; i--) {
    if (messages[i].role === MESSAGE_ROLE.ASSISTANT) {
      return i
    }
  }
  return -1
}

/**
 * Build ID mapping between local (temp) IDs and backend (real) IDs
 * @param localMessages - Local UI messages
 * @param backendMessages - Messages from backend
 * @param idMap - Map to store the ID mappings
 * @param upToIndex - Optional index to limit mapping (exclusive)
 */
export function buildIdMapping(
  localMessages: UIMessage[],
  backendMessages: UIMessage[],
  idMap: Map<string, string>,
  upToIndex?: number
): void {
  const limit = upToIndex ?? localMessages.length
  for (let i = 0; i < limit && i < backendMessages.length; i++) {
    const local = localMessages[i]
    const backend = backendMessages[i]
    if (local && backend && local.id !== backend.id) {
      idMap.set(local.id, backend.id)
    }
  }
}

/**
 * Resolve a temp ID to its real backend ID
 * @param tempId - The temporary/local ID
 * @param idMap - Map containing ID mappings
 * @returns The real backend ID if found, otherwise the original tempId
 */
export function resolveMessageId(
  tempId: string,
  idMap: Map<string, string>
): string {
  return idMap.get(tempId) ?? tempId
}

/**
 * Build content array from a prompt message for server persistence
 * @param message - The prompt input message
 * @returns Array of conversation item content
 */
export function buildMessageContent(
  message: PromptInputMessage
): ConversationItemContent[] {
  const content: ConversationItemContent[] = []

  if (message.text) {
    content.push({
      type: CONTENT_TYPE.INPUT_TEXT,
      input_text: message.text,
    })
  }

  message.files?.forEach((file) => {
    if (file.url) {
      content.push({
        type: 'image',
        image: { url: file.url },
      })
    }
  })

  return content
}
