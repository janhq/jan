import type { UIMessage } from 'ai'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

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
