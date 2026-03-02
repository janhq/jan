import {
  ChatCompletionMessage,
  chatCompletionRequestMessage,
} from '@janhq/core'

// Helper function to get reasoning content from an object
function getReasoning(
  obj:
    | { reasoning_content?: string | null; reasoning?: string | null }
    | null
    | undefined
): string | null {
  return obj?.reasoning_content ?? obj?.reasoning ?? null
}

/**
 * Normalize the content of a message by removing reasoning content.
 * This is useful to ensure that reasoning content does not get sent to the model.
 * @param content
 * @returns
 */
export function removeReasoningContent(content: string): string {
  // Reasoning content should not be sent to the model
  if (content.includes('<think>')) {
    const match = content.match(/<think>([\s\S]*?)<\/think>/)
    if (match?.index !== undefined) {
      const splitIndex = match.index + match[0].length
      content = content.slice(splitIndex).trim()
    }
  }
  if (content.includes('<|channel|>analysis<|message|>')) {
    const match = content.match(
      /<\|channel\|>analysis<\|message\|>([\s\S]*?)<\|start\|>assistant<\|channel\|>final<\|message\|>/
    )
    if (match?.index !== undefined) {
      const splitIndex = match.index + match[0].length
      content = content.slice(splitIndex).trim()
    }
  }
  return content
}

// Extract reasoning from a message (for completed responses)
export function extractReasoningFromMessage(
  message: chatCompletionRequestMessage | ChatCompletionMessage
): string | null {
  if (!message) return null

  const extendedMessage = message as chatCompletionRequestMessage
  return getReasoning(extendedMessage)
}
