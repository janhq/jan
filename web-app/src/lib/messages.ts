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
        .map<ChatCompletionMessageParam>(
          (msg) =>
            ({
              role: msg.role,
              content:
                msg.role === 'assistant'
                  ? this.normalizeContent(msg.content[0]?.text?.value || '.')
                  : msg.content[0]?.text?.value || '.',
            }) as ChatCompletionMessageParam
        )
    )
  }

  /**
   * Add a user message to the messages array.
   * @param content - The content of the user message.
   */
  addUserMessage(content: string) {
    // Ensure no consecutive user messages
    if (this.messages[this.messages.length - 1]?.role === 'user') {
      this.messages.pop()
    }
    this.messages.push({
      role: 'user',
      content: content,
    })
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
