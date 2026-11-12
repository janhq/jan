/**
 * Default Messages Service - Web implementation
 */

import type { ThreadMessage } from '@janhq/core'
import { Emitter } from '@janhq/extension-api'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import type { MessagesService } from './types'

export class DefaultMessagesService implements MessagesService {
  private readonly created = new Emitter<ThreadMessage>()
  readonly onDidCreateMessage = this.created.event

  async fetchMessages(threadId: string): Promise<ThreadMessage[]> {
    // Don't fetch messages from server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return []
    }

    const messages: Promise<ThreadMessage[] | null> | undefined =
      window.core?.api?.listMessages({ threadId })
    return messages?.then((list) => list ?? []).catch(() => []) ?? []
  }

  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
    // Don't create messages on server for temporary chat - it's local only
    if (message.thread_id === TEMPORARY_CHAT_ID) {
      return message
    }

    // The web build's routes resolve null: nothing was persisted.
    const created: Promise<ThreadMessage | null> | undefined =
      window.core?.api?.createMessage({ message })
    return (
      created
        ?.then((persisted) => {
          // Never acknowledge a write that nothing persisted.
          if (!persisted) throw new Error('Message storage is unavailable')
          this.created.fire(persisted)
          return persisted
        }) ?? Promise.reject(new Error('Message storage is unavailable'))
    )
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    // Don't modify messages on server for temporary chat - it's local only
    if (message.thread_id === TEMPORARY_CHAT_ID) {
      return message
    }

    const modified: Promise<ThreadMessage | null> | undefined =
      window.core?.api?.modifyMessage({ message })
    return (
      modified?.then((persisted) => {
        if (!persisted) throw new Error('Message storage is unavailable')
        return persisted
      }) ?? Promise.reject(new Error('Message storage is unavailable'))
    )
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    // Don't delete messages on server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    await window.core?.api?.deleteMessage({ threadId, messageId })
  }
}
