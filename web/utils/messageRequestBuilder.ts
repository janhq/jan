import {
  ChatCompletionMessage,
  ChatCompletionMessageContent,
  ChatCompletionMessageContentText,
  ChatCompletionMessageContentType,
  ChatCompletionRole,
  MessageRequest,
  MessageRequestType,
  MessageTool,
  ModelInfo,
  Thread,
  ThreadMessage,
} from '@janhq/core'
import { ChatCompletionMessage as OAIChatCompletionMessage } from 'openai/resources/chat'
import { ulid } from 'ulidx'

import { Stack } from '@/utils/Stack'

import { FileInfo } from '@/types/file'

export class MessageRequestBuilder {
  msgId: string
  type: MessageRequestType
  messages: ChatCompletionMessage[]
  model: ModelInfo
  thread: Thread
  tools?: MessageTool[]

  constructor(
    type: MessageRequestType,
    model: ModelInfo,
    thread: Thread,
    messages: ThreadMessage[],
    tools?: MessageTool[]
  ) {
    this.msgId = ulid()
    this.type = type
    this.model = model
    this.thread = thread
    this.messages = messages
      .filter((e) => !e.metadata?.error)
      .map<ChatCompletionMessage>((msg) => ({
        role: msg.role,
        content: msg.content[0]?.text?.value ?? '.',
      }))
    this.tools = tools
  }

  pushAssistantMessage(message: OAIChatCompletionMessage) {
    const { content, refusal, ...rest } = message
    const normalizedMessage = {
      ...rest,
      ...(content ? { content } : {}),
      ...(refusal ? { refusal } : {}),
    }
    this.messages = [
      ...this.messages,
      normalizedMessage as ChatCompletionMessage,
    ]
  }

  pushToolMessage(message: string, toolCallId: string) {
    this.messages = [
      ...this.messages,
      {
        role: ChatCompletionRole.Tool,
        content: message,
        tool_call_id: toolCallId,
      },
    ]
  }
  // Chainable
  pushMessage(message: string, base64Blob?: string, fileInfo?: FileInfo) {
    if (base64Blob && fileInfo?.type === 'pdf')
      return this.addDocMessage(message, fileInfo?.name)
    else if (base64Blob && fileInfo?.type === 'image') {
      return this.addImageMessage(message, base64Blob)
    }
    this.messages = [
      ...this.messages,
      {
        role: ChatCompletionRole.User,
        content: message,
      },
    ]
    return this
  }

  // Chainable
  addSystemMessage(message: string | undefined) {
    if (!message || message.trim() === '') return this
    this.messages = [
      {
        role: ChatCompletionRole.System,
        content: message,
      },
      ...this.messages,
    ]
    return this
  }

  // Chainable
  addDocMessage(prompt: string, name?: string) {
    const message: ChatCompletionMessage = {
      role: ChatCompletionRole.User,
      content: [
        {
          type: ChatCompletionMessageContentType.Text,
          text: prompt,
        } as ChatCompletionMessageContentText,
        {
          type: ChatCompletionMessageContentType.Doc,
          doc_url: {
            url: name ?? `${this.msgId}.pdf`,
          },
        },
      ] as ChatCompletionMessageContent,
    }
    this.messages = [...this.messages, message]
    return this
  }

  // Chainable
  addImageMessage(prompt: string, base64: string) {
    const message: ChatCompletionMessage = {
      role: ChatCompletionRole.User,
      content: [
        {
          type: ChatCompletionMessageContentType.Text,
          text: prompt,
        } as ChatCompletionMessageContentText,
        {
          type: ChatCompletionMessageContentType.Image,
          image_url: {
            url: base64,
          },
        },
      ] as ChatCompletionMessageContent,
    }

    this.messages = [...this.messages, message]
    return this
  }

  removeLastAssistantMessage() {
    const lastMessageIndex = this.messages.length - 1
    if (
      this.messages.length &&
      this.messages[lastMessageIndex] &&
      this.messages[lastMessageIndex].role === ChatCompletionRole.Assistant
    ) {
      this.messages.pop()
    }

    return this
  }

  build(): MessageRequest {
    return {
      id: this.msgId,
      type: this.type,
      attachments: [],
      threadId: this.thread.id,
      messages: this.messages,
      model: this.model,
      thread: this.thread,
      tools: this.tools?.length ? this.tools : undefined,  // convert empty list to undefined
    }
  }
}
