/**
 * Default Threads Service - Web implementation
 */

import { ExtensionManager } from '@/lib/extension'
import { ConversationalExtension, ExtensionTypeEnum } from '@janhq/core'
import type { ThreadsService } from './types'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { getServiceHub } from '@/hooks/useServiceHub'
import { resolveConversationCapabilities, type ConversationCapabilitiesV1 } from '@/lib/conversationCapabilities'

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

// Raw successful native creation responses, keyed by the exact returned UI
// object. Never reconstruct a deletion receipt from a later UI snapshot.
const creationReceipts = new WeakMap<Thread, unknown>()

export class DefaultThreadsService implements ThreadsService {
  async setConversationCapabilities(threadId: string, value: ConversationCapabilitiesV1): Promise<void> {
    // Temporary conversations cannot own persistent capability consent.
    if (threadId === TEMPORARY_CHAT_ID) throw new Error('Conversation permissions require a regular chat')
    const capabilities = resolveConversationCapabilities(value)
    await getServiceHub().core().invoke('set_thread_conversation_capabilities', {
      threadId,
      value: capabilities,
    })
  }

  async fetchThreads(): Promise<Thread[]> {
    const ext = ExtensionManager.getInstance().get<ConversationalExtension>(
      ExtensionTypeEnum.Conversational
    )
    // The extension may not be registered yet during a startup race (e.g. a
    // reload while the llamacpp router is busy). Throw so the caller can retry
    // instead of treating "not ready" as "no threads" and wiping the list.
    if (!ext) {
      throw new Error('Conversational extension not available yet')
    }

    // Let listThreads failures propagate: a rejected invoke means "backend not
    // ready / errored", not "no threads" — the caller retries instead of
    // wiping the list with [].
    const threads = await ext.listThreads()
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

  async createThread(thread: Thread, options?: { strict?: boolean }): Promise<Thread> {
    // For temporary threads, bypass the conversational extension (in-memory only)
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

    const extension = ExtensionManager.getInstance().get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
    if (options?.strict && !extension) throw new Error('Chat persistence unavailable')
    return (
      extension?.createThread({
          ...thread,
          assistants: assistantsPayload,
          metadata: {
            ...thread.metadata,
            order: thread.order,
          },
        })
        .then((e) => {
          if (options?.strict && (!e?.id || e.id !== thread.id)) throw new Error('Invalid persisted chat response')
          const model = fromModelResponse(e.assistants?.[0]?.model, thread.model)

          const assistants = e.assistants

          const created = {
            ...e,
            updated: e.updated,
            model,
            order: e.metadata?.order ?? thread.order,
            assistants,
          } as Thread
          creationReceipts.set(created, JSON.parse(JSON.stringify(e)))
          return created
        })
        .catch((error) => { if (options?.strict) throw error; return thread }) ?? thread
    )
  }

  async updateThread(thread: Thread): Promise<void> {
    // For temporary threads, skip updating via conversational extension
    if (thread.id === TEMPORARY_CHAT_ID) {
      return
    }

    await ExtensionManager.getInstance()
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.modifyThread({
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
      })
  }

  releaseCreatedThread(receipt: Thread): void {
    creationReceipts.delete(receipt)
  }

  async rollbackCreatedThread(threadId: string, receipt: Thread): Promise<void> {
    if (!threadId || threadId === TEMPORARY_CHAT_ID) {
      throw new Error('Rollback requires a persisted chat id')
    }
    const expected = creationReceipts.get(receipt)
    if (!expected || receipt.id !== threadId) throw new Error('Missing native creation receipt; chat retained')
    // Compare and delete under the native writer lock; external changes refuse.
    await getServiceHub().core().invoke('rollback_created_thread', { threadId, expected })
    creationReceipts.delete(receipt)
  }

  async deleteThread(threadId: string): Promise<void> {
    // For temporary threads, skip deleting via conversational extension
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    await ExtensionManager.getInstance()
      .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
      ?.deleteThread(threadId)
  }
}
