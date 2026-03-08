import { create } from 'zustand'

import { Attachment } from '@/types/attachment'

export const NEW_THREAD_ATTACHMENT_KEY = '__new-thread__'

const EMPTY_ATTACHMENTS: Attachment[] = []

type AttachmentStore = {
  attachmentsByThread: Record<string, Attachment[]>
  getAttachments: (threadId?: string) => Attachment[]
  setAttachments: (
    threadId: string,
    updater: Attachment[] | ((prev: Attachment[]) => Attachment[])
  ) => void
  clearAttachments: (threadId: string) => void
  transferAttachments: (fromKey: string, toKey: string) => void
}

export const useChatAttachments = create<AttachmentStore>()((set, get) => ({
  attachmentsByThread: {},
  getAttachments: (threadId = NEW_THREAD_ATTACHMENT_KEY) => {
    return get().attachmentsByThread[threadId] ?? EMPTY_ATTACHMENTS
  },
  setAttachments: (threadId, updater) => {
    set((state) => {
      const current = state.attachmentsByThread[threadId] ?? []
      const next = typeof updater === 'function' ? updater(current) : updater
      return {
        attachmentsByThread: {
          ...state.attachmentsByThread,
          [threadId]: next,
        },
      }
    })
  },
  clearAttachments: (threadId) => {
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [threadId]: _, ...rest } = state.attachmentsByThread
      return { attachmentsByThread: rest }
    })
  },
  transferAttachments: (fromKey, toKey) => {
    set((state) => {
      const fromAttachments = state.attachmentsByThread[fromKey]
      if (!fromAttachments?.length) return state

      const existingDestination = state.attachmentsByThread[toKey]
      const attachmentsByThread = { ...state.attachmentsByThread }
      delete attachmentsByThread[fromKey]

      return {
        attachmentsByThread: {
          ...attachmentsByThread,
          [toKey]: existingDestination?.length
            ? existingDestination
            : fromAttachments,
        },
      }
    })
  },
}))
