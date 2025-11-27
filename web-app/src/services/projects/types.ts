/**
 * Projects Service Types
 * Types for project/folder management operations
 */

import type { Thread } from '@janhq/core'

export interface ThreadFolder {
  id: string
  name: string
  instruction?: string
  updated_at: number
  threads?: Thread[]
}

export interface ProjectsService {
  /**
   * Get all projects/folders
   */
  getProjects(): Promise<ThreadFolder[]>

  /**
   * Add a new project/folder
   */
  addProject(name: string, instruction?: string): Promise<ThreadFolder>

  /**
   * Update a project/folder name and instruction
   */
  updateProject(id: string, name: string, instruction?: string): Promise<void>

  /**
   * Delete a project/folder
   */
  deleteProject(id: string): Promise<void>

  /**
   * Get a project/folder by ID
   */
  getProjectById(id: string): Promise<ThreadFolder | undefined>

  /**
   * Set all projects/folders (for bulk updates)
   */
  setProjects(projects: ThreadFolder[]): Promise<void>

  /**
   * Get all threads/conversations in a project
   */
  getProjectThreads(projectId: string): Promise<Thread[]>
}
