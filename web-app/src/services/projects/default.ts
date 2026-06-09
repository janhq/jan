/**
 * Default Projects Service - localStorage implementation
 */

import { ulid } from 'ulidx'
import type { ProjectsService, ThreadFolder } from './types'
import { localStorageKey } from '@/constants/localStorage'
import {
  basenameFromPath,
  normalizeProjectPath,
} from '@/lib/project-folders'

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

  async getProjects(): Promise<ThreadFolder[]> {
    return this.loadFromStorage()
  }

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

  async findProjectByDirectoryPath(
    directoryPath: string
  ): Promise<ThreadFolder | undefined> {
    const normalized = normalizeProjectPath(directoryPath)
    const projects = this.loadFromStorage()
    return projects.find(
      (project) =>
        project.directoryPath &&
        normalizeProjectPath(project.directoryPath) === normalized
    )
  }

  async addProjectFromDirectory(
    directoryPath: string,
    assistantId?: string
  ): Promise<ThreadFolder> {
    const normalized = normalizeProjectPath(directoryPath)
    const existing = await this.findProjectByDirectoryPath(normalized)
    if (existing) {
      const projects = this.loadFromStorage()
      const updatedProjects = projects.map((project) =>
        project.id === existing.id
          ? {
              ...project,
              updated_at: Date.now(),
              assistantId: assistantId ?? project.assistantId,
            }
          : project
      )
      this.saveToStorage(updatedProjects)
      return {
        ...existing,
        updated_at: Date.now(),
        assistantId: assistantId ?? existing.assistantId,
      }
    }

    const newProject: ThreadFolder = {
      id: ulid(),
      name: basenameFromPath(normalized),
      directoryPath: normalized,
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
        : project
    )
    this.saveToStorage(updatedProjects)
  }

  async updateProjectDirectory(
    id: string,
    directoryPath: string,
    assistantId?: string
  ): Promise<void> {
    const normalized = normalizeProjectPath(directoryPath)
    const projects = this.loadFromStorage()
    const updatedProjects = projects.map((project) =>
      project.id === id
        ? {
            ...project,
            name: basenameFromPath(normalized),
            directoryPath: normalized,
            updated_at: Date.now(),
            assistantId: assistantId ?? project.assistantId,
          }
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
}
