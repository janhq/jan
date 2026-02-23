/* eslint-disable @typescript-eslint/no-explicit-any */
import { ThreadMessage, ContentType, MessageStatus } from '@janhq/core'
import type { UIMessage } from '@ai-sdk/react'
// Attachments are now handled upstream in newUserThreadContent

type ThreadContent = NonNullable<ThreadMessage['content']>[number]

/**
 * Convert AI SDK UIMessage to Jan's ThreadMessage format.
 * This allows using chatMessages from useChat with ThreadContent component.
 */
export function convertUIMessageToThreadMessage(
  uiMessage: UIMessage,
  threadId: string
): ThreadMessage {
  const content: ThreadContent[] = []

  // Extract text and image parts from UIMessage
  // Use 'any' for parts since the AI SDK types vary between versions
  for (const part of uiMessage.parts as any[]) {
    if (part.type === 'text') {
      content.push({
        type: ContentType.Text,
        text: {
          value: part.text,
          annotations: [],
        },
      })
    } else if (part.type === 'reasoning') {
      // Wrap reasoning in <think> tags for compatibility with existing rendering
      // The reasoning content is in 'reasoning' or 'text' depending on SDK version
      const reasoningText = part.reasoning ?? part.text ?? ''
      const existingText = content.find((c) => c.type === ContentType.Text)
      if (existingText && existingText.text) {
        existingText.text.value = `<think>${reasoningText}</think>${existingText.text.value}`
      } else {
        content.unshift({
          type: ContentType.Text,
          text: {
            value: `<think>${reasoningText}</think>`,
            annotations: [],
          },
        })
      }
    } else if (part.type === 'file' && part.mediaType) {
      // Handle file parts (images)
      const mediaType = part.mediaType as string
      if (mediaType?.startsWith('image/')) {
        content.push({
          type: ContentType.Image,
          image_url: {
            url: part.url,
            detail: 'auto',
          },
        })
      }
    }
  }

  // If no content was extracted, add empty text
  if (content.length === 0) {
    content.push({
      type: ContentType.Text,
      text: {
        value: '',
        annotations: [],
      },
    })
  }

  // Extract tool calls from parts
  const toolCalls = (uiMessage.parts as any[])
    .filter((part) => part.type.startsWith('tool'))
    .map((part) => {
      const toolName = part.type.replace('tool-', '')
      return {
        tool: {
          id: part.toolCallId || part.toolInvocationId,
          type: 'function' as const,
          function: {
            name: toolName,
            arguments:
              typeof part.input === 'string'
                ? part.input
                : JSON.stringify(part.input ?? part.args),
          },
        },
        state: part.state === 'output-available' ? 'completed' : 'pending',
        response: part.output ?? part.result,
      }
    })

  // Handle createdAt - may be on the message or not depending on SDK version
  const msgAny = uiMessage as any
  const createdAt =
    msgAny.createdAt instanceof Date
      ? msgAny.createdAt.getTime()
      : typeof msgAny.createdAt === 'number'
        ? msgAny.createdAt
        : Date.now()

  return {
    id: uiMessage.id,
    object: 'thread.message',
    thread_id: threadId,
    role: uiMessage.role as ThreadMessage['role'],
    content,
    status: MessageStatus.Ready,
    created_at: createdAt,
    completed_at: createdAt,
    metadata: toolCalls.length > 0 ? { tool_calls: toolCalls } : undefined,
  }
}

/**
 * Convert an array of AI SDK UIMessages to Jan's ThreadMessage format.
 */
export function convertUIMessagesToThreadMessages(
  uiMessages: UIMessage[],
  threadId: string
): ThreadMessage[] {
  return uiMessages.map((msg) => convertUIMessageToThreadMessage(msg, threadId))
}

// Define a temporary type for the expected tool result shape (ToolResult as before)
export type ToolResult = {
  content: Array<{
    type?: string
    text?: string
    data?: string
    image_url?: { url: string; detail?: string }
  }>
  error?: string
}

/**
 * Parse reasoning segments from the given text.
 * @param text - The text to parse reasoning from.
 * @returns
 */
export const parseReasoning = (text: string) => {
  // Check for thinking formats
  const hasThinkTag = text.includes('<think>') && !text.includes('</think>')
  const hasAnalysisChannel =
    text.includes('<|channel|>analysis<|message|>') &&
    !text.includes('<|start|>assistant<|channel|>final<|message|>')

  if (hasThinkTag || hasAnalysisChannel)
    return { reasoningSegment: text, textSegment: '' }

  // Check for completed think tag format
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/)
  if (thinkMatch?.index !== undefined) {
    const splitIndex = thinkMatch.index + thinkMatch[0].length
    return {
      reasoningSegment: text.slice(0, splitIndex),
      textSegment: text.slice(splitIndex),
    }
  }

  // Check for completed analysis channel format
  const analysisMatch = text.match(
    /<\|channel\|>analysis<\|message\|>([\s\S]*?)<\|start\|>assistant<\|channel\|>final<\|message\|>/
  )
  if (analysisMatch?.index !== undefined) {
    const splitIndex = analysisMatch.index + analysisMatch[0].length
    return {
      reasoningSegment: text.slice(0, splitIndex),
      textSegment: text.slice(splitIndex),
    }
  }

  return { reasoningSegment: undefined, textSegment: text }
}

/**
 * Convert Jan's ThreadMessage format to AI SDK UIMessage format.
 * This is used to load existing messages into the AI SDK chat.
 * Tool calls are now part of the content array and will be converted to tool parts.
 */
export function convertThreadMessageToUIMessage(
  threadMessage: ThreadMessage
): UIMessage {
  const parts: any[] = []

  // Process content array - preserve original order (including tool calls)
  for (const content of threadMessage.content || []) {
    if (content.type === 'reasoning' && content.text?.value) {
      // Reasoning content - direct conversion
      parts.push({
        type: 'reasoning',
        text: content.text.value,
      })
    } else if (content.type === 'text' && content.text?.value) {
      // Text content - check if it contains old-format reasoning in <think> tags
      const { reasoningSegment, textSegment } = parseReasoning(
        content.text.value
      )

      // BACKWARD COMPATIBILITY: Handle old format with <think> tags
      if (reasoningSegment) {
        // Extract reasoning text from <think> tags
        const completedMatch = reasoningSegment.match(
          /<think>([\s\S]*)<\/think>/
        )
        if (completedMatch) {
          parts.push({
            type: 'reasoning',
            text: completedMatch[1],
          })
        } else {
          // In-progress reasoning - extract content after <think> tag
          const inProgressMatch = reasoningSegment.match(/<think>([\s\S]*)/)
          if (inProgressMatch) {
            parts.push({
              type: 'reasoning',
              text: inProgressMatch[1],
            })
          }
        }
      }

      if (textSegment) {
        // Trim leading whitespace/newlines from the text segment
        const trimmedText = textSegment.trim()
        if (trimmedText) {
          parts.push({
            type: 'text',
            text: trimmedText,
          })
        }
      } else if (!reasoningSegment) {
        // No reasoning segment, just add the text as-is
        parts.push({
          type: 'text',
          text: content.text.value,
        })
      }
    } else if (content.type === 'image_url' && content.image_url?.url) {
      parts.push({
        type: 'file',
        mediaType: 'image/jpeg',
        url: content.image_url.url,
      })
    } else if (content.type === 'tool_call') {
      // Handle tool call content items - direct conversion from flat structure
      // Use AI SDK v5 UIToolInvocation format: toolCallId, state: 'output-available'/'input-available'
      if (content.output != null) {
        parts.push({
          type: `tool-${content.tool_name}`,
          toolCallId: content.tool_call_id,
          input: content.input,
          state: 'output-available',
          output: content.output,
        })
      } else {
        parts.push({
          type: `tool-${content.tool_name}`,
          toolCallId: content.tool_call_id,
          input: content.input,
          state: 'input-available',
        })
      }
    }
  }

  // BACKWARD COMPATIBILITY: Handle tool calls from metadata (old format)
  // New messages will have tool calls as separate messages with tool_call_id
  const toolCalls = (threadMessage.metadata as any)?.tool_calls
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      // Parse the result from the response.content array
      let result
      if (tc.response?.content) {
        // Extract content from the response
        if (tc.response.content.length === 1 && tc.response.content[0].type === 'text') {
          // Single text content - return as string
          result = tc.response.content[0].text
        } else {
          // Multiple content parts or non-text - return full content array
          result = tc.response.content
        }
      }

      const toolName = tc.tool?.function?.name || tc.name
      const toolInput =
        typeof tc.tool?.function?.arguments === 'string'
          ? JSON.parse(tc.tool.function.arguments)
          : tc.tool?.function?.arguments || tc.args
      const toolCallId = tc.tool?.id || tc.id

      // Use AI SDK v5 UIToolInvocation format
      if (result != null || tc.state === 'ready' || tc.state === 'completed' || tc.state === 'result') {
        parts.push({
          type: `tool-${toolName}`,
          toolCallId,
          input: toolInput,
          state: 'output-available',
          output: result,
        })
      } else {
        parts.push({
          type: `tool-${toolName}`,
          toolCallId,
          input: toolInput,
          state: 'input-available',
        })
      }
    }
  }

  // Ensure at least one text part exists
  if (parts.length === 0) {
    parts.push({
      type: 'text',
      text: '',
    })
  }

  return {
    id: threadMessage.id,
    role: threadMessage.role as 'user' | 'assistant' | 'system',
    parts,
    createdAt: new Date(threadMessage.created_at || Date.now()),
    metadata: threadMessage.metadata || {}
  } as UIMessage
}

/**
 * Convert an array of Jan's ThreadMessages to AI SDK UIMessage format.
 * Tool calls are now part of the content array, so no special merging is needed.
 */
export function convertThreadMessagesToUIMessages(
  threadMessages: ThreadMessage[]
): UIMessage[] {
  return threadMessages
    .map(convertThreadMessageToUIMessage)
    .filter((msg): msg is UIMessage => msg !== null)
}

/**
 * Extract content from UIMessage parts as separate ThreadContent items.
 * This preserves the structure of multiple text/reasoning/tool call parts instead of combining them.
 *
 * @param message - The UIMessage to extract content from
 * @returns Array of ThreadContent items (including tool calls)
 */
export function extractContentPartsFromUIMessage(message: UIMessage): ThreadContent[] {
  const content: ThreadContent[] = []
  const parts = (message.parts ?? []) as any[]

  for (const part of parts) {
    if (part.type === 'reasoning') {
      // Add reasoning content as separate item
      const reasoningText = part.reasoning ?? part.text ?? ''
      if (reasoningText) {
        const reasoningContent = {
          type: 'reasoning' as ContentType.Reasoning,
          text: {
            value: reasoningText,
            annotations: [],
          },
        }
        content.push(reasoningContent)
      }
    } else if (part.type === 'text') {
      // Add text content as separate item
      const textContent = part.text ?? ''
      if (textContent) {
        content.push({
          type: 'text' as ContentType.Text,
          text: {
            value: textContent,
            annotations: [],
          },
        })
      }
    } else if (part.type === 'file' && part.mediaType) {
      // Handle file parts (images)
      const mediaType = part.mediaType as string
      if (mediaType?.startsWith('image/')) {
        content.push({
          type: 'image_url' as ContentType.Image,
          image_url: {
            url: part.url,
            detail: 'auto',
          },
        })
      }
    } else if (part.type.startsWith('tool-')) {
      // Handle tool call parts - flatten structure to match parts format
      const toolName = (part.type as string).replace('tool-', '')
      const toolCallId = part.toolCallId || part.toolInvocationId
      const input = part.input || part.args
      const output = part.output || part.result

      const toolCallContent = {
        type: 'tool_call' as ContentType.ToolCall,
        tool_call_id: toolCallId,
        tool_name: toolName,
        input: input,
        output: output,
      }
      content.push(toolCallContent)
    }
  }

  // If no content was extracted, add empty text
  if (content.length === 0) {
    content.push({
      type: 'text' as ContentType.Text,
      text: {
        value: '',
        annotations: [],
      },
    })
  }

  return content
}
