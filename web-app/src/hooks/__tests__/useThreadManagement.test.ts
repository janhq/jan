import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useThreadManagement } from '../useThreadManagement'

describe('useThreadManagement', () => {
  beforeEach(() => {
    // Reset the store state before each test
    const { result } = renderHook(() => useThreadManagement())
    act(() => {
      result.current.setFolders([])
    })
  })

  describe('addFolder', () => {
    it('adds a folder without system prompt', () => {
      const { result } = renderHook(() => useThreadManagement())

      act(() => {
        result.current.addFolder('Test Project')
      })

      expect(result.current.folders).toHaveLength(1)
      expect(result.current.folders[0].name).toBe('Test Project')
      expect(result.current.folders[0].id).toBeDefined()
      expect(result.current.folders[0].updated_at).toBeDefined()
      expect(result.current.folders[0].systemPrompt).toBeUndefined()
    })

    it('adds a folder with system prompt', () => {
      const { result } = renderHook(() => useThreadManagement())
      const systemPrompt = 'You are a helpful coding assistant'

      act(() => {
        result.current.addFolder('Coding Project', systemPrompt)
      })

      expect(result.current.folders).toHaveLength(1)
      expect(result.current.folders[0].name).toBe('Coding Project')
      expect(result.current.folders[0].systemPrompt).toBe(systemPrompt)
    })

    it('adds multiple folders with different system prompts', () => {
      const { result } = renderHook(() => useThreadManagement())

      act(() => {
        result.current.addFolder('Project 1', 'System prompt 1')
        result.current.addFolder('Project 2', 'System prompt 2')
        result.current.addFolder('Project 3')
      })

      expect(result.current.folders).toHaveLength(3)
      expect(result.current.folders[0].systemPrompt).toBe('System prompt 1')
      expect(result.current.folders[1].systemPrompt).toBe('System prompt 2')
      expect(result.current.folders[2].systemPrompt).toBeUndefined()
    })
  })

  describe('updateFolder', () => {
    it('updates folder name only', () => {
      const { result } = renderHook(() => useThreadManagement())

      act(() => {
        result.current.addFolder('Old Name', 'Original prompt')
      })

      const folderId = result.current.folders[0].id
      const originalUpdatedAt = result.current.folders[0].updated_at

      // Wait a bit to ensure updated_at changes
      act(() => {
        result.current.updateFolder(folderId, 'New Name')
      })

      expect(result.current.folders).toHaveLength(1)
      expect(result.current.folders[0].name).toBe('New Name')
      expect(result.current.folders[0].systemPrompt).toBeUndefined()
      expect(result.current.folders[0].updated_at).toBeGreaterThanOrEqual(originalUpdatedAt)
    })

    it('updates folder name and system prompt', () => {
      const { result } = renderHook(() => useThreadManagement())

      act(() => {
        result.current.addFolder('Project', 'Old prompt')
      })

      const folderId = result.current.folders[0].id

      act(() => {
        result.current.updateFolder(folderId, 'Updated Project', 'New prompt')
      })

      expect(result.current.folders[0].name).toBe('Updated Project')
      expect(result.current.folders[0].systemPrompt).toBe('New prompt')
    })

    it('updates only system prompt', () => {
      const { result } = renderHook(() => useThreadManagement())

      act(() => {
        result.current.addFolder('Project', 'Old prompt')
      })

      const folderId = result.current.folders[0].id

      act(() => {
        result.current.updateFolder(folderId, 'Project', 'Updated prompt')
      })

      expect(result.current.folders[0].name).toBe('Project')
      expect(result.current.folders[0].systemPrompt).toBe('Updated prompt')
    })

    it('removes system prompt when undefined is passed', () => {
      const { result } = renderHook(() => useThreadManagement())

      act(() => {
        result.current.addFolder('Project', 'Original prompt')
      })

      const folderId = result.current.folders[0].id

      expect(result.current.folders[0].systemPrompt).toBe('Original prompt')

      act(() => {
        result.current.updateFolder(folderId, 'Project', undefined)
      })

      expect(result.current.folders[0].systemPrompt).toBeUndefined()
    })

    it('does not update non-matching folders', () => {
      const { result } = renderHook(() => useThreadManagement())

      act(() => {
        result.current.addFolder('Project 1', 'Prompt 1')
        result.current.addFolder('Project 2', 'Prompt 2')
      })

      const folderId = result.current.folders[0].id

      act(() => {
        result.current.updateFolder(folderId, 'Updated Project 1', 'Updated Prompt 1')
      })

      expect(result.current.folders[0].name).toBe('Updated Project 1')
      expect(result.current.folders[0].systemPrompt).toBe('Updated Prompt 1')
      expect(result.current.folders[1].name).toBe('Project 2')
      expect(result.current.folders[1].systemPrompt).toBe('Prompt 2')
    })
  })

  describe('deleteFolder', () => {
    it('deletes a folder', () => {
      const { result } = renderHook(() => useThreadManagement())

      act(() => {
        result.current.addFolder('Test Project', 'Test prompt')
      })

      const folderId = result.current.folders[0].id

      expect(result.current.folders).toHaveLength(1)

      act(() => {
        result.current.deleteFolder(folderId)
      })

      expect(result.current.folders).toHaveLength(0)
    })
  })

  describe('getFolderById', () => {
    it('returns folder with system prompt', () => {
      const { result } = renderHook(() => useThreadManagement())

      act(() => {
        result.current.addFolder('Test Project', 'Test system prompt')
      })

      const folderId = result.current.folders[0].id
      const folder = result.current.getFolderById(folderId)

      expect(folder).toBeDefined()
      expect(folder?.name).toBe('Test Project')
      expect(folder?.systemPrompt).toBe('Test system prompt')
    })

    it('returns folder without system prompt', () => {
      const { result } = renderHook(() => useThreadManagement())

      act(() => {
        result.current.addFolder('Test Project')
      })

      const folderId = result.current.folders[0].id
      const folder = result.current.getFolderById(folderId)

      expect(folder).toBeDefined()
      expect(folder?.systemPrompt).toBeUndefined()
    })

    it('returns undefined for non-existent folder', () => {
      const { result } = renderHook(() => useThreadManagement())

      const folder = result.current.getFolderById('non-existent-id')

      expect(folder).toBeUndefined()
    })
  })

  describe('setFolders', () => {
    it('sets folders with system prompts', () => {
      const { result } = renderHook(() => useThreadManagement())

      const folders = [
        { id: '1', name: 'Folder 1', updated_at: Date.now(), systemPrompt: 'Prompt 1' },
        { id: '2', name: 'Folder 2', updated_at: Date.now(), systemPrompt: 'Prompt 2' },
        { id: '3', name: 'Folder 3', updated_at: Date.now() },
      ]

      act(() => {
        result.current.setFolders(folders)
      })

      expect(result.current.folders).toEqual(folders)
      expect(result.current.folders[0].systemPrompt).toBe('Prompt 1')
      expect(result.current.folders[1].systemPrompt).toBe('Prompt 2')
      expect(result.current.folders[2].systemPrompt).toBeUndefined()
    })
  })
})
