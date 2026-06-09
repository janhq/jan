import { describe, it, expect } from 'vitest'
import {
  basenameFromPath,
  findFolderByDirectoryPath,
  getProjectDirectoryPath,
  getProjectDisplayName,
  normalizeProjectPath,
} from '../project-folders'
import type { ThreadFolder } from '@/services/projects/types'

describe('project-folders', () => {
  const folder: ThreadFolder = {
    id: 'p1',
    name: 'legacy-name',
    updated_at: 1,
    directoryPath: '/Users/dev/jan',
  }

  it('normalizes windows-style paths', () => {
    expect(normalizeProjectPath('C:\\dev\\jan\\')).toBe('C:/dev/jan')
  })

  it('derives basename from path', () => {
    expect(basenameFromPath('/Users/dev/jan/')).toBe('jan')
  })

  it('prefers directoryPath over workspace store entry', () => {
    const directories = { 'project:p1': '/other/path' }
    expect(getProjectDirectoryPath(folder, directories)).toBe('/Users/dev/jan')
    expect(getProjectDisplayName(folder, directories)).toBe('jan')
  })

  it('falls back to workspace store and legacy name', () => {
    const legacy: ThreadFolder = {
      id: 'p2',
      name: 'legacy-name',
      updated_at: 1,
    }
    const directories = { 'project:p2': '/repos/demo-app' }
    expect(getProjectDirectoryPath(legacy, directories)).toBe('/repos/demo-app')
    expect(getProjectDisplayName(legacy, directories)).toBe('demo-app')
    expect(getProjectDisplayName(legacy, {})).toBe('legacy-name')
  })

  it('finds folders by normalized directory path', () => {
    const folders = [folder]
    const directories = {}
    expect(
      findFolderByDirectoryPath(folders, directories, '/Users/dev/jan/')
    ).toBe(folder)
  })
})