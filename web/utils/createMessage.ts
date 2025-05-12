import {
  ChatCompletionRole,
  ContentType,
  MessageStatus,
  ThreadContent,
  ThreadMessage,
} from '@janhq/core'
import { ulid } from 'ulidx'

export const emptyMessageContent: ThreadContent[] = [
  {
    type: ContentType.Text,
    text: {
      value: '',
      annotations: [],
    },
  },
]

export const createMessageContent = (text: string): ThreadContent[] => {
  return [
    {
      type: ContentType.Text,
      text: {
        value: text,
        annotations: [],
      },
    },
  ]
}

export const createMessage = (opts: Partial<ThreadMessage>): ThreadMessage => {
  return {
    id: opts.id ?? ulid(),
    object: 'message',
    thread_id: opts.thread_id ?? '',
    assistant_id: opts.assistant_id ?? '',
    role: opts.role ?? ChatCompletionRole.Assistant,
    content: opts.content ?? [],
    metadata: opts.metadata ?? {},
    status: opts.status ?? MessageStatus.Pending,
    created_at: opts.created_at ?? Date.now() / 1000,
    completed_at: opts.completed_at ?? Date.now() / 1000,
  }
}
