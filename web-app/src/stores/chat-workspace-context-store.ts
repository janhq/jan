import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { localStorageKey } from '@/constants/localStorage'

export type ChatWorkLocationMode = 'local' | 'worktree'

export type ThreadWorkspaceContext = {
  workMode: ChatWorkLocationMode
  /** Branch name when workMode is local */
  selectedBranch?: string
  /** Worktree path when workMode is worktree */
  selectedWorktreePath?: string
  /** Project picked on compose screens before a thread exists */
  draftProjectId?: string | null
}

type ChatWorkspaceContextState = {
  byThread: Record<string, ThreadWorkspaceContext>
  getContext: (threadId: string) => ThreadWorkspaceContext
  setWorkMode: (threadId: string, workMode: ChatWorkLocationMode) => void
  setSelectedBranch: (threadId: string, branch: string) => void
  setSelectedWorktreePath: (threadId: string, path: string) => void
  setDraftProject: (contextId: string, projectId: string | null) => void
  transferContext: (fromId: string, toId: string) => void
  clearContext: (threadId: string) => void
}

const defaultContext = (): ThreadWorkspaceContext => ({
  workMode: 'local',
})

export const useChatWorkspaceContext = create<ChatWorkspaceContextState>()(
  persist(
    (set, get) => ({
      byThread: {},

      getContext: (threadId) => get().byThread[threadId] ?? defaultContext(),

      setWorkMode: (threadId, workMode) =>
        set((state) => ({
          byThread: {
            ...state.byThread,
            [threadId]: {
              ...(state.byThread[threadId] ?? defaultContext()),
              workMode,
            },
          },
        })),

      setSelectedBranch: (threadId, branch) =>
        set((state) => ({
          byThread: {
            ...state.byThread,
            [threadId]: {
              ...(state.byThread[threadId] ?? defaultContext()),
              workMode: 'local',
              selectedBranch: branch,
            },
          },
        })),

      setSelectedWorktreePath: (threadId, path) =>
        set((state) => ({
          byThread: {
            ...state.byThread,
            [threadId]: {
              ...(state.byThread[threadId] ?? defaultContext()),
              workMode: 'worktree',
              selectedWorktreePath: path,
            },
          },
        })),

      setDraftProject: (contextId, projectId) =>
        set((state) => ({
          byThread: {
            ...state.byThread,
            [contextId]: {
              ...(state.byThread[contextId] ?? defaultContext()),
              draftProjectId: projectId,
            },
          },
        })),

      transferContext: (fromId, toId) =>
        set((state) => {
          const source = state.byThread[fromId]
          if (!source) return state
          const byThread = { ...state.byThread, [toId]: { ...source } }
          delete byThread[fromId]
          return { byThread }
        }),

      clearContext: (threadId) =>
        set((state) => {
          const byThread = { ...state.byThread }
          delete byThread[threadId]
          return { byThread }
        }),
    }),
    {
      name: localStorageKey.chatWorkspaceContext,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ byThread: state.byThread }),
    }
  )
)