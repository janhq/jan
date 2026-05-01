/**
 * Helpers for estimating llama.cpp token counts from tool outputs and tool_call
 * message content. Kept separate from DefaultModelsService so tests and limits stay clear.
 */

import { ContentType, type ThreadMessage } from '@janhq/core'

/** Max recursion depth when walking MCP / tool payloads (avoids stack overflow). */
export const MAX_STRINGIFY_DEPTH_FOR_COUNT = 5

/** Cap serialized tool text so token counting stays bounded on huge MCP responses. */
export const MAX_TOOL_OUTPUT_CHARS_FOR_COUNT = 32_000

function truncateForTokenCount(s: string): string {
  if (s.length <= MAX_TOOL_OUTPUT_CHARS_FOR_COUNT) return s
  return `${s.slice(0, MAX_TOOL_OUTPUT_CHARS_FOR_COUNT)}…`
}

/**
 * Flattens tool/MCP payloads to plain text for token estimation.
 * Depth-limited; results are truncated to {@link MAX_TOOL_OUTPUT_CHARS_FOR_COUNT}.
 */
export function stringifyToolOutputForTokenCount(
  value: unknown,
  depth = 0
): string {
  if (depth > MAX_STRINGIFY_DEPTH_FOR_COUNT) return ''
  if (value == null) return ''
  if (typeof value === 'string') return truncateForTokenCount(value)
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    const inner = value
      .map((item) => stringifyToolOutputForTokenCount(item, depth + 1))
      .filter((item) => item.length > 0)
      .join('\n')
    return truncateForTokenCount(inner)
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.content)) {
      const contentText = record.content
        .map((item) => {
          if (!item || typeof item !== 'object') return ''
          const contentItem = item as {
            type?: string
            text?: unknown
            content?: unknown
          }
          if (typeof contentItem.text === 'string') {
            return truncateForTokenCount(contentItem.text)
          }
          if (contentItem.text != null) {
            return stringifyToolOutputForTokenCount(contentItem.text, depth + 1)
          }
          if (contentItem.content != null) {
            return stringifyToolOutputForTokenCount(contentItem.content, depth + 1)
          }
          return ''
        })
        .filter((item) => item.length > 0)
        .join('\n')
      if (contentText.length > 0) return truncateForTokenCount(contentText)
    }
    try {
      return truncateForTokenCount(JSON.stringify(record))
    } catch {
      return ''
    }
  }
  return ''
}

export function extractToolContextFromMetadata(message: ThreadMessage): string {
  const metadata = message.metadata as
    | {
        tool_calls?: Array<{
          tool?: { function?: { name?: string } }
          name?: string
          response?: unknown
          output?: unknown
        }>
      }
    | undefined

  if (!Array.isArray(metadata?.tool_calls)) return ''

  return metadata.tool_calls
    .map((toolCall) => {
      const toolName = toolCall.tool?.function?.name || toolCall.name || 'tool'
      const payload =
        toolCall.response != null ? toolCall.response : toolCall.output
      const outputText = stringifyToolOutputForTokenCount(payload).trim()
      if (!outputText) return ''
      return `Tool ${toolName} output:\n${outputText}`
    })
    .filter((entry) => entry.length > 0)
    .join('\n\n')
}

export function extractToolContextFromContent(message: ThreadMessage): string {
  if (!Array.isArray(message.content)) return ''

  return message.content
    .map((contentItem) => {
      if (contentItem.type !== ContentType.ToolCall) {
        return ''
      }

      const toolItem = contentItem as {
        tool_name?: string
        input?: unknown
        output?: unknown
      }

      const toolName = toolItem.tool_name || 'tool'
      const inputText = stringifyToolOutputForTokenCount(toolItem.input).trim()
      const outputText = stringifyToolOutputForTokenCount(
        toolItem.output
      ).trim()

      const parts = []
      if (inputText) parts.push(`Input:\n${inputText}`)
      if (outputText) parts.push(`Output:\n${outputText}`)
      if (parts.length === 0) return ''

      return `Tool ${toolName} call:\n${parts.join('\n\n')}`
    })
    .filter((entry) => entry.length > 0)
    .join('\n\n')
}
