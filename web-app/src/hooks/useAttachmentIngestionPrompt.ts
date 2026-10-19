import { Attachment } from '@/types/attachment'
import { create } from 'zustand'

type AttachmentSummary = Pick<Attachment, 'name' | 'size'>
type PendingPrompt = {
  currentAttachment: AttachmentSummary
  currentIndex: number
  totalCount: number
  resolver: (choice: 'inline' | 'embeddings' | undefined) => void
}

type AttachmentIngestionState = {
  isModalOpen: boolean
  currentAttachment: AttachmentSummary | null
  currentIndex: number
  totalCount: number
  resolver: ((choice: 'inline' | 'embeddings' | undefined) => void) | null
  queue: PendingPrompt[]
  showPrompt: (
    attachment: AttachmentSummary,
    currentIndex: number,
    totalCount: number
  ) => Promise<'inline' | 'embeddings' | undefined>
  choose: (choice: 'inline' | 'embeddings') => void
  cancel: () => void
}

export const useAttachmentIngestionPrompt = create<AttachmentIngestionState>()(
  (set, get) => {
    const settle = (choice: 'inline' | 'embeddings' | undefined) => {
      const { resolver, queue } = get()
      const [next, ...rest] = queue
      // Publish the next request before waking the previous caller, which may
      // immediately enqueue another document from its batch.
      set(next
        ? { ...next, isModalOpen: true, queue: rest }
        : { isModalOpen: false, currentAttachment: null, currentIndex: 0, totalCount: 0, resolver: null, queue: [] })
      resolver?.(choice)
    }
    return {
      isModalOpen: false,
      currentAttachment: null,
      currentIndex: 0,
      totalCount: 0,
      resolver: null,
      queue: [],
      showPrompt: async (attachment, currentIndex, totalCount) => {
        return new Promise<'inline' | 'embeddings' | undefined>((resolve) => {
          const request = {
            currentAttachment: attachment,
            currentIndex,
            totalCount,
            resolver: resolve,
          }
          if (get().resolver) set((state) => ({ queue: [...state.queue, request] }))
          else set({ ...request, isModalOpen: true })
        })
      },
      choose: (choice) => {
        settle(choice)
      },
      cancel: () => {
        settle(undefined)
      },
    }
  }
)
