/**
 * Server-based Projects Service
 * Uses ProjectExtensionWeb to persist projects on the server
 */

import type { ProjectsService, ThreadFolder } from './types'
import type { ProjectExtension, Project, ConversationalExtension, Thread } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'

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
      updated_at: updatedAt,
    }
  }

  async getProjects(): Promise<ThreadFolder[]> {
    try {
      const extension = this.getProjectExtension()
      const projects = await extension.getAllProjects()
      
      // Filter out archived projects and convert to ThreadFolder format
      const activeProjects = projects
        .filter(p => !p.is_archived)
        .map(p => this.projectToThreadFolder(p))
        .sort((a, b) => b.updated_at - a.updated_at) // Sort by most recently updated
      
      return activeProjects
    } catch (error) {
      console.error('Error loading projects from server:', error)
      return []
    }
  }

  async addProject(name: string): Promise<ThreadFolder> {
    try {
      const extension = this.getProjectExtension()
      const project = await extension.createProject({ name })
      
      return this.projectToThreadFolder(project)
    } catch (error) {
      console.error('Error creating project on server:', error)
      throw error
    }
  }

  async updateProject(id: string, name: string): Promise<void> {
    try {
      const extension = this.getProjectExtension()
      await extension.updateProject(id, { name })
    } catch (error) {
      console.error('Error updating project on server:', error)
      throw error
    }
  }

  async deleteProject(id: string): Promise<void> {
    try {
      const extension = this.getProjectExtension()
      await extension.deleteProject(id)
    } catch (error) {
      console.error('Error deleting project from server:', error)
      throw error
    }
  }

  async getProjectById(id: string): Promise<ThreadFolder | undefined> {
    try {
      const extension = this.getProjectExtension()
      const project = await extension.getProject(id)
      
      if (!project) return undefined
      
      return this.projectToThreadFolder(project)
    } catch (error) {
      console.error('Error getting project from server:', error)
      return undefined
    }
  }

  async setProjects(projects: ThreadFolder[]): Promise<void> {
    // For server-based implementation, this would need to sync all projects
    // This is a complex operation and may not be commonly used
    console.warn('setProjects not fully implemented for server-based storage')
    
    try {
      const extension = this.getProjectExtension()
      const existingProjects = await extension.getAllProjects()
      
      // For now, just update names of existing projects
      for (const folder of projects) {
        const existing = existingProjects.find(p => p.id === folder.id)
        if (existing) {
          await extension.updateProject(folder.id, { name: folder.name })
        }
      }
    } catch (error) {
      console.error('Error setting projects on server:', error)
      throw error
    }
  }

  /**
   * Move a thread to a project (or remove from project if projectId is null)
   */
  async moveThreadToProject(threadId: string, projectId: string | null): Promise<void> {
    try {
      const conversationalExt = this.getConversationalExtension()
      const threads = await conversationalExt.listThreads()
      const thread = threads.find(t => t.id === threadId)
      
      if (!thread) {
        throw new Error(`Thread ${threadId} not found`)
      }

      // Update thread with new project_id (or undefined to remove)
      const updatedThread = {
        ...thread,
        project_id: projectId || undefined,
      }

      await conversationalExt.modifyThread(updatedThread)
      console.log(`Moved thread ${threadId} to project ${projectId || 'none'}`)
    } catch (error) {
      console.error('Error moving thread to project:', error)
      throw error
    }
  }

  /**
   * Get all threads in a specific project
   */
  async getProjectThreads(projectId: string): Promise<any[]> {
    try {
      const conversationalExt = this.getConversationalExtension()
      const allThreads = await conversationalExt.listThreads()
      
      // Filter threads by project_id
      const projectThreads = allThreads.filter(thread => thread.project_id === projectId)
      
      return projectThreads
    } catch (error) {
      console.error('Error getting project threads:', error)
      return []
    }
  }

  /**
   * Get thread count for a specific project
   */
  async getProjectThreadCount(projectId: string): Promise<number> {
    try {
      const threads = await this.getProjectThreads(projectId)
      return threads.length
    } catch (error) {
      console.error('Error getting project thread count:', error)
      return 0
    }
  }

  /**
   * Remove project_id from all threads in a project (when deleting project without deleting threads)
   */
  async removeProjectFromThreads(projectId: string): Promise<void> {
    try {
      const threads = await this.getProjectThreads(projectId)
      const conversationalExt = this.getConversationalExtension()

      for (const thread of threads) {
        const updatedThread = {
          ...thread,
          project_id: undefined,
        }
        await conversationalExt.modifyThread(updatedThread)
      }

      console.log(`Removed project ${projectId} from ${threads.length} threads`)
    } catch (error) {
      console.error('Error removing project from threads:', error)
      throw error
    }
  }

  /**
   * Delete all threads in a project
   */
  async deleteProjectThreads(projectId: string): Promise<void> {
    try {
      const threads = await this.getProjectThreads(projectId)
      const conversationalExt = this.getConversationalExtension()

      for (const thread of threads) {
        await conversationalExt.deleteThread(thread.id)
      }

      console.log(`Deleted ${threads.length} threads from project ${projectId}`)
    } catch (error) {
      console.error('Error deleting project threads:', error)
      throw error
    }
  }
}
