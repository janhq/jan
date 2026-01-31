/**
 * Projects Service Types
 * Types for project/folder management operations
 */

export interface ThreadFolder {
  id: string
  name: string
  updated_at: number
  assistantId?: string
}

export interface ProjectsService {
  /**
   * Get all projects/folders
   */
  getProjects(): Promise<ThreadFolder[]>

  /**
   * Add a new project/folder
   */
  addProject(name: string, assistantId?: string): Promise<ThreadFolder>

  /**
   * Update a project/folder
   */
  updateProject(id: string, name: string, assistantId?: string): Promise<void>

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
}
