import {
  Attachment,
  ChatCompletionRole,
  ContentType,
  MessageStatus,
  ThreadContent,
  ThreadMessage,
} from '@janhq/core'

import { MessageRequestBuilder } from './messageRequestBuilder'

import { FileInfo } from '@/types/file'

export class ThreadMessageBuilder {
  messageRequest: MessageRequestBuilder

  content: ThreadContent[] = []
  attachments: Attachment[] = []

  constructor(messageRequest: MessageRequestBuilder) {
    this.messageRequest = messageRequest
  }

  build(): ThreadMessage {
    const timestamp = Date.now() / 1000
    return {
      id: this.messageRequest.msgId,
      thread_id: this.messageRequest.thread.id,
      attachments: this.attachments,
      role: ChatCompletionRole.User,
      status: MessageStatus.Ready,
      created_at: timestamp,
      completed_at: timestamp,
      object: 'thread.message',
      content: this.content,
    }
  }

  pushMessage(
    prompt: string,
    base64: string | undefined,
    fileUpload?: FileInfo
  ) {
    if (prompt) {
      this.content.push({
        type: ContentType.Text,
        text: {
          value: prompt,
          annotations: [],
        },
      })
    }
    if (base64 && fileUpload?.type === 'image') {
      this.content.push({
        type: ContentType.Image,
        image_url: {
          url: base64,
        },
      })
    }

    if (base64 && fileUpload?.type === 'pdf') {
      this.attachments.push({
        file_id: fileUpload.id,
        tools: [
          {
            type: 'file_search',
          },
        ],
      })
    }

    return this
  }
}
