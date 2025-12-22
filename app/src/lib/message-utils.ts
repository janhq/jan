import type { UIMessage } from 'ai'

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
    if (messages[i].role === 'user') {
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
 * Convert ConversationItems to UIMessage format
 * @param items - Array of ConversationItems
 * @returns  Array of UIMessage objects
 */
export const convertToUIMessages = (items: ConversationItem[]): UIMessage[] => {
  return items
    .filter((e) => e.role !== 'tool')
    .map((item) => {
      const parts = item.content
        .map((content) => {
          // Determine the content type
          let contentType: 'text' | 'reasoning' | 'file' = 'text'

          if (content.type === 'reasoning_text') {
            contentType = 'reasoning'
          } else if (content.type === 'input_text' || content.type === 'text') {
            contentType = 'text'
          } else if (content.type === 'image') {
            contentType = 'file'
          } else if (content.type === 'tool_calls') {
            contentType = 'text'
            return (
              content.tool_calls?.map((toolCall) => {
                // Find the corresponding tool result by matching tool_call_id
                const toolResult = items.find(
                  (item) =>
                    item.role === 'tool' &&
                    (item.content.some(
                      (c: any) => c.tool_call_id === toolCall.id
                    ) ||
                      // @ts-ignore fallback for older structure
                      (item.call_id === toolCall.id && item.type === 'message'))
                )
                const isError = !toolResult?.content ||
                  toolResult?.content.some(
                    (e) =>
                      (typeof e.mcp_call === 'string' &&
                        e.mcp_call?.toLowerCase().includes('error:')) ||
                      (typeof e.tool_result === 'string' &&
                        e.tool_result?.toLowerCase().includes('error:'))
                  ) || false

                return {
                  type: `tool-${toolCall.function.name}`,
                  input:
                    typeof toolCall.function.arguments === 'string'
                      ? JSON.parse(toolCall.function.arguments)
                      : toolCall.function.arguments,
                  output: isError ? undefined : toolResult?.content || '',
                  state: isError ? 'output-error' : 'output-available',
                  error: isError ? toolResult?.content : undefined,
                  toolCallId: toolCall.id || '',
                }
              }) || []
            )
          } else {
            contentType = content.type as 'text' | 'reasoning' | 'file'
          }

          return [
            {
              type: contentType,
              text:
                content.text?.text ||
                content.text ||
                content.input_text ||
                content.reasoning_text ||
                '',
              mediaType: contentType === 'file' ? 'image/jpeg' : undefined,
              url: contentType === 'file' ? content.image?.url : undefined,
            },
          ]
        })
        .flat()

      // Sort parts: reasoning first, then other types
      const sortedParts = parts.sort((a, b) => {
        if (a.type === 'reasoning' && b.type !== 'reasoning') return -1
        if (a.type !== 'reasoning' && b.type === 'reasoning') return 1
        return 0
      })

      return {
        id: item.id,
        role: item.role as 'user' | 'assistant' | 'system',
        parts: sortedParts,
      } as UIMessage
    })
}
