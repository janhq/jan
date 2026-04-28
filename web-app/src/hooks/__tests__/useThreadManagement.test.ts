import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Mock useServiceHub
const mockGetProjects = vi.fn()
const mockAddProject = vi.fn()
const mockUpdateProject = vi.fn()
const mockDeleteProject = vi.fn()
const mockGetProjectById = vi.fn()
const mockDeleteThread = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    projects: () => ({
      getProjects: mockGetProjects,
      addProject: mockAddProject,
      updateProject: mockUpdateProject,
      deleteProject: mockDeleteProject,
      getProjectById: mockGetProjectById,
    }),
    threads: () => ({
      deleteThread: mockDeleteThread,
    }),
  }),
}))

// Mock useThreads
const mockUpdateThread = vi.fn()
const mockDeleteThreadState = vi.fn()
vi.mock('@/hooks/useThreads', () => ({
  useThreads: {
    getState: () => ({
      threads: {
        't1': { id: 't1', metadata: { project: { id: 'p1' } } },
        't2': { id: 't2', metadata: { project: { id: 'p1' } } },
        't3': { id: 't3', metadata: { project: { id: 'p2' } } },
      },
      updateThread: mockUpdateThread,
      deleteThread: mockDeleteThreadState,
    }),
  },
}))

import { useThreadManagement } from '../useThreadManagement'

// We need to get the underlying store for direct testing
// The hook wraps a zustand store with useEffect, so we test both
// Access the store directly for non-hook actions
const getStore = () => {
  // We can access store actions via the hook's return
  const { result } = renderHook(() => useThreadManagement())
  return result
}

describe('useThreadManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjects.mockResolvedValue([])
  })

  it('should load projects on mount', async () => {
    const projects = [{ id: 'p1', name: 'Project 1' }]
    mockGetProjects.mockResolvedValue(projects)

    const { result } = renderHook(() => useThreadManagement())

    await waitFor(() => {
      expect(result.current.folders).toEqual(projects)
    })
  })

  it('should handle error when syncing projects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetProjects.mockRejectedValue(new Error('Network error'))

    renderHook(() => useThreadManagement())

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Error syncing projects:', expect.any(Error))
    })
    consoleSpy.mockRestore()
  })

  it('should add a folder', async () => {
    const newFolder = { id: 'p-new', name: 'New Folder' }
    mockAddProject.mockResolvedValue(newFolder)
    mockGetProjects.mockResolvedValue([newFolder])

    const { result } = renderHook(() => useThreadManagement())

    let returned: any
    await act(async () => {
      returned = await result.current.addFolder('New Folder', 'assistant-1')
    })

    expect(mockAddProject).toHaveBeenCalledWith('New Folder', 'assistant-1')
    expect(returned).toEqual(newFolder)
    expect(result.current.folders).toEqual([newFolder])
  })

  it('should update a folder', async () => {
    const updated = [{ id: 'p1', name: 'Updated' }]
    mockUpdateProject.mockResolvedValue(undefined)
    mockGetProjects.mockResolvedValue(updated)

    const { result } = renderHook(() => useThreadManagement())

    await act(async () => {
      await result.current.updateFolder('p1', 'Updated', 'assistant-2')
    })

    expect(mockUpdateProject).toHaveBeenCalledWith('p1', 'Updated', 'assistant-2')
    expect(result.current.folders).toEqual(updated)
  })

  it('should delete a folder and update threads', async () => {
    mockDeleteProject.mockResolvedValue(undefined)
    mockGetProjects.mockResolvedValue([])

    const { result } = renderHook(() => useThreadManagement())

    await act(async () => {
      await result.current.deleteFolder('p1')
    })

    // Should update threads belonging to project p1
    expect(mockUpdateThread).toHaveBeenCalledTimes(2)
    expect(mockDeleteProject).toHaveBeenCalledWith('p1')
  })

  it('should delete a folder with threads', async () => {
    mockDeleteThread.mockResolvedValue(undefined)
    mockDeleteProject.mockResolvedValue(undefined)
    mockGetProjects.mockResolvedValue([])

    const { result } = renderHook(() => useThreadManagement())

    await act(async () => {
      await result.current.deleteFolderWithThreads('p1')
    })

    // Should delete backend threads for project p1
    expect(mockDeleteThread).toHaveBeenCalledWith('t1')
    expect(mockDeleteThread).toHaveBeenCalledWith('t2')
    expect(mockDeleteThreadState).toHaveBeenCalledWith('t1')
    expect(mockDeleteThreadState).toHaveBeenCalledWith('t2')
    expect(mockDeleteProject).toHaveBeenCalledWith('p1')
  })

  it('should get folder by id', async () => {
    const folders = [
      { id: 'p1', name: 'Project 1' },
      { id: 'p2', name: 'Project 2' },
    ]
    mockGetProjects.mockResolvedValue(folders)

    const { result } = renderHook(() => useThreadManagement())

    await waitFor(() => {
      expect(result.current.folders).toEqual(folders)
    })

    expect(result.current.getFolderById('p1')).toEqual(folders[0])
    expect(result.current.getFolderById('nonexistent')).toBeUndefined()
  })

  it('should get project by id from service', async () => {
    const project = { id: 'p1', name: 'Project 1' }
    mockGetProjectById.mockResolvedValue(project)

    const { result } = renderHook(() => useThreadManagement())

    let returned: any
    await act(async () => {
      returned = await result.current.getProjectById('p1')
    })

    expect(mockGetProjectById).toHaveBeenCalledWith('p1')
    expect(returned).toEqual(project)
  })

  it('should set folders directly', async () => {
    const { result } = renderHook(() => useThreadManagement())

    const newFolders = [{ id: 'p1', name: 'F1' }]
    act(() => {
      result.current.setFolders(newFolders as any)
    })

    expect(result.current.folders).toEqual(newFolders)
  })
})
