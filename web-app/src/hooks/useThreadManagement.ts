import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { ulid } from 'ulidx'
import { localStorageKey } from '@/constants/localStorage'
import { useThreads } from '@/hooks/useThreads'

type ThreadFolder = {
  id: string
  name: string
  updated_at: number
  systemPrompt?: string
}

type ThreadManagementState = {
  folders: ThreadFolder[]
  setFolders: (folders: ThreadFolder[]) => void
  addFolder: (name: string, systemPrompt?: string) => ThreadFolder
  updateFolder: (id: string, name: string, systemPrompt?: string) => void
  deleteFolder: (id: string) => void
  getFolderById: (id: string) => ThreadFolder | undefined
}

export const useThreadManagement = create<ThreadManagementState>()(
  persist(
    (set, get) => ({
      folders: [],

      setFolders: (folders) => {
        set({ folders })
      },

      addFolder: (name, systemPrompt) => {
        const newFolder: ThreadFolder = {
          id: ulid(),
          name,
          updated_at: Date.now(),
          systemPrompt,
        }
        set((state) => ({
          folders: [...state.folders, newFolder],
        }))
        return newFolder
      },

      updateFolder: (id, name, systemPrompt) => {
        set((state) => ({
          folders: state.folders.map((folder) =>
            folder.id === id
              ? {
                  ...folder,
                  name,
                  updated_at: Date.now(),
                  systemPrompt
                }
              : folder
          ),
        }))
      },

      deleteFolder: (id) => {
        // Remove project metadata from all threads that belong to this project
        const threadsState = useThreads.getState()
        const threadsToUpdate = Object.values(threadsState.threads).filter(
          (thread) => thread.metadata?.project?.id === id
        )

        threadsToUpdate.forEach((thread) => {
          threadsState.updateThread(thread.id, {
            metadata: {
              ...thread.metadata,
              project: undefined,
            },
          })
        })

        set((state) => ({
          folders: state.folders.filter((folder) => folder.id !== id),
        }))
      },

      getFolderById: (id) => {
        return get().folders.find((folder) => folder.id === id)
      },
    }),
    {
      name: localStorageKey.threadManagement,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
