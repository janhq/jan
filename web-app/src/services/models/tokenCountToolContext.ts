import type { ThreadContent } from '@janhq/core'

const stringify = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

type ToolResponsePart = {
  text?: string
}

type ToolCallLike = {
  tool?: {
    function?: {
      name?: string
    }
  }
  name?: string
  response?: {
    content?: ToolResponsePart[] | unknown
  } | unknown
  result?: unknown
}

const asToolCallLike = (value: unknown): ToolCallLike =>
  typeof value === 'object' && value !== null ? (value as ToolCallLike) : {}

export const extractToolContextFromContent = (
  content: ThreadContent[]
): string => {
  if (!Array.isArray(content) || content.length === 0) return ''

  const toolEntries = content
    .filter((item) => item?.type === 'tool_call')
    .map((item) => {
      const toolName = item.tool_name || 'tool'
      const output = stringify(item.output)
      const input = stringify(item.input)
      const payload = output || input
      return payload ? `${toolName}: ${payload}` : ''
    })
    .filter(Boolean)

  return toolEntries.join('\n')
}

export const extractToolContextFromMetadata = (
  metadata?: Record<string, unknown>
): string => {
  if (!metadata) return ''
  const toolCalls = (metadata as { tool_calls?: unknown }).tool_calls
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return ''

  const entries = toolCalls
    .map((call) => {
      const parsedCall = asToolCallLike(call)
      const toolName = parsedCall.tool?.function?.name || parsedCall.name || 'tool'
      const responseContent =
        typeof parsedCall.response === 'object' && parsedCall.response !== null
          ? (parsedCall.response as { content?: unknown }).content
          : undefined
      if (Array.isArray(responseContent)) {
        const text = responseContent
          .map((part) =>
            typeof part?.text === 'string' ? part.text : stringify(part)
          )
          .filter(Boolean)
          .join('\n')
        return text ? `${toolName}: ${text}` : ''
      }
      const responseText = stringify(parsedCall.response ?? parsedCall.result)
      return responseText ? `${toolName}: ${responseText}` : ''
    })
    .filter(Boolean)

  return entries.join('\n')
}
