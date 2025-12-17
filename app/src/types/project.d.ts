interface Project {
  id: string
  object: string
  name: string
  instruction: string
  is_archived: boolean
  is_favorite: boolean
  archived_at: number
  created_at: number
  updated_at: number
}

interface ProjectsResponse {
  object: string
  data: Project[]
}

interface CreateProjectRequest {
  name: string
  instruction?: string
  is_favorite?: boolean
}

interface UpdateProjectRequest {
  name?: string
  instruction?: string
  is_favorite?: boolean
  is_archived?: boolean
}

interface DeleteProjectResponse {
  deleted: boolean
  id: string
  object: string
}
