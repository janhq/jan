/**
 * Server-based Projects Service
 * Uses ProjectExtensionWeb to persist projects on the server
 */

import type { ProjectsService, ThreadFolder } from './types'
import type { ProjectExtension, Project, ConversationalExtension, Thread } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'

// Extended Thread type with project_id
type ThreadWithProject = Thread & { project_id?: string }

export class ServerProjectsService implements ProjectsService {
  private projectExtension: ProjectExtension | null = null
  private conversationalExtension: ConversationalExtension | null = null

  private getProjectExtension(): ProjectExtension {
    if (!this.projectExtension) {
      this.projectExtension = ExtensionManager.getInstance().getByName('project-web') as ProjectExtension
      if (!this.projectExtension) {
        throw new Error('ProjectExtension not available. Make sure project-web extension is loaded.')
      }
    }
    return this.projectExtension
  }

  private getConversationalExtension(): ConversationalExtension {
    if (!this.conversationalExtension) {
      const extension = ExtensionManager.getInstance().getByName('conversational-web')
      if (!extension) {
        throw new Error('ConversationalExtension not available.')
      }
      this.conversationalExtension = extension as ConversationalExtension
    }
    return this.conversationalExtension
  }

  /**
   * Convert server Project to ThreadFolder format
   */
  private projectToThreadFolder(project: Project): ThreadFolder {
    // Convert ISO string timestamp to number
    const updatedAt = typeof project.updated_at === 'string' 
      ? new Date(project.updated_at).getTime()
      : project.updated_at
      
    return {
      id: project.id,
      name: project.name,
      instruction: project.instruction,
      updated_at: updatedAt,
    }
  }

  async getProjects(): Promise<ThreadFolder[]> {
    try {
      console.log('[ServerProjectsService] getProjects: Fetching all projects')
      const extension = this.getProjectExtension()
      const projects = await extension.getAllProjects()
      console.log('[ServerProjectsService] getProjects: Retrieved', projects.length, 'projects')
      
      // Filter out archived projects and convert to ThreadFolder format
      const activeProjects = projects
        .filter(p => !p.is_archived)
        .map(p => this.projectToThreadFolder(p))
        .sort((a, b) => b.updated_at - a.updated_at) // Sort by most recently updated
      
      console.log('[ServerProjectsService] getProjects: Returning', activeProjects.length, 'active projects')
      return activeProjects
    } catch (error) {
      console.error('[ServerProjectsService] getProjects: Error loading projects from server:', error)
      return []
    }
  }

  async addProject(name: string, instruction?: string): Promise<ThreadFolder> {
    try {
      console.log('[ServerProjectsService] addProject: Creating project with name:', name, 'and instruction:', instruction)
      const extension = this.getProjectExtension()
      const project = await extension.createProject({ name, instruction })
      console.log('[ServerProjectsService] addProject: Created project:', { id: project.id, name: project.name })
      
      return this.projectToThreadFolder(project)
    } catch (error) {
      console.error('[ServerProjectsService] addProject: Error creating project on server:', error)
      throw error
    }
  }

  async updateProject(id: string, name: string, instruction?: string): Promise<void> {
    try {
      console.log('[ServerProjectsService] updateProject: Updating project:', { id, name, instruction })
      const extension = this.getProjectExtension()
      await extension.updateProject(id, { name, instruction })
      console.log('[ServerProjectsService] updateProject: Successfully updated project:', id)
    } catch (error) {
      console.error('[ServerProjectsService] updateProject: Error updating project on server:', { id, name, error })
      throw error
    }
  }

  async deleteProject(id: string): Promise<void> {
    try {
      console.log('[ServerProjectsService] deleteProject: Deleting project:', id)
      const extension = this.getProjectExtension()
      await extension.deleteProject(id)
      console.log('[ServerProjectsService] deleteProject: Successfully deleted project:', id)
    } catch (error) {
      console.error('[ServerProjectsService] deleteProject: Error deleting project from server:', { id, error })
      throw error
    }
  }

  async getProjectById(id: string): Promise<ThreadFolder | undefined> {
    try {
      console.log('[ServerProjectsService] getProjectById: Fetching project:', id)
      const extension = this.getProjectExtension()
      const project = await extension.getProject(id)
      
      if (!project) {
        console.log('[ServerProjectsService] getProjectById: Project not found:', id)
        return undefined
      }
      
      console.log('[ServerProjectsService] getProjectById: Found project:', { id: project.id, name: project.name })
      return this.projectToThreadFolder(project)
    } catch (error) {
      console.error('[ServerProjectsService] getProjectById: Error getting project from server:', { id, error })
      return undefined
    }
  }

  async setProjects(projects: ThreadFolder[]): Promise<void> {
    // For server-based implementation, this would need to sync all projects
    // This is a complex operation and may not be commonly used
    console.log('[ServerProjectsService] setProjects: Syncing', projects.length, 'projects')
    console.warn('[ServerProjectsService] setProjects: Not fully implemented for server-based storage')
    
    try {
      const extension = this.getProjectExtension()
      const existingProjects = await extension.getAllProjects()
      console.log('[ServerProjectsService] setProjects: Found', existingProjects.length, 'existing projects')
      
      // For now, just update names of existing projects
      for (const folder of projects) {
        const existing = existingProjects.find(p => p.id === folder.id)
        if (existing) {
          console.log('[ServerProjectsService] setProjects: Updating project:', { id: folder.id, name: folder.name, instruction: folder.instruction })
          await extension.updateProject(folder.id, { name: folder.name, instruction: folder.instruction })
        }
      }
      console.log('[ServerProjectsService] setProjects: Completed sync')
    } catch (error) {
      console.error('[ServerProjectsService] setProjects: Error setting projects on server:', error)
      throw error
    }
  }

  /**
   * Move a thread to a project (or remove from project if projectId is null)
   */
  async moveThreadToProject(threadId: string, projectId: string | null): Promise<void> {
    try {
      console.log('[ServerProjectsService] moveThreadToProject: Moving thread to project:', { 
        threadId, 
        projectId: projectId || 'none' 
      })
      
      const conversationalExt = this.getConversationalExtension()
      const threads = await conversationalExt.listThreads() as ThreadWithProject[]
      const thread = threads.find(t => t.id === threadId)
      
      if (!thread) {
        console.error('[ServerProjectsService] moveThreadToProject: Thread not found:', threadId)
        throw new Error(`Thread ${threadId} not found`)
      }

      console.log('[ServerProjectsService] moveThreadToProject: Found thread:', {
        threadId: thread.id,
        title: thread.title,
        currentProjectId: thread.project_id || 'none',
        newProjectId: projectId || 'none'
      })

      // Update thread with new project_id (or undefined to remove)
      const updatedThread = {
        ...thread,
        project_id: projectId || undefined,
      }

      await conversationalExt.modifyThread(updatedThread)
      console.log('[ServerProjectsService] moveThreadToProject: Successfully moved thread:', {
        threadId,
        fromProject: thread.project_id || 'none',
        toProject: projectId || 'none'
      })
    } catch (error) {
      console.error('[ServerProjectsService] moveThreadToProject: Error moving thread to project:', {
        threadId,
        projectId,
        error
      })
      throw error
    }
  }

  /**
   * Get all threads in a specific project
   */
  async getProjectThreads(projectId: string): Promise<ThreadWithProject[]> {
    try {
      console.log('[ServerProjectsService] getProjectThreads: Fetching threads for project:', projectId)
      const conversationalExt = this.getConversationalExtension()
      const allThreads = await conversationalExt.listThreads() as ThreadWithProject[]
      console.log('[ServerProjectsService] getProjectThreads: Retrieved', allThreads.length, 'total threads')
      
      // Log all thread structures to see what fields they have
      allThreads.forEach(thread => {
        console.log('[ServerProjectsService] getProjectThreads: Thread structure:', {
          threadId: thread.id,
          title: thread.title,
          project_id: thread.project_id,
          metadata: thread.metadata,
          hasMetadata: !!thread.metadata,
          metadataProject: thread.metadata?.project
        })
      })
      
      // Filter threads by project_id
      const projectThreads = allThreads.filter(thread => thread.project_id === projectId)
      console.log('[ServerProjectsService] getProjectThreads: Found', projectThreads.length, 'threads in project:', projectId)
      
      // Log thread details
      projectThreads.forEach(thread => {
        console.log('[ServerProjectsService] getProjectThreads: Thread in project:', {
          threadId: thread.id,
          title: thread.title,
          projectId: thread.project_id
        })
      })
      
      return projectThreads
    } catch (error) {
      console.error('[ServerProjectsService] getProjectThreads: Error getting project threads:', { projectId, error })
      return []
    }
  }

  /**
   * Get thread count for a specific project
   */
  async getProjectThreadCount(projectId: string): Promise<number> {
    try {
      console.log('[ServerProjectsService] getProjectThreadCount: Counting threads for project:', projectId)
      const threads = await this.getProjectThreads(projectId)
      console.log('[ServerProjectsService] getProjectThreadCount: Project', projectId, 'has', threads.length, 'threads')
      return threads.length
    } catch (error) {
      console.error('[ServerProjectsService] getProjectThreadCount: Error getting project thread count:', { projectId, error })
      return 0
    }
  }

  /**
   * Remove project_id from all threads in a project (when deleting project without deleting threads)
   */
  async removeProjectFromThreads(projectId: string): Promise<void> {
    try {
      console.log('[ServerProjectsService] removeProjectFromThreads: Removing project from threads:', projectId)
      const threads = await this.getProjectThreads(projectId)
      console.log('[ServerProjectsService] removeProjectFromThreads: Found', threads.length, 'threads to update')
      
      const conversationalExt = this.getConversationalExtension()

      for (const thread of threads) {
        console.log('[ServerProjectsService] removeProjectFromThreads: Removing project from thread:', {
          threadId: thread.id,
          title: thread.title,
          projectId
        })
        
        const updatedThread = {
          ...thread,
          project_id: undefined,
        }
        await conversationalExt.modifyThread(updatedThread)
      }

      console.log('[ServerProjectsService] removeProjectFromThreads: Successfully removed project', projectId, 'from', threads.length, 'threads')
    } catch (error) {
      console.error('[ServerProjectsService] removeProjectFromThreads: Error removing project from threads:', { projectId, error })
      throw error
    }
  }

  /**
   * Delete all threads in a project
   */
  async deleteProjectThreads(projectId: string): Promise<void> {
    try {
      console.log('[ServerProjectsService] deleteProjectThreads: Deleting all threads in project:', projectId)
      const threads = await this.getProjectThreads(projectId)
      console.log('[ServerProjectsService] deleteProjectThreads: Found', threads.length, 'threads to delete')
      
      const conversationalExt = this.getConversationalExtension()

      for (const thread of threads) {
        console.log('[ServerProjectsService] deleteProjectThreads: Deleting thread:', {
          threadId: thread.id,
          title: thread.title,
          projectId
        })
        await conversationalExt.deleteThread(thread.id)
      }

      console.log('[ServerProjectsService] deleteProjectThreads: Successfully deleted', threads.length, 'threads from project:', projectId)
    } catch (error) {
      console.error('[ServerProjectsService] deleteProjectThreads: Error deleting project threads:', { projectId, error })
      throw error
    }
  }
}
