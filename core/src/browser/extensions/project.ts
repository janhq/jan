import {
  Project,
  ProjectInterface,
  CreateProjectRequest,
  UpdateProjectRequest,
  ListProjectsParams,
  ListProjectsResponse,
  DeleteProjectResponse,
} from '../../types'
import { BaseExtension, ExtensionTypeEnum } from '../extension'

/**
 * Project extension. Manages projects/folders for organizing threads.
 * @abstract
 * @extends BaseExtension
 */
export abstract class ProjectExtension
  extends BaseExtension
  implements ProjectInterface
{
  /**
   * Project extension type.
   */
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.Project
  }

  abstract getAllProjects(): Promise<Project[]>
  abstract createProject(data: CreateProjectRequest): Promise<Project>
  abstract getProject(projectId: string): Promise<Project | null>
  abstract updateProject(projectId: string, data: UpdateProjectRequest): Promise<Project>
  abstract deleteProject(projectId: string): Promise<void>
  abstract listProjects(params?: ListProjectsParams): Promise<ListProjectsResponse>
  abstract favoriteProject(projectId: string, isFavorite: boolean): Promise<Project>
  abstract archiveProject(projectId: string, isArchived: boolean): Promise<Project>
}
