/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChatCompletionMessageParam } from 'token.js'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import { ThreadMessage, ContentType, MessageStatus } from '@janhq/core'
import { removeReasoningContent } from '@/utils/reasoning'
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
    } else if (part.type === 'tool-invocation') {
      // Tool calls are stored in metadata, not content
      // We'll handle this below
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
    .filter((part) => part.type === 'tool-invocation')
    .map((part) => {
      return {
        tool: {
          id: part.toolInvocationId,
          type: 'function' as const,
          function: {
            name: part.toolName,
            arguments:
              typeof part.args === 'string'
                ? part.args
                : JSON.stringify(part.args),
          },
        },
        state: part.state === 'result' ? 'completed' : 'pending',
        response: part.result,
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

// Helper function to convert the tool's output part into an API content part
const convertToolPartToApiContentPart = (part: ToolResult['content'][0]) => {
  if (part.text) {
    return { type: 'text', text: part.text }
  }

  // Handle base64 image data
  if (part.data) {
    // Assume default image type, though a proper tool should return the mime type
    const mimeType =
      part.type === 'image' ? 'image/png' : part.type || 'image/png'
    const dataUrl = `data:${mimeType};base64,${part.data}`

    return {
      type: 'image_url',
      image_url: {
        url: dataUrl,
        detail: 'auto',
      },
    }
  }

  // Handle pre-formatted image URL
  if (part.image_url) {
    return { type: 'image_url', image_url: part.image_url }
  }

  // Fallback to text stringification for structured but unhandled data
  return { type: 'text', text: JSON.stringify(part) }
}

/**
 * @fileoverview Helper functions for creating chat completion request.
 * These functions are used to create chat completion request objects
 */
export class CompletionMessagesBuilder {
  private messages: ChatCompletionMessageParam[] = []

  constructor(messages: ThreadMessage[], systemInstruction?: string) {
    if (systemInstruction) {
      this.messages.push({
        role: 'system',
        content: systemInstruction,
      })
    }
    this.messages.push(
      ...messages
        .filter((e) => !e.metadata?.error)
        .map<ChatCompletionMessageParam>((msg) => {
          const param = this.toCompletionParamFromThread(msg)
          // In constructor context, normalize empty user text to a placeholder
          if (
            param.role === 'user' &&
            typeof param.content === 'string' &&
            param.content === ''
          ) {
            return { ...param, content: '.' }
          }
          return param
        })
    )
  }

  // Normalize a ThreadMessage into a ChatCompletionMessageParam for Token.js
  private toCompletionParamFromThread(
    msg: ThreadMessage
  ): ChatCompletionMessageParam {
    const inlineFileContents = Array.isArray(
      (msg.metadata as any)?.inline_file_contents
    )
      ? ((msg.metadata as any)?.inline_file_contents as Array<{
          name?: string
          content?: string
        }>).filter((f) => f?.content)
      : []

    const buildInlineText = (base: string) => {
      if (!inlineFileContents.length) return base
      const formatted = inlineFileContents
        .map((f) => `File: ${f.name || 'attachment'}\n${f.content ?? ''}`)
        .join('\n\n')
      return base ? `${base}\n\n${formatted}` : formatted
    }

    if (msg.role === 'assistant') {
      return {
        role: 'assistant',
        content: removeReasoningContent(msg.content?.[0]?.text?.value || '.'),
      } as ChatCompletionMessageParam
    }

    // System messages are uncommon here; normalize to plain text
    if (msg.role === 'system') {
      return {
        role: 'system',
        content: msg.content?.[0]?.text?.value || '.',
      } as ChatCompletionMessageParam
    }

    // User messages: handle multimodal content
    if (Array.isArray(msg.content) && msg.content.length > 1) {
      const content = msg.content.map((part: ThreadContent) => {
        if (part.type === ContentType.Text) {
          return {
            type: 'text' as const,
            text: buildInlineText(part.text?.value ?? ''),
          }
        }
        if (part.type === ContentType.Image) {
          return {
            type: 'image_url' as const,
            image_url: {
              url: part.image_url?.url || '',
              detail: part.image_url?.detail || 'auto',
            },
          }
        }
        // Fallback for unknown content types
        return { type: 'text' as const, text: '' }
      })
      return { role: 'user', content } as ChatCompletionMessageParam
    }
    // Single text part
    const text = msg?.content?.[0]?.text?.value ?? '.'
    return { role: 'user', content: buildInlineText(text) }
  }

  /**
   * Add a user message to the messages array from a parsed ThreadMessage.
   * Upstream code should construct the message via newUserThreadContent
   * and pass it here to avoid duplicated logic.
   */
  addUserMessage(message: ThreadMessage) {
    if (message.role !== 'user') {
      throw new Error('addUserMessage expects a user ThreadMessage')
    }
    // Ensure no consecutive user messages
    if (this.messages[this.messages.length - 1]?.role === 'user') {
      this.messages.pop()
    }
    this.messages.push(this.toCompletionParamFromThread(message))
  }

  /**
   * Add an assistant message to the messages array.
   * @param content - The content of the assistant message.
   * @param refusal - Optional refusal message.
   * @param calls - Optional tool calls associated with the message.
   */
  addAssistantMessage(
    content: string,
    refusal?: string,
    calls?: ChatCompletionMessageToolCall[]
  ) {
    this.messages.push({
      role: 'assistant',
      content: removeReasoningContent(content),
      refusal: refusal,
      tool_calls: calls,
    })
  }

  /**
   * Add a tool message to the messages array.
   * @param content - The content of the tool message (string or ToolResult object).
   * @param toolCallId - The ID of the tool call associated with the message.
   */
  addToolMessage(result: string | ToolResult, toolCallId: string) {
    let content: string | any[] = ''

    // Handle simple string case
    if (typeof result === 'string') {
      content = result
    } else {
      // Check for multimodal content (more than just a simple text string)
      const hasMultimodalContent = result.content?.some(
        (p) => p.data || p.image_url
      )

      if (hasMultimodalContent) {
        // Build the structured content array
        content = result.content.map(convertToolPartToApiContentPart)
      } else if (result.content?.[0]?.text) {
        // Standard text case
        content = result.content[0].text
      } else if (result.error) {
        // Error case
        content = `Tool execution failed: ${result.error}`
      } else {
        // Fallback: serialize the whole result structure if content is unexpected
        try {
          content = JSON.stringify(result)
        } catch {
          content = 'Tool call completed, unexpected output format.'
        }
      }
    }
    this.messages.push({
      role: 'tool',
      // for role 'tool',  need to use 'as ChatCompletionMessageParam'
      content: content as any,
      tool_call_id: toolCallId,
    })
  }

  /**
   * Return the messages array.
   * @returns The array of chat completion messages.
   */
  getMessages(): ChatCompletionMessageParam[] {
    const result: ChatCompletionMessageParam[] = []
    let prevRole: string | undefined

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i]

      // Handle first message
      if (i === 0) {
        if (msg.role === 'user') {
          result.push(msg)
          prevRole = msg.role
          continue
        } else if (msg.role === 'system') {
          result.push(msg)
          prevRole = msg.role
          // Check next message
          const nextMsg = this.messages[i + 1]
          if (!nextMsg || nextMsg.role !== 'user') {
            result.push({ role: 'user', content: '.' })
            prevRole = 'user'
          }
          continue
        } else {
          // First message is not user or system — insert user message
          result.push({ role: 'user', content: '.' })
          result.push(msg)
          prevRole = msg.role
          continue
        }
      }

      // Avoid consecutive same roles
      if (msg.role === prevRole) {
        const oppositeRole = prevRole === 'assistant' ? 'user' : 'assistant'
        result.push({ role: oppositeRole, content: '.' })
        prevRole = oppositeRole
      }
      result.push(msg)
      prevRole = msg.role
    }

    return result
  }
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
 */
export function convertThreadMessageToUIMessage(
  threadMessage: ThreadMessage
): UIMessage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = []

  // Process content array
  for (const content of threadMessage.content || []) {
    if (content.type === ContentType.Text && content.text?.value) {
      // Check for reasoning content wrapped in <think> tags
      const { reasoningSegment, textSegment } = parseReasoning(
        content.text.value
      )

      if (reasoningSegment) {
        // Extract reasoning text from <think> tags
        // Handle both completed (<think>...</think>) and in-progress (<think>...) formats
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
      }
    } else if (content.type === ContentType.Image && content.image_url?.url) {
      parts.push({
        type: 'file',
        mediaType: 'image/jpeg',
        url: content.image_url.url,
      })
    }
  }

  // Handle tool calls from metadata
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolCalls = (threadMessage.metadata as any)?.tool_calls
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      parts.push({
        type: 'tool-invocation',
        toolInvocationId: tc.tool?.id || tc.id,
        toolName: tc.tool?.function?.name || tc.name,
        args:
          typeof tc.tool?.function?.arguments === 'string'
            ? JSON.parse(tc.tool.function.arguments)
            : tc.tool?.function?.arguments || tc.args,
        state: tc.state === 'completed' ? 'result' : 'call',
        result: tc.response,
      })
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
  } as UIMessage
}

/**
 * Convert an array of Jan's ThreadMessages to AI SDK UIMessage format.
 */
export function convertThreadMessagesToUIMessages(
  threadMessages: ThreadMessage[]
): UIMessage[] {
  return threadMessages.map(convertThreadMessageToUIMessage)
}
