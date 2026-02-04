import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'
import type { ThreadFolder } from '@/services/projects/types'
import { useEffect } from 'react'

type ThreadManagementState = {
  folders: ThreadFolder[]
  setFolders: (folders: ThreadFolder[]) => void
<<<<<<< HEAD
  addFolder: (name: string) => Promise<ThreadFolder>
  updateFolder: (id: string, name: string) => Promise<void>
=======
  addFolder: (name: string, assistantId?: string) => Promise<ThreadFolder>
  updateFolder: (id: string, name: string, assistantId?: string) => Promise<void>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  deleteFolder: (id: string) => Promise<void>
  deleteFolderWithThreads: (id: string) => Promise<void>
  getFolderById: (id: string) => ThreadFolder | undefined
  getProjectById: (id: string) => Promise<ThreadFolder | undefined>
}

<<<<<<< HEAD
const useThreadManagementStore = create<ThreadManagementState>()(
  (set, get) => ({
    folders: [],

    setFolders: (folders) => {
      set({ folders })
    },

    addFolder: async (name) => {
      const projectsService = getServiceHub().projects()
      const newFolder = await projectsService.addProject(name)
      const updatedProjects = await projectsService.getProjects()
      set({ folders: updatedProjects })
      return newFolder
    },

    updateFolder: async (id, name) => {
      const projectsService = getServiceHub().projects()
      await projectsService.updateProject(id, { name })
      const updatedProjects = await projectsService.getProjects()
      set({ folders: updatedProjects })
    },

    deleteFolder: async (id) => {
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

      const projectsService = getServiceHub().projects()
      await projectsService.deleteProject(id)
      const updatedProjects = await projectsService.getProjects()
      set({ folders: updatedProjects })
    },

    deleteFolderWithThreads: async (id) => {
      // Get all threads that belong to this project
      const threadsState = useThreads.getState()
      const projectThreads = Object.values(threadsState.threads).filter(
        (thread) => thread.metadata?.project?.id === id
      )

      // Delete threads from backend first
      const serviceHub = getServiceHub()
      for (const thread of projectThreads) {
        await serviceHub.threads().deleteThread(thread.id)
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
  })
)
=======
const useThreadManagementStore = create<ThreadManagementState>()((set, get) => ({
  folders: [],

  setFolders: (folders) => {
    set({ folders })
  },

  addFolder: async (name, assistantId) => {
    const projectsService = getServiceHub().projects()
    const newFolder = await projectsService.addProject(name, assistantId)
    const updatedProjects = await projectsService.getProjects()
    set({ folders: updatedProjects })
    return newFolder
  },

  updateFolder: async (id, name, assistantId) => {
    const projectsService = getServiceHub().projects()
    await projectsService.updateProject(id, name, assistantId)
    const updatedProjects = await projectsService.getProjects()
    set({ folders: updatedProjects })
  },

  deleteFolder: async (id) => {
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

    const projectsService = getServiceHub().projects()
    await projectsService.deleteProject(id)
    const updatedProjects = await projectsService.getProjects()
    set({ folders: updatedProjects })
  },

  deleteFolderWithThreads: async (id) => {
    // Get all threads that belong to this project
    const threadsState = useThreads.getState()
    const projectThreads = Object.values(threadsState.threads).filter(
      (thread) => thread.metadata?.project?.id === id
    )

    // Delete threads from backend first
    const serviceHub = getServiceHub()
    for (const thread of projectThreads) {
      await serviceHub.threads().deleteThread(thread.id)
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

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
