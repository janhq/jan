import type { UIMessage } from 'ai'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { TOOL_STATE, CONTENT_TYPE, MESSAGE_ROLE } from '@/constants'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const getInitialsAvatar = (name: string) => {
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return words[0][0].toUpperCase()
}

/**
 * Convert ConversationItems to UIMessage format
 * @param items - Array of ConversationItems
 * @returns  Array of UIMessage objects
 */
export const convertToUIMessages = (items: ConversationItem[]): UIMessage[] => {
  return items
    .filter((e) => e.role !== MESSAGE_ROLE.TOOL)
    .map((item) => {
      const parts = item.content
        .map((content) => {
          // Determine the content type
          let contentType: 'text' | 'reasoning' | 'file' = CONTENT_TYPE.TEXT

          if (content.type === CONTENT_TYPE.REASONING_TEXT) {
            contentType = CONTENT_TYPE.REASONING
          } else if (content.type === CONTENT_TYPE.INPUT_TEXT || content.type === CONTENT_TYPE.TEXT) {
            contentType = CONTENT_TYPE.TEXT
          } else if (content.type === 'image') {
            contentType = CONTENT_TYPE.FILE
          } else if (content.type === CONTENT_TYPE.TOOL_CALLS) {
            contentType = CONTENT_TYPE.TEXT
            return (
              content.tool_calls?.map((toolCall) => {
                // Find the corresponding tool result by matching tool_call_id
                const toolResult = items.find(
                  (item) =>
                    item.role === MESSAGE_ROLE.TOOL &&
                    (item.content.some(
                      (c: any) => c.tool_call_id === toolCall.id
                    ) ||
                      // @ts-ignore fallback for older structure
                      (item.call_id === toolCall.id && item.type === 'message'))
                )
                const isError =
                  !toolResult?.content ||
                  toolResult?.content.some(
                    (e) =>
                      (typeof e.mcp_call === 'string' &&
                        e.mcp_call?.toLowerCase().includes('error:')) ||
                      (typeof e.tool_result === 'string' &&
                        e.tool_result?.toLowerCase().includes('error:'))
                  ) ||
                  false

                const error = isError
                  ? toolResult?.content.find((e) => e.tool_result || e.mcp_call)
                  : undefined

                return {
                  type: `tool-${toolCall.function.name}`,
                  input:
                    typeof toolCall.function.arguments === 'string'
                      ? JSON.parse(toolCall.function.arguments)
                      : toolCall.function.arguments,
                  output: toolResult?.content || '',
                  state: isError ? TOOL_STATE.OUTPUT_ERROR : TOOL_STATE.OUTPUT_AVAILABLE,
                  errorText: isError
                    ? error?.tool_result || error?.mcp_call
                    : undefined,
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
              mediaType: contentType === CONTENT_TYPE.FILE ? 'image/jpeg' : undefined,
              url: contentType === CONTENT_TYPE.FILE ? content.image?.url : undefined,
            },
          ]
        })
        .flat()

      // Sort parts: reasoning first, then other types
      const sortedParts = parts.sort((a, b) => {
        if (a.type === CONTENT_TYPE.REASONING && b.type !== CONTENT_TYPE.REASONING) return -1
        if (a.type !== CONTENT_TYPE.REASONING && b.type === CONTENT_TYPE.REASONING) return 1
        return 0
      })

      return {
        id: item.id,
        role: item.role as 'user' | 'assistant' | 'system',
        parts: sortedParts,
      } as UIMessage
    })
}
