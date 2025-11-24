import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'
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
  getProjectById: (id: string) => Promise<ThreadFolder | undefined>
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

    // Delete threads from frontend state
    for (const thread of projectThreads) {
      threadsState.deleteThread(thread.id)
    }

    // Delete the project from storage
    const projectsService = serviceHub.projects()
    await projectsService.deleteProject(id)

    const updatedProjects = await projectsService.getProjects()
    set({ folders: updatedProjects })
  },

  getFolderById: (id) => {
    return get().folders.find((folder) => folder.id === id)
  },

  getProjectById: async (id) => {
    const projectsService = getServiceHub().projects()
    return await projectsService.getProjectById(id)
  },
}))

export const useThreadManagement = () => {
  const store = useThreadManagementStore()

  // Load projects from service on mount
  useEffect(() => {
    const syncProjects = async () => {
      try {
        const projectsService = getServiceHub().projects()
        const projects = await projectsService.getProjects()
        useThreadManagementStore.setState({ folders: projects })
      } catch (error) {
        console.error('Error syncing projects:', error)
      }
    }
    syncProjects()
  }, [])

  return store
}
