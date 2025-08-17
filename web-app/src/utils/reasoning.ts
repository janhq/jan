import { CompletionResponseChunk } from 'token.js'
import {
  chatCompletionChunk,
  ChatCompletionMessage,
  chatCompletionRequestMessage,
} from '@janhq/core'

// Extract reasoning from a message (for completed responses)
export function extractReasoningFromMessage(
  message: chatCompletionRequestMessage | ChatCompletionMessage
): string | null {
  if (!message) return null

  const extendedMessage = message as chatCompletionRequestMessage
  return extendedMessage.reasoning || null
}

// Extract reasoning from a chunk (for streaming responses)
function extractReasoningFromChunk(
  chunk: CompletionResponseChunk | chatCompletionChunk
): string | null {
  if (!chunk.choices?.[0]?.delta) return null

  const delta = chunk.choices[0].delta as chatCompletionRequestMessage
  const reasoning = delta.reasoning

  // Return null for falsy values, non-strings, or whitespace-only strings
  if (!reasoning || typeof reasoning !== 'string' || !reasoning.trim())
    return null

  return reasoning
}

// Tracks reasoning state and appends reasoning tokens with proper think tags
export class ReasoningProcessor {
  private isReasoningActive = false

  processReasoningChunk(
    chunk: CompletionResponseChunk | chatCompletionChunk
  ): string {
    const reasoning = extractReasoningFromChunk(chunk)
    const chunkContent = chunk.choices?.[0]?.delta?.content || ''

    // Handle reasoning tokens
    if (reasoning) {
      if (!this.isReasoningActive) {
        this.isReasoningActive = true
        return '<think>' + reasoning
      }
      return reasoning
    }

    // Handle reasoning end when content starts
    if (this.isReasoningActive && chunkContent) {
      this.isReasoningActive = false
      return '</think>'
    }

    // No reasoning to process
    return ''
  }

  finalize(): string {
    if (this.isReasoningActive) {
      this.isReasoningActive = false
      return '</think>'
    }
    return ''
  }

  isReasoningInProgress(): boolean {
    return this.isReasoningActive
  }
}
