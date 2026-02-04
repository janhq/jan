/**
 * Projects Service Types
<<<<<<< HEAD
 * Types for project/folder management operations with nested hierarchy support
=======
 * Types for project/folder management operations
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
 */

export interface ThreadFolder {
  id: string
  name: string
<<<<<<< HEAD
  description?: string
  parent_id?: string | null
  path: string[]
  color?: string
  icon?: string
  updated_at: number
  created_at: number
  metadata?: {
    tags?: string[]
    priority?: 'low' | 'medium' | 'high'
    archived?: boolean
    starred?: boolean
  }
}

export interface Tag {
  id: string
  name: string
  color: string
  icon?: string
  created_at: number
}

export interface SmartCollection {
  id: string
  name: string
  query: {
    tags?: string[]
    projects?: string[]
    dateRange?: { start: number; end: number }
    models?: string[]
    hasAttachments?: boolean
    minMessages?: number
  }
  icon?: string
  color?: string
  pinned?: boolean
}

export interface ProjectsService {
  getProjects(): Promise<ThreadFolder[]>
  addProject(name: string, parentId?: string | null): Promise<ThreadFolder>
  updateProject(id: string, updates: Partial<ThreadFolder>): Promise<void>
  deleteProject(id: string): Promise<void>
  getProjectById(id: string): Promise<ThreadFolder | undefined>
  setProjects(projects: ThreadFolder[]): Promise<void>
  moveProject(projectId: string, newParentId: string | null): Promise<void>
  getProjectChildren(projectId: string): Promise<ThreadFolder[]>
  getProjectPath(projectId: string): Promise<ThreadFolder[]>
=======
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
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
}
