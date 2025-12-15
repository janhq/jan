import { create } from 'zustand'
import { projectService } from '@/services/projects-sevice'

let fetchPromise: Promise<void> | null = null

interface ProjectsState {
  projects: Project[]
  loading: boolean
  getProjects: () => Promise<void>
  getProject: (projectId: string) => Promise<Project>
  createProject: (data: CreateProjectRequest) => Promise<Project>
  updateProject: (
    projectId: string,
    data: UpdateProjectRequest
  ) => Promise<Project>
  deleteProject: (projectId: string) => Promise<void>
  clearProjects: () => void
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  loading: false,
  getProjects: async () => {
    if (fetchPromise) {
      return fetchPromise
    }
    if (get().projects.length > 0) {
      return
    }
    fetchPromise = (async () => {
      try {
        set({ loading: true })
        const data = await projectService.getProjects()
        set({ projects: data.data })
      } catch (err) {
        console.error('Error fetching projects:', err)
      } finally {
        set({ loading: false })
        fetchPromise = null
      }
    })()
  },
  getProject: async (projectId: string) => {
    try {
      const project = await projectService.getProject(projectId)
      return project
    } catch (err) {
      console.error('Error fetching project:', err)
      throw err
    }
  },
  createProject: async (data: CreateProjectRequest) => {
    try {
      const newProject = await projectService.createProject(data)
      set((state) => ({
        projects: [newProject, ...state.projects],
      }))
      return newProject
    } catch (err) {
      console.error('Error creating project:', err)
      throw err
    }
  },
  updateProject: async (projectId: string, data: UpdateProjectRequest) => {
    try {
      const updatedProject = await projectService.updateProject(projectId, data)
      set((state) => ({
        projects: state.projects.map((project) =>
          project.id === projectId ? updatedProject : project
        ),
      }))
      return updatedProject
    } catch (err) {
      console.error('Error updating project:', err)
      throw err
    }
  },
  deleteProject: async (projectId: string) => {
    try {
      await projectService.deleteProject(projectId)
      set((state) => ({
        projects: state.projects.filter((project) => project.id !== projectId),
      }))
    } catch (err) {
      console.error('Error deleting project:', err)
      throw err
    }
  },
  clearProjects: () => {
    set({ projects: [], loading: false })
    fetchPromise = null
  },
}))
