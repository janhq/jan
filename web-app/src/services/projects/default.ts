/**
 * Default Projects Service - file-backed storage implementation
 */

import { ulid } from 'ulidx'
import type { ProjectsService, ThreadFolder } from './types'
import { localStorageKey } from '@/constants/localStorage'
import { fileStorage } from '@/lib/fileStorage'

export class DefaultProjectsService implements ProjectsService {
  private storageKey = localStorageKey.threadManagement

  private async loadFromStorage(): Promise<ThreadFolder[]> {
    try {
      const stored = await fileStorage.getItem(this.storageKey)
      if (!stored) return []
      const data = JSON.parse(stored)
      return data.state?.folders || []
    } catch (error) {
      console.error('Error loading projects from storage:', error)
      return []
    }
  }

  private async saveToStorage(projects: ThreadFolder[]): Promise<void> {
    try {
      const data = {
        state: { folders: projects },
        version: 0,
      }
      await fileStorage.setItem(this.storageKey, JSON.stringify(data))
    } catch (error) {
      console.error('Error saving projects to storage:', error)
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

    const projects = await this.loadFromStorage()
    await this.saveToStorage([...projects, newProject])
    return newProject
  }

  async updateProject(id: string, name: string, assistantId?: string): Promise<void> {
    const projects = await this.loadFromStorage()
    const updated = projects.map((project) =>
      project.id === id
        ? { ...project, name, updated_at: Date.now(), assistantId }
        : project
    )
    await this.saveToStorage(updated)
  }

  async deleteProject(id: string): Promise<void> {
    const projects = await this.loadFromStorage()
    await this.saveToStorage(projects.filter((project) => project.id !== id))
  }

  async getProjectById(id: string): Promise<ThreadFolder | undefined> {
    const projects = await this.loadFromStorage()
    return projects.find((project) => project.id === id)
  }

  async setProjects(projects: ThreadFolder[]): Promise<void> {
    await this.saveToStorage(projects)
  }
}
