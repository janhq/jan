/**
 * Default Threads Service - Web implementation
 */

import type { Thread as StoredThread } from '@janhq/core'
import { Emitter } from '@janhq/extension-api'
import type { ThreadsService } from './types'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

function toModelPayload(model?: Thread['model']) {
  return { id: model?.id ?? '*', engine: model?.provider ?? 'llamacpp' }
}

function fromModelResponse(
  assistantModel: { id: string; engine?: string } | undefined,
  fallback?: Thread['model']
): Thread['model'] | undefined {
  if (assistantModel) {
    return { id: assistantModel.id, provider: assistantModel.engine ?? 'llamacpp' }
  }
  return fallback
}

export class DefaultThreadsService implements ThreadsService {
  private readonly deleted = new Emitter<{ threadId: string }>()
  readonly onDidDeleteThread = this.deleted.event

  async fetchThreads(): Promise<Thread[]> {
    // Let listThreads failures propagate: a rejected invoke means "backend not
    // ready / errored", not "no threads", so the caller retries instead of
    // wiping the list with [].
    const threads: StoredThread[] | null | undefined =
      await window.core?.api?.listThreads()
    if (!Array.isArray(threads)) return []

    // new String("id") !== "id"
    threads.forEach((e) => {
      e.id = e.id?.toString()
      e.assistants?.forEach((a) => {
        a.id = a.id?.toString()
        if (a.model) a.model.id = a.model.id?.toString()
      })
    })

    // Filter out temporary threads from the list
    const filteredThreads = threads.filter((e) => e.id !== TEMPORARY_CHAT_ID)

    return filteredThreads.map((e) => {
      const model = fromModelResponse(e.assistants?.[0]?.model)
      const assistants = e.assistants

      return {
        ...e,
        updated:
          typeof e.updated === 'number' && e.updated > 1e12
            ? Math.floor(e.updated / 1000)
            : (e.updated ?? 0),
        order: e.metadata?.order,
        isFavorite: e.metadata?.is_favorite,
        model,
        assistants,
        metadata: {
          ...e.metadata,
          // Override extracted fields to avoid duplication
          order: e.metadata?.order,
          is_favorite: e.metadata?.is_favorite,
        },
      } as Thread
    })
  }

  async createThread(thread: Thread): Promise<Thread> {
    // Temporary threads are in-memory only and never reach the backend.
    if (thread.id === TEMPORARY_CHAT_ID) {
      return thread
    }

    // Build assistants payload - always include model info
    // If there's a real assistant (with instructions), include full assistant data
    // Otherwise, just include minimal model-only entry for storage
    const hasRealAssistant = thread.assistants && thread.assistants.length > 0
    const modelPayload = toModelPayload(thread.model)
    const assistantsPayload = hasRealAssistant
      ? [{ ...thread.assistants![0], model: modelPayload }]
      : [{ id: 'model-only', name: 'Model', model: modelPayload }]

    return (
      window.core?.api
        ?.createThread({
          thread: {
            ...thread,
            assistants: assistantsPayload,
            metadata: {
              ...thread.metadata,
              order: thread.order,
            },
          },
        })
        .then((e: StoredThread) => {
          const model = fromModelResponse(e.assistants?.[0]?.model, thread.model)

          const assistants = e.assistants

          return {
            ...e,
            updated: e.updated,
            model,
            order: e.metadata?.order ?? thread.order,
            assistants,
          } as Thread
        })
        .catch(() => thread) ?? thread
    )
  }

  async updateThread(thread: Thread): Promise<void> {
    // Temporary threads are in-memory only and never reach the backend.
    if (thread.id === TEMPORARY_CHAT_ID) {
      return
    }

    await window.core?.api?.modifyThread({
      thread: {
        ...thread,
        assistants: thread.assistants?.map((e) => ({
          ...e,
          model: toModelPayload(thread.model),
        })) ?? [
          { model: toModelPayload(thread.model), id: 'jan', name: 'Jan' },
        ],
        metadata: {
          ...thread.metadata,
          is_favorite: thread.isFavorite,
          order: thread.order,
        },
        object: 'thread',
        created: Date.now() / 1000,
        updated: Date.now() / 1000,
      },
    })
  }

  async deleteThread(threadId: string): Promise<void> {
    // Temporary threads are in-memory only and never reach the backend.
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    const api = window.core?.api
    if (!api) return
    await api.deleteThread({ threadId })
    this.deleted.fire({ threadId })
  }
}
