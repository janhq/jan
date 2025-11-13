/**
 * Web Project Extension
 * Manages projects using the server API
 */

import { ProjectExtension } from '@janhq/core'
import type {
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  ListProjectsParams,
  ListProjectsResponse,
} from '@janhq/core'
import { RemoteApi } from '../conversational-web/api'

export default class ProjectExtensionWeb extends ProjectExtension {
  private remoteApi!: RemoteApi

  onLoad(): void {
    console.log('Loading Web Project Extension')
    this.remoteApi = new RemoteApi()
  }

  onUnload(): void {
    console.log('Unloading Web Project Extension')
  }

  /**
   * Convert server Project to core Project format
   */
  private projectToCore(project: any): Project {
    return {
      id: project.id,
      object: 'project' as const,
      name: project.name,
      instruction: project.instruction,
      is_favorite: project.is_favorite,
      is_archived: project.is_archived,
      archived_at: project.archived_at,
      created_at: typeof project.created_at === 'string' 
        ? new Date(project.created_at).getTime()
        : project.created_at,
      updated_at: typeof project.updated_at === 'string'
        ? new Date(project.updated_at).getTime()
        : project.updated_at,
    }
  }

  async getAllProjects(): Promise<Project[]> {
    try {
      const response = await this.remoteApi.listProjects({ limit: 1000 })
      return response.data.map(p => this.projectToCore(p))
    } catch (error) {
      console.error('Failed to get all projects:', error)
      return []
    }
  }

  async createProject(data: CreateProjectRequest): Promise<Project> {
    try {
      const project = await this.remoteApi.createProject(data)
      return this.projectToCore(project)
    } catch (error) {
      console.error('Failed to create project:', error)
      throw error
    }
  }

  async getProject(projectId: string): Promise<Project | null> {
    try {
      const project = await this.remoteApi.getProject(projectId)
      return this.projectToCore(project)
    } catch (error) {
      console.error('Failed to get project:', error)
      return null
    }
  }

  async updateProject(
    projectId: string,
    data: UpdateProjectRequest
  ): Promise<Project> {
    try {
      const project = await this.remoteApi.updateProject(projectId, data)
      return this.projectToCore(project)
    } catch (error) {
      console.error('Failed to update project:', error)
      throw error
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    try {
      await this.remoteApi.deleteProject(projectId)
    } catch (error) {
      console.error('Failed to delete project:', error)
      throw error
    }
  }

  async listProjects(params?: ListProjectsParams): Promise<ListProjectsResponse> {
    try {
      const response = await this.remoteApi.listProjects(params)
      return {
        object: 'list',
        data: response.data.map(p => this.projectToCore(p)),
        first_id: response.first_id,
        last_id: response.last_id,
        next_cursor: response.next_cursor,
        has_more: response.has_more,
        total: response.total,
      }
    } catch (error) {
      console.error('Failed to list projects:', error)
      throw error
    }
  }

  async favoriteProject(projectId: string, isFavorite: boolean): Promise<Project> {
    try {
      const project = await this.remoteApi.updateProject(projectId, { is_favorite: isFavorite })
      return this.projectToCore(project)
    } catch (error) {
      console.error('Failed to favorite project:', error)
      throw error
    }
  }

  async archiveProject(projectId: string, isArchived: boolean): Promise<Project> {
    try {
      const project = await this.remoteApi.updateProject(projectId, { is_archived: isArchived })
      return this.projectToCore(project)
    } catch (error) {
      console.error('Failed to archive project:', error)
      throw error
    }
  }
}
