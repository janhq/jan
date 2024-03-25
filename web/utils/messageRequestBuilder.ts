import {
  ChatCompletionMessage,
  ChatCompletionMessageContent,
  ChatCompletionMessageContentText,
  ChatCompletionMessageContentType,
  ChatCompletionRole,
  MessageRequest,
  MessageRequestType,
  MessageStatus,
  ModelInfo,
  Thread,
  ThreadMessage,
} from '@janhq/core'
import { ulid } from 'ulidx'

import { FileType } from '@/containers/Providers/Jotai'

export class MessageRequestBuilder {
  msgId: string
  type: MessageRequestType
  messages: ChatCompletionMessage[]
  model: ModelInfo
  thread: Thread

  constructor(
    type: MessageRequestType,
    model: ModelInfo,
    thread: Thread,
    messages: ThreadMessage[]
  ) {
    this.msgId = ulid()
    this.type = type
    this.model = model
    this.thread = thread
    this.messages = messages
      .filter((e) => e.status !== MessageStatus.Error)
      .map<ChatCompletionMessage>((msg) => ({
        role: msg.role,
        content: msg.content[0]?.text.value ?? '',
      }))
  }

  // Chainable
  pushMessage(
    message: string,
    base64Blob: string | undefined,
    fileContentType: FileType
  ) {
    if (base64Blob && fileContentType === 'pdf')
      return this.addDocMessage(message)
    else if (base64Blob && fileContentType === 'image') {
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
  addDocMessage(prompt: string) {
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
            url: `threads/${this.thread.id}/files/${this.msgId}.pdf`,
          },
        },
      ] as ChatCompletionMessageContent,
    }
    this.messages = [message, ...this.messages]
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

    this.messages = [message, ...this.messages]
    return this
  }

  build(): MessageRequest {
    return {
      id: this.msgId,
      type: this.type,
      threadId: this.thread.id,
      messages: this.messages,
      model: this.model,
      thread: this.thread,
    }
  }
}
