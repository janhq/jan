import { ChatCompletionMessageParam } from 'token.js'
import { ChatCompletionMessageToolCall } from 'openai/resources'

export class CompletionMessagesBuilder {
  private messages: ChatCompletionMessageParam[] = []

  constructor() {}

  addUserMessage(content: string) {
    this.messages.push({
      role: 'user',
      content: content,
    })
  }

  addAssistantMessage(content: string, refusal?: string, calls?: ChatCompletionMessageToolCall[]) {
    this.messages.push({
      role: 'assistant',
      content: content,
      refusal: refusal,
      tool_calls: calls
    })
  }

  addToolMessage(content: string, toolCallId: string) {
    this.messages.push({
      role: 'tool',
      content: content,
      tool_call_id: toolCallId,
    })
  }

  getMessages(): ChatCompletionMessageParam[] {
    return this.messages
  }
}
