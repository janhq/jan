import {
  ExtensionError,
  type ConversationsApi,
  type MessageInfo,
  type ThreadInfo,
} from '@janhq/extension-api'
import {
  ContentType,
  MessageStatus,
  type ChatCompletionRole,
  type ThreadMessage,
} from '@janhq/core'
import { ulid } from 'ulidx'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import type { ServiceHub } from '@/services'

type ConversationServices = Pick<ServiceHub, 'threads' | 'messages'>

// Stored timestamps mix seconds and milliseconds (older threads and messages
// were written in ms); the public DTOs are always epoch milliseconds.
const toMillis = (t: number | undefined): number => {
  if (typeof t !== 'number' || !Number.isFinite(t)) return 0
  return t > 1e12 ? Math.floor(t) : Math.floor(t * 1000)
}

// The threads service hands back the stored record spread into the app's
// Thread, so `created` is present at runtime but not in the app type.
const toThreadInfo = (thread: Thread & { created?: number }): ThreadInfo => ({
  id: thread.id,
  title: thread.title,
  updatedAt: toMillis(thread.updated),
  createdAt: toMillis(thread.created ?? thread.updated),
})

const toMessageInfo = (message: ThreadMessage): MessageInfo => ({
  id: message.id,
  threadId: message.thread_id,
  role: message.role,
  text: (message.content ?? [])
    .filter((part) => part.type === ContentType.Text)
    .map((part) => part.text?.value ?? '')
    .join(''),
  createdAt: toMillis(message.created_at),
})

const notFound = (threadId: string) =>
  new ExtensionError('E_NOT_FOUND', `Thread '${threadId}' does not exist`)

/**
 * The backend of `ctx.conversations`: the app's threads and messages
 * services mapped to the public DTOs. The context checks the
 * `conversations:*` grants before any call reaches this object. The
 * temporary chat is in-memory UI state and is never exposed.
 */
export function createConversationsApi(
  hub: () => ConversationServices
): ConversationsApi {
  const findThread = async (id: string) => {
    if (id === TEMPORARY_CHAT_ID) return undefined
    const threads = await hub().threads().fetchThreads()
    return threads.find((t) => t.id === id)
  }

  return {
    listThreads: async () =>
      (await hub().threads().fetchThreads()).map((thread) => {
        const { id, title, updatedAt } = toThreadInfo(thread)
        return { id, title, updatedAt }
      }),

    getThread: async (id) => {
      const thread = await findThread(id)
      return thread && toThreadInfo(thread)
    },

    listMessages: async (threadId, opts = {}) => {
      const { limit, before } = opts
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw new ExtensionError(
          'E_INVALID_ARGS',
          'limit must be a positive integer'
        )
      }
      if (threadId === TEMPORARY_CHAT_ID) return []
      let messages = await hub().messages().fetchMessages(threadId)
      if (before !== undefined) {
        const index = messages.findIndex((m) => m.id === before)
        if (index < 0) {
          throw new ExtensionError(
            'E_NOT_FOUND',
            `Message '${before}' does not exist`
          )
        }
        messages = messages.slice(0, index)
      }
      // A page is the newest `limit` messages, still oldest first.
      if (limit !== undefined) messages = messages.slice(-limit)
      return messages.map(toMessageInfo)
    },

    createThread: async ({ title }) => {
      const created = await hub()
        .threads()
        .createThread({
          id: ulid(),
          title,
          updated: Date.now() / 1000,
          assistants: [],
        })
      return toThreadInfo(created)
    },

    appendMessage: async (threadId, { role, text }) => {
      if (!(await findThread(threadId))) throw notFound(threadId)
      const now = Date.now()
      const message: ThreadMessage = {
        id: ulid(),
        object: 'thread.message',
        thread_id: threadId,
        role: role as ChatCompletionRole,
        content: [
          { type: ContentType.Text, text: { value: text, annotations: [] } },
        ],
        status: MessageStatus.Ready,
        created_at: now,
        completed_at: now,
      }
      return toMessageInfo(await hub().messages().createMessage(message))
    },

    onDidCreateMessage: (listener) =>
      hub()
        .messages()
        .onDidCreateMessage((message) =>
          listener({
            threadId: message.thread_id,
            message: toMessageInfo(message),
          })
        ),

    onDidDeleteThread: (listener) =>
      hub().threads().onDidDeleteThread(listener),
  }
}
