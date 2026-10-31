import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { updateThreadProject } from '@/lib/threadProject'
import { isCoworkThread } from '@/lib/threadMode'
import type { ThreadFolder } from '@/services/projects/types'
import { useEffect } from 'react'

type ThreadManagementState = {
  folders: ThreadFolder[]
  setFolders: (folders: ThreadFolder[]) => void
  addFolder: (name: string, assistantId?: string) => Promise<ThreadFolder>
  updateFolder: (id: string, name: string, assistantId?: string) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  deleteFolderWithThreads: (id: string) => Promise<void>
  getFolderById: (id: string) => ThreadFolder | undefined
  getProjectById: (id: string) => Promise<ThreadFolder | undefined>
}

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
    // Sessions are authoritative, including while their mirrors lag persistence.
    const threads = Object.values(useThreads.getState().threads)
    const sessions = useCoworkSessions.getState().sessions
    const sessionsById = new Map(sessions.map((session) => [session.id, session]))
    const ids = new Set(threads.filter((thread) =>
      (isCoworkThread(thread)
        ? sessionsById.get(thread.id)?.project?.id
        : thread.metadata?.project?.id) === id
    ).map((thread) => thread.id))
    for (const session of sessions) {
      if (session.project?.id === id && !session.unavailable) ids.add(session.id)
    }
    ids.forEach((threadId) => updateThreadProject(threadId, undefined))

    const projectsService = getServiceHub().projects()
    await projectsService.deleteProject(id)
    const updatedProjects = await projectsService.getProjects()
    set({ folders: updatedProjects })
  },

  deleteFolderWithThreads: async (id) => {
    // Share the project deletion lifecycle, including authoritative Cowork
    // session removal; direct backend deletes race Cowork's write-through sync.
    await useThreads.getState().deleteAllThreadsByProject(id)

    const projectsService = getServiceHub().projects()
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
