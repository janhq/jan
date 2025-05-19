import { ChatCompletionMessageParam } from 'token.js'
import { ChatCompletionMessageToolCall } from 'openai/resources'

/**
 * @fileoverview Helper functions for creating chat completion request.
 * These functions are used to create chat completion request objects
 */
export class CompletionMessagesBuilder {
  private messages: ChatCompletionMessageParam[] = []

  constructor() {}

  /**
   * Add a system message to the messages array.
   * @param content - The content of the system message.
   */
  addSystemMessage(content: string) {
    this.messages.push({
      role: 'system',
      content: content,
    })
  }

  /**
   * Add a user message to the messages array.
   * @param content - The content of the user message.
   */
  addUserMessage(content: string) {
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
      content: content,
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
}
