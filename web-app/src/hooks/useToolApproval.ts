import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type ToolApprovalModalProps = {
  toolName: string
  threadId: string
  toolParameters?: object
  onApprove: (allowOnce: boolean) => void
  onDeny: () => void
}

export type PendingApproval = {
  toolCallId: string
  toolName: string
  threadId: string
  resolve: (approved: boolean) => void
}

export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny'

type ToolApprovalState = {
  approvedTools: Record<string, string[]>
  allowAllMCPPermissions: boolean
  isModalOpen: boolean
  modalProps: ToolApprovalModalProps | null
  pending: Record<string, PendingApproval>

  approveToolForThread: (threadId: string, toolName: string) => void
  isToolApproved: (threadId: string, toolName: string) => boolean
  showApprovalModal: (toolName: string, threadId: string, toolParameters?: object) => Promise<boolean>
  requestApproval: (toolCallId: string, toolName: string, threadId: string) => Promise<boolean>
  resolveApproval: (toolCallId: string, decision: ApprovalDecision) => void
  isApprovalPending: (toolCallId: string) => boolean
  closeModal: () => void
  setModalOpen: (open: boolean) => void
  setAllowAllMCPPermissions: (allow: boolean) => void
}

export const useToolApproval = create<ToolApprovalState>()(
  persist(
    (set, get) => ({
      approvedTools: {},
      allowAllMCPPermissions: false,
      isModalOpen: false,
      modalProps: null,
      pending: {},

      approveToolForThread: (threadId: string, toolName: string) => {
        set((state) => ({
          approvedTools: {
            ...state.approvedTools,
            [threadId]: [
              ...(state.approvedTools[threadId] || []),
              toolName,
            ].filter((tool, index, arr) => arr.indexOf(tool) === index), // Remove duplicates
          },
        }))
      },

      isToolApproved: (threadId: string, toolName: string) => {
        const state = get()
        return state.approvedTools[threadId]?.includes(toolName) || false
      },

      showApprovalModal: (toolName: string, threadId: string, toolParameters?: object) => {
        return new Promise<boolean>((resolve) => {
          const state = get()

          // Auto-approve if the user has enabled auto-approval setting
          if (state.allowAllMCPPermissions) {
            resolve(true)
            return
          }

          // Check if tool is already approved for this thread
          if (state.isToolApproved(threadId, toolName)) {
            resolve(true)
            return
          }

          set({
            isModalOpen: true,
            modalProps: {
              toolName,
              threadId,
              toolParameters,
              onApprove: (allowOnce: boolean) => {
                if (!allowOnce) {
                  // If not "allow once", add to approved tools for this thread
                  get().approveToolForThread(threadId, toolName)
                }
                get().closeModal()
                resolve(true)
              },
              onDeny: () => {
                get().closeModal()
                resolve(false)
              },
            },
          })
        })
      },

      requestApproval: (toolCallId, toolName, threadId) => {
        return new Promise<boolean>((resolve) => {
          const state = get()
          if (state.allowAllMCPPermissions) {
            resolve(true)
            return
          }
          if (state.isToolApproved(threadId, toolName)) {
            resolve(true)
            return
          }
          set((s) => ({
            pending: {
              ...s.pending,
              [toolCallId]: { toolCallId, toolName, threadId, resolve },
            },
          }))
        })
      },

      resolveApproval: (toolCallId, decision) => {
        const entry = get().pending[toolCallId]
        if (!entry) return
        if (decision === 'allow-always') {
          get().approveToolForThread(entry.threadId, entry.toolName)
        }
        set((s) => {
          const next = { ...s.pending }
          delete next[toolCallId]
          return { pending: next }
        })
        entry.resolve(decision !== 'deny')
      },

      isApprovalPending: (toolCallId) => {
        return Boolean(get().pending[toolCallId])
      },

      closeModal: () => {
        set({
          isModalOpen: false,
          modalProps: null,
        })
      },

      setModalOpen: (open: boolean) => {
        set({ isModalOpen: open })
        if (!open) {
          get().closeModal()
        }
      },

      setAllowAllMCPPermissions: (allow: boolean) => {
        set({ allowAllMCPPermissions: allow })
      },
    }),
    {
      name: localStorageKey.toolApproval,
      storage: createJSONStorage(() => localStorage),
      // Only persist approved tools and global permission setting, not modal state
      partialize: (state) => ({
        approvedTools: state.approvedTools,
        allowAllMCPPermissions: state.allowAllMCPPermissions,
      }),
    }
  )
)
