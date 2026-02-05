/**
 * Projects Service Types
 * Types for project/folder management operations with nested hierarchy support
 */

export interface ThreadFolder {
  id: string
  name: string
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
}
