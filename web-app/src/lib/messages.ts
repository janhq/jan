/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChatCompletionMessageParam } from 'token.js'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import { ThreadMessage } from '@janhq/core'

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
          if (msg.role === 'assistant') {
            return {
              role: msg.role,
              content: this.normalizeContent(
                msg.content[0]?.text?.value || '.'
              ),
            } as ChatCompletionMessageParam
          } else {
            // For user messages, handle multimodal content
            if (msg.content.length > 1) {
              // Multiple content parts (text + images + files)

              const content = msg.content.map((contentPart) => {
                if (contentPart.type === 'text') {
                  return {
                    type: 'text',
                    text: contentPart.text?.value || '',
                  }
                } else if (contentPart.type === 'image_url') {
                  return {
                    type: 'image_url',
                    image_url: {
                      url: contentPart.image_url?.url || '',
                      detail: contentPart.image_url?.detail || 'auto',
                    },
                  }
                } else {
                  return contentPart
                }
              })
              return {
                role: msg.role,
                content,
              } as ChatCompletionMessageParam
            } else {
              // Single text content
              return {
                role: msg.role,
                content: msg.content[0]?.text?.value || '.',
              } as ChatCompletionMessageParam
            }
          }
        })
    )
  }

  /**
   * Add a user message to the messages array.
   * @param content - The content of the user message.
   * @param attachments - Optional attachments for the message.
   */
  addUserMessage(
    content: string,
    attachments?: Array<{
      name: string
      type: string
      size: number
      base64: string
      dataUrl: string
    }>
  ) {
    // Ensure no consecutive user messages
    if (this.messages[this.messages.length - 1]?.role === 'user') {
      this.messages.pop()
    }

    // Handle multimodal content with attachments
    if (attachments && attachments.length > 0) {
      const messageContent: any[] = [
        {
          type: 'text',
          text: content,
        },
      ]

      // Add attachments (images and PDFs)
      attachments.forEach((attachment) => {
        if (attachment.type.startsWith('image/')) {
          messageContent.push({
            type: 'image_url',
            image_url: {
              url: `data:${attachment.type};base64,${attachment.base64}`,
              detail: 'auto',
            },
          })
        }
      })

      this.messages.push({
        role: 'user',
        content: messageContent,
      } as any)
    } else {
      // Text-only message
      this.messages.push({
        role: 'user',
        content: content,
      })
    }
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
      content: this.normalizeContent(content),
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
    return this.messages
  }

  /**
   * Normalize the content of a message by removing reasoning content.
   * This is useful to ensure that reasoning content does not get sent to the model.
   * @param content
   * @returns
   */
  private normalizeContent = (content: string): string => {
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
}
