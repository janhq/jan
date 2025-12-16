import { fetchJsonWithAuth } from '@/lib/api-client'

declare const JAN_API_BASE_URL: string

export const projectService = {
  /**
   * Get all projects
   */
  getProjects: async (): Promise<ProjectsResponse> => {
    return fetchJsonWithAuth<ProjectsResponse>(`${JAN_API_BASE_URL}v1/projects`)
  },

  /**
   * Get a single project by ID
   */
  getProject: async (projectId: string): Promise<Project> => {
    return fetchJsonWithAuth<Project>(
      `${JAN_API_BASE_URL}v1/projects/${projectId}`
    )
  },

  /**
   * Create a new project
   */
  createProject: async (data: CreateProjectRequest): Promise<Project> => {
    return fetchJsonWithAuth<Project>(`${JAN_API_BASE_URL}v1/projects`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * Update an existing project
   */
  updateProject: async (
    projectId: string,
    data: UpdateProjectRequest
  ): Promise<Project> => {
    return fetchJsonWithAuth<Project>(
      `${JAN_API_BASE_URL}v1/projects/${projectId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
  },

  /**
   * Delete a project (soft delete)
   */
  deleteProject: async (projectId: string): Promise<DeleteProjectResponse> => {
    return fetchJsonWithAuth<DeleteProjectResponse>(
      `${JAN_API_BASE_URL}v1/projects/${projectId}`,
      {
        method: 'DELETE',
      }
    )
  },
}
