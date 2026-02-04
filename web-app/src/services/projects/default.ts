/**
 * Default Projects Service - localStorage implementation
 */

import { ulid } from 'ulidx'
import type { ProjectsService, ThreadFolder } from './types'
import { localStorageKey } from '@/constants/localStorage'

export class DefaultProjectsService implements ProjectsService {
  private storageKey = localStorageKey.threadManagement

  private loadFromStorage(): ThreadFolder[] {
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (!stored) return []
      const data = JSON.parse(stored)
      return data.state?.folders || []
    } catch (error) {
      console.error('Error loading projects from localStorage:', error)
      return []
    }
  }

  private saveToStorage(projects: ThreadFolder[]): void {
    try {
      const data = {
        state: { folders: projects },
        version: 0,
      }
      localStorage.setItem(this.storageKey, JSON.stringify(data))
    } catch (error) {
      console.error('Error saving projects to localStorage:', error)
    }
  }

<<<<<<< HEAD
  private buildProjectPath(
    projectId: string,
    projects: ThreadFolder[]
  ): string[] {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return []

    if (!project.parent_id) return [project.id]

    const parentPath = this.buildProjectPath(project.parent_id, projects)
    return [...parentPath, project.id]
  }

=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  async getProjects(): Promise<ThreadFolder[]> {
    return this.loadFromStorage()
  }

<<<<<<< HEAD
  async addProject(
    name: string,
    parentId?: string | null
  ): Promise<ThreadFolder> {
    const projects = this.loadFromStorage()
    const now = Date.now()

    const newProject: ThreadFolder = {
      id: ulid(),
      name,
      description: undefined,
      parent_id: parentId || null,
      path: [],
      color: undefined,
      icon: undefined,
      updated_at: now,
      created_at: now,
      metadata: {
        tags: [],
        archived: false,
        starred: false,
      },
    }

    const updatedProjects = [...projects, newProject]
    newProject.path = this.buildProjectPath(newProject.id, updatedProjects)

    this.saveToStorage(updatedProjects)
    return newProject
  }

  async updateProject(
    id: string,
    updates: Partial<ThreadFolder>
  ): Promise<void> {
    const projects = this.loadFromStorage()
    const updatedProjects = projects.map((project) =>
      project.id === id
        ? { ...project, ...updates, updated_at: Date.now() }
=======
  async addProject(name: string, assistantId?: string): Promise<ThreadFolder> {
    const newProject: ThreadFolder = {
      id: ulid(),
      name,
      updated_at: Date.now(),
      assistantId,
    }

    const projects = this.loadFromStorage()
    const updatedProjects = [...projects, newProject]
    this.saveToStorage(updatedProjects)

    return newProject
  }

  async updateProject(id: string, name: string, assistantId?: string): Promise<void> {
    const projects = this.loadFromStorage()
    const updatedProjects = projects.map((project) =>
      project.id === id
        ? { ...project, name, updated_at: Date.now(), assistantId }
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        : project
    )
    this.saveToStorage(updatedProjects)
  }

  async deleteProject(id: string): Promise<void> {
    const projects = this.loadFromStorage()
    const updatedProjects = projects.filter((project) => project.id !== id)
    this.saveToStorage(updatedProjects)
  }

  async getProjectById(id: string): Promise<ThreadFolder | undefined> {
    const projects = this.loadFromStorage()
    return projects.find((project) => project.id === id)
  }

  async setProjects(projects: ThreadFolder[]): Promise<void> {
    this.saveToStorage(projects)
  }
<<<<<<< HEAD

  async moveProject(
    projectId: string,
    newParentId: string | null
  ): Promise<void> {
    const projects = this.loadFromStorage()
    const updatedProjects = projects.map((project) => {
      if (project.id === projectId) {
        const updated = {
          ...project,
          parent_id: newParentId,
          updated_at: Date.now(),
        }
        updated.path = this.buildProjectPath(updated.id, projects)
        return updated
      }
      return project
    })
    this.saveToStorage(updatedProjects)
  }

  async getProjectChildren(projectId: string): Promise<ThreadFolder[]> {
    const projects = this.loadFromStorage()
    return projects.filter((p) => p.parent_id === projectId)
  }

  async getProjectPath(projectId: string): Promise<ThreadFolder[]> {
    const projects = this.loadFromStorage()
    const path: ThreadFolder[] = []

    let currentId: string | null | undefined = projectId
    while (currentId) {
      const project = projects.find((p) => p.id === currentId)
      if (!project) break
      path.unshift(project)
      currentId = project.parent_id
    }

    return path
  }
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
}
