import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'
import type { ThreadFolder } from '@/services/projects/types'
import { useEffect } from 'react'

type ThreadManagementState = {
  folders: ThreadFolder[]
  isInitialized: boolean
  initializePromise: Promise<void> | null
  setFolders: (folders: ThreadFolder[]) => void
  initialize: () => Promise<void>
  addFolder: (name: string, instruction?: string) => Promise<ThreadFolder>
  updateFolder: (id: string, name: string, instruction?: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  deleteFolderWithThreads: (id: string) => Promise<void>
  getFolderById: (id: string) => ThreadFolder | undefined
  getProjectById: (id: string) => Promise<ThreadFolder | undefined>
}

const useThreadManagementStore = create<ThreadManagementState>()((set, get) => ({
  folders: [],
  isInitialized: false,
  initializePromise: null,

  setFolders: (folders) => {
    set({ folders })
  },

  initialize: async () => {
    const state = get()

    // If already initialized, return immediately
    if (state.isInitialized) {
      return
    }

    // If initialization is in progress, wait for it
    if (state.initializePromise) {
      return state.initializePromise
    }

    // Create new initialization promise
    const promise = (async () => {
      try {
        console.log('[useThreadManagement] Initializing projects (first call only)')
        const projectsService = getServiceHub().projects()
        const projects = await projectsService.getProjects()
        set({ folders: projects, isInitialized: true, initializePromise: null })
      } catch (error) {
        console.error('[useThreadManagement] Error initializing projects:', error)
        set({ isInitialized: true, initializePromise: null }) // Mark as initialized even on error
      }
    })()

    set({ initializePromise: promise })
    return promise
  },

  addFolder: async (name, instruction) => {
    const projectsService = getServiceHub().projects()
    const newFolder = await projectsService.addProject(name, instruction)
    const updatedProjects = await projectsService.getProjects()
    set({ folders: updatedProjects })
    return newFolder
  },

  updateFolder: async (id, name, instruction) => {
    const projectsService = getServiceHub().projects()
    await projectsService.updateProject(id, name, instruction)
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

export const useThreadManagement = () => {
  const store = useThreadManagementStore()

  // Initialize projects on first call
  useEffect(() => {
    store.initialize()
  }, [])

  return store
}
