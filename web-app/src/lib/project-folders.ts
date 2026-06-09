import type { ThreadFolder } from '@/services/projects/types'
import {
  getWorkspaceDirectoryKey,
  type WorkspaceDirectoryScope,
} from '@/stores/workspace-directory-store'

export function basenameFromPath(path: string): string {
  const trimmed = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = trimmed.split('/')
  return parts[parts.length - 1] || path
}

export function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function projectScope(folder: ThreadFolder): WorkspaceDirectoryScope {
  return {
    type: 'project',
    id: folder.id,
    label: folder.name,
  }
}

export function getProjectDirectoryPath(
  project: ThreadFolder,
  directories: Record<string, string>
): string | undefined {
  if (project.directoryPath) {
    return normalizeProjectPath(project.directoryPath)
  }
  return directories[getWorkspaceDirectoryKey(projectScope(project))]
}

export function getProjectDisplayName(
  project: ThreadFolder,
  directories: Record<string, string>
): string {
  const path = getProjectDirectoryPath(project, directories)
  return path ? basenameFromPath(path) : project.name
}

export function findFolderByDirectoryPath(
  folders: ThreadFolder[],
  directories: Record<string, string>,
  path: string
): ThreadFolder | undefined {
  const normalized = normalizeProjectPath(path)
  return folders.find((folder) => {
    const folderPath = getProjectDirectoryPath(folder, directories)
    return folderPath ? normalizeProjectPath(folderPath) === normalized : false
  })
}