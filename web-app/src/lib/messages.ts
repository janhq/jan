/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChatCompletionMessageParam } from 'token.js'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import { ThreadMessage } from '@janhq/core'
import { removeReasoningContent } from '@/utils/reasoning'
// Attachments are now handled upstream in newUserThreadContent

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
        .map<ChatCompletionMessageParam>((msg) => this.toCompletionParamFromThread(msg))
    )
  }

  // Normalize a ThreadMessage into a ChatCompletionMessageParam for Token.js
  private toCompletionParamFromThread(msg: ThreadMessage): ChatCompletionMessageParam {
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
      const content = msg.content.map((part: any) => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text?.value ?? '' }
        }
        if (part.type === 'image_url') {
          return {
            type: 'image_url',
            image_url: { url: part.image_url?.url || '', detail: part.image_url?.detail || 'auto' },
          }
        }
        return part
      })
      return { role: 'user', content } as any
    }
    // Single text part
    const text = msg?.content?.[0]?.text?.value ?? '.'
    return { role: 'user', content: text }
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
   * @param content - The content of the tool message.
   * @param toolCallId - The ID of the tool call associated with the message.
   */
  addToolMessage(content: string, toolCallId: string) {
    this.messages.push({
      role: 'tool',
      content: content,
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
