import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { localStorageKey } from '@/constants/localStorage'

export type WorkspaceDirectoryScopeType = 'workspace' | 'project' | 'chat'

export type WorkspaceDirectoryScope = {
  id: string
  type: WorkspaceDirectoryScopeType
  label: string
}

type WorkspaceDirectoryState = {
  directories: Record<string, string>
  setDirectory: (scope: WorkspaceDirectoryScope, path: string) => void
  clearDirectory: (scope: WorkspaceDirectoryScope) => void
  getDirectory: (scope: WorkspaceDirectoryScope) => string | undefined
}

export const getWorkspaceDirectoryKey = (scope: WorkspaceDirectoryScope) =>
  `${scope.type}:${scope.id}`

export const useWorkspaceDirectories = create<WorkspaceDirectoryState>()(
  persist(
    (set, get) => ({
      directories: {},

      setDirectory: (scope, path) => {
        const key = getWorkspaceDirectoryKey(scope)
        set((state) => ({
          directories: {
            ...state.directories,
            [key]: path,
          },
        }))
      },

      clearDirectory: (scope) => {
        const key = getWorkspaceDirectoryKey(scope)
        set((state) => {
          const directories = { ...state.directories }
          delete directories[key]
          return { directories }
        })
      },

      getDirectory: (scope) =>
        get().directories[getWorkspaceDirectoryKey(scope)],
    }),
    {
      name: localStorageKey.workspaceDirectories,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ directories: state.directories }),
    }
  )
)
