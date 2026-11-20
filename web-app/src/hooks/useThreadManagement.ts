import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { updateThreadProject } from '@/lib/threadProject'
import { isCoworkThread } from '@/lib/threadMode'
import { deleteCoworkConversation } from '@/lib/coworkDelete'
import type { ThreadFolder } from '@/services/projects/types'
import { useEffect } from 'react'

type ThreadManagementState = {
  folders: ThreadFolder[]
  /** True once the project list has been read; `folders` is not authoritative before that. */
  foldersLoaded: boolean
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
  foldersLoaded: false,

  setFolders: (folders) => {
    set({ folders, foldersLoaded: true })
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
    const ids = new Set(
      threads
        .filter(
          (thread) =>
            (isCoworkThread(thread)
              ? sessionsById.get(thread.id)?.project?.id
              : thread.metadata?.project?.id) === id
        )
        .map((thread) => thread.id)
    )
    for (const session of sessions) {
      if (session.project?.id === id && !session.unavailable) ids.add(session.id)
    }
    // Remove the project from every conversation that belongs to it.
    ids.forEach((threadId) => updateThreadProject(threadId, undefined))

    const projectsService = getServiceHub().projects()
    await projectsService.deleteProject(id)
    const updatedProjects = await projectsService.getProjects()
    set({ folders: updatedProjects })
  },

  deleteFolderWithThreads: async (id) => {
    const threadsState = useThreads.getState()
    const sessions = useCoworkSessions.getState().sessions
    const sessionsById = new Map(sessions.map((session) => [session.id, session]))
    // The session is authoritative for a Cowork conversation, including while
    // its mirrored thread lags persistence.
    const inProject = (threadId: string, thread?: Thread) =>
      (isCoworkThread(thread) && sessionsById.has(threadId)
        ? sessionsById.get(threadId)?.project?.id
        : thread?.metadata?.project?.id) === id
    const projectThreads = Object.values(threadsState.threads).filter((thread) =>
      inProject(thread.id, thread)
    )
    // A session can exist before its first write has mirrored it into threads.
    const unmirrored = sessions.filter(
      (session) =>
        session.project?.id === id &&
        !session.unavailable &&
        !threadsState.threads[session.id]
    )

    const serviceHub = getServiceHub()
    let coworkRemoved = false
    for (const thread of projectThreads) {
      if (isCoworkThread(thread) && sessionsById.has(thread.id)) {
        // Cowork deletes through its session store (journal, thread record and
        // sandbox); a direct record delete would race the write-through sync.
        threadsState.deleteThread(thread.id)
        coworkRemoved = true
      } else {
        // Delete from the backend first so a failure keeps the project.
        await serviceHub.threads().deleteThread(thread.id)
      }
    }
    for (const session of unmirrored) {
      deleteCoworkConversation(session.id)
      coworkRemoved = true
    }
    if (coworkRemoved) {
      const sync = await import('@/lib/coworkSync')
      await sync.flushCoworkDeletes()
    }
    // Then the frontend state of the plain chats.
    for (const thread of projectThreads) {
      if (!(isCoworkThread(thread) && sessionsById.has(thread.id))) {
        threadsState.deleteThread(thread.id)
      }
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
        useThreadManagementStore.setState({ folders: projects, foldersLoaded: true })
      } catch (error) {
        console.error('Error syncing projects:', error)
      }
    }
    syncProjects()
  }, [])

  return store
}
