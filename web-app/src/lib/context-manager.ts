import type { UIMessage } from '@ai-sdk/react'
import { generateText, type LanguageModel } from 'ai'

/**
 * Approximate token count using a character-based heuristic.
 *
 * On average, 1 token ≈ 4 characters for English text across most
 * tokenizers (GPT, Claude, etc.). This is intentionally conservative
 * so the trimmer leaves a safety margin.
 */
const CHARS_PER_TOKEN = 3.5

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function messageToText(message: UIMessage): string {
  const parts: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      parts.push(part.text)
    } else if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
      parts.push(JSON.stringify(part))
    }
  }

  const metadata = message.metadata as
    | { inline_file_contents?: Array<{ name?: string; content?: string }> }
    | undefined
  if (Array.isArray(metadata?.inline_file_contents)) {
    for (const file of metadata.inline_file_contents) {
      if (file?.content) {
        parts.push(`File: ${file.name || 'attachment'}\n${file.content}`)
      }
    }
  }

  return parts.join('\n')
}

export function estimateMessageTokens(message: UIMessage): number {
  const text = messageToText(message)
  // Add a small overhead per message for role/formatting tokens
  return estimateTokens(text) + 4
}

export interface ContextManagerConfig {
  maxContextTokens: number
  maxOutputTokens: number
  autoCompact: boolean
}

export interface TrimResult {
  messages: UIMessage[]
  trimmedCount: number
  compactedSummary?: string
}

/**
 * Trim messages to fit within the context budget.
 *
 * Strategy:
 * 1. Always keep the system prompt (counted separately) and the most recent message
 * 2. Walk backwards from the newest message, accumulating tokens
 * 3. Drop the oldest messages that don't fit
 * 4. Never drop the first user message if it would leave no context
 */
export function trimMessages(
  messages: UIMessage[],
  config: ContextManagerConfig,
  systemPromptTokens: number = 0
): TrimResult {
  const { maxContextTokens, maxOutputTokens } = config

  if (maxContextTokens <= 0) {
    return { messages, trimmedCount: 0 }
  }

  const inputBudget = maxContextTokens - maxOutputTokens - systemPromptTokens
  if (inputBudget <= 0) {
    return { messages: messages.slice(-1), trimmedCount: messages.length - 1 }
  }

  // Estimate tokens for each message
  const estimates = messages.map((msg) => ({
    message: msg,
    tokens: estimateMessageTokens(msg),
  }))

  // Walk backwards, accumulating tokens
  let totalTokens = 0
  const kept: UIMessage[] = []

  for (let i = estimates.length - 1; i >= 0; i--) {
    const { message, tokens } = estimates[i]
    if (totalTokens + tokens > inputBudget && kept.length > 0) {
      break
    }
    totalTokens += tokens
    kept.unshift(message)
  }

  // Ensure we always have at least the last message
  if (kept.length === 0 && messages.length > 0) {
    kept.push(messages[messages.length - 1])
  }

  return {
    messages: kept,
    trimmedCount: messages.length - kept.length,
  }
}

const COMPACT_SYSTEM_PROMPT =
  'You are a conversation summarizer. Produce a concise summary that preserves ' +
  'key facts, decisions, code snippets, and action items. Use bullet points. ' +
  'Keep the summary under 500 words.'

/**
 * Summarize older messages that would be trimmed, then prepend the summary
 * as a system-style user message so the model retains context.
 */
export async function compactMessages(
  messages: UIMessage[],
  config: ContextManagerConfig,
  model: LanguageModel,
  systemPromptTokens: number = 0
): Promise<TrimResult> {
  const { maxContextTokens, maxOutputTokens } = config

  if (maxContextTokens <= 0) {
    return { messages, trimmedCount: 0 }
  }

  const inputBudget = maxContextTokens - maxOutputTokens - systemPromptTokens
  if (inputBudget <= 0) {
    return { messages: messages.slice(-1), trimmedCount: messages.length - 1 }
  }

  // First figure out which messages would be kept/dropped
  const trimResult = trimMessages(messages, config, systemPromptTokens)

  if (trimResult.trimmedCount === 0) {
    return trimResult
  }

  const droppedMessages = messages.slice(0, trimResult.trimmedCount)

  // Build conversation text from dropped messages
  const conversationText = droppedMessages
    .map((m) => {
      const text = m.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')
      return `${m.role}: ${text}`
    })
    .join('\n\n')

  if (!conversationText.trim()) {
    return trimResult
  }

  // Truncate if extremely long
  const truncated =
    conversationText.length > 30000
      ? conversationText.slice(-30000)
      : conversationText

  try {
    const { text: summary } = await generateText({
      model,
      system: COMPACT_SYSTEM_PROMPT,
      prompt: `Summarize this conversation excerpt:\n\n${truncated}`,
      maxOutputTokens: 512,
    })

    // Create a synthetic user message with the summary
    const summaryMessage: UIMessage = {
      id: `compact-summary-${Date.now()}`,
      role: 'user',
      parts: [
        {
          type: 'text',
          text: `[Previous conversation summary]\n${summary}`,
        },
      ],
    }

    return {
      messages: [summaryMessage, ...trimResult.messages],
      trimmedCount: trimResult.trimmedCount,
      compactedSummary: summary,
    }
  } catch (error) {
    console.warn('Auto-compact summarization failed, falling back to trim:', error)
    return trimResult
  }
}
