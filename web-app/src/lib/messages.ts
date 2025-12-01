/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChatCompletionMessageParam } from 'token.js'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import { ThreadMessage, ContentType } from '@janhq/core'
import { removeReasoningContent } from '@/utils/reasoning'
// Attachments are now handled upstream in newUserThreadContent

type ThreadContent = NonNullable<ThreadMessage['content']>[number]

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
