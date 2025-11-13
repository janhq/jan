/**
 * Project Management Types
 * Types for project/folder management operations
 */

/**
 * Project object
 */
export interface Project {
  /** Unique identifier */
  id: string
  /** Object type */
  object: 'project'
  /** Project name */
  name: string
  /** Optional instruction/description for the project */
  instruction?: string
  /** Whether the project is marked as favorite */
  is_favorite: boolean
  /** Whether the project is archived */
  is_archived: boolean
  /** Timestamp when project was archived (if applicable) */
  archived_at?: number
  /** Creation timestamp (number) */
  created_at: number
  /** Last update timestamp (number) */
  updated_at: number
}

/**
 * Request payload for creating a new project
 */
export interface CreateProjectRequest {
  /** Project name */
  name: string
  /** Optional instruction/description for the project */
  instruction?: string
}

/**
 * Request payload for updating an existing project
 */
export interface UpdateProjectRequest {
  /** Updated project name */
  name?: string
  /** Updated instruction/description */
  instruction?: string
  /** Update favorite status */
  is_favorite?: boolean
  /** Update archived status */
  is_archived?: boolean
}

/**
 * Parameters for listing projects
 */
export interface ListProjectsParams {
  /** Maximum number of projects to return */
  limit?: number
  /** Cursor for pagination */
  cursor?: string
}

/**
 * Response for listing projects
 */
export interface ListProjectsResponse {
  /** Object type */
  object: 'list'
  /** Array of projects */
  data: Project[]
  /** ID of first item */
  first_id?: string
  /** ID of last item */
  last_id?: string
  /** Cursor for next page */
  next_cursor?: string
  /** Whether there are more items */
  has_more: boolean
  /** Total number of projects */
  total: number
}

/**
 * Response for deleting a project
 */
export interface DeleteProjectResponse {
  /** Project ID that was deleted */
  id: string
  /** Object type */
  object: 'project'
  /** Whether deletion was successful */
  deleted: boolean
}

/**
 * Project Extension Interface
 * Defines methods for project management operations
 */
export interface ProjectInterface {
  /**
   * Get all projects
   */
  getAllProjects(): Promise<Project[]>

  /**
   * Create a new project
   * @param data Project creation request
   */
  createProject(data: CreateProjectRequest): Promise<Project>

  /**
   * Get a project by ID
   * @param projectId Project identifier
   */
  getProject(projectId: string): Promise<Project | null>

  /**
   * Update a project
   * @param projectId Project identifier
   * @param data Project update request
   */
  updateProject(projectId: string, data: UpdateProjectRequest): Promise<Project>

  /**
   * Delete a project
   * @param projectId Project identifier
   */
  deleteProject(projectId: string): Promise<void>

  /**
   * List projects with pagination
   * @param params List parameters
   */
  listProjects(params?: ListProjectsParams): Promise<ListProjectsResponse>

  /**
   * Mark a project as favorite
   * @param projectId Project identifier
   * @param isFavorite Whether to favorite or unfavorite
   */
  favoriteProject(projectId: string, isFavorite: boolean): Promise<Project>

  /**
   * Archive or unarchive a project
   * @param projectId Project identifier
   * @param isArchived Whether to archive or unarchive
   */
  archiveProject(projectId: string, isArchived: boolean): Promise<Project>
}
