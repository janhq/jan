import { renderHook, act } from '@testing-library/react'
import { useDownloadStore } from '../useDownloadStore'

describe('useDownloadStore', () => {
  beforeEach(() => {
    // Reset the store before each test
    useDownloadStore.setState({
      downloads: {},
      localDownloadingModels: new Set(),
    })
  })

  describe('initial state', () => {
    it('should have empty downloads and localDownloadingModels', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      expect(result.current.downloads).toEqual({})
      expect(result.current.localDownloadingModels).toEqual(new Set())
    })
  })

  describe('updateProgress', () => {
    it('should add new download progress', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        result.current.updateProgress('test-id', 50, 'test-model', 500, 1000)
      })
      
      expect(result.current.downloads['test-id']).toEqual({
        name: 'test-model',
        progress: 50,
        current: 500,
        total: 1000,
      })
    })

    it('should update existing download progress', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      // Add initial download
      act(() => {
        result.current.updateProgress('test-id', 25, 'test-model', 250, 1000)
      })
      
      // Update progress
      act(() => {
        result.current.updateProgress('test-id', 75, undefined, 750)
      })
      
      expect(result.current.downloads['test-id']).toEqual({
        name: 'test-model',
        progress: 75,
        current: 750,
        total: 1000,
      })
    })

    it('should preserve existing values when not provided', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      // Add initial download
      act(() => {
        result.current.updateProgress('test-id', 25, 'test-model', 250, 1000)
      })
      
      // Update only progress
      act(() => {
        result.current.updateProgress('test-id', 75)
      })
      
      expect(result.current.downloads['test-id']).toEqual({
        name: 'test-model',
        progress: 75,
        current: 250,
        total: 1000,
      })
    })

    it('should use default values for new download when values not provided', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        result.current.updateProgress('test-id', 50)
      })
      
      expect(result.current.downloads['test-id']).toEqual({
        name: '',
        progress: 50,
        current: 0,
        total: 0,
      })
    })
  })

  describe('removeDownload', () => {
    it('should remove download from downloads object', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      // Add download
      act(() => {
        result.current.updateProgress('test-id', 50, 'test-model', 500, 1000)
      })
      
      expect(result.current.downloads['test-id']).toBeDefined()
      
      // Remove download
      act(() => {
        result.current.removeDownload('test-id')
      })
      
      expect(result.current.downloads['test-id']).toBeUndefined()
      expect(Object.keys(result.current.downloads)).toHaveLength(0)
    })

    it('should not affect other downloads when removing one', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      // Add multiple downloads
      act(() => {
        result.current.updateProgress('test-id-1', 50, 'model-1', 500, 1000)
        result.current.updateProgress('test-id-2', 75, 'model-2', 750, 1000)
      })
      
      expect(Object.keys(result.current.downloads)).toHaveLength(2)
      
      // Remove one download
      act(() => {
        result.current.removeDownload('test-id-1')
      })
      
      expect(result.current.downloads['test-id-1']).toBeUndefined()
      expect(result.current.downloads['test-id-2']).toBeDefined()
      expect(Object.keys(result.current.downloads)).toHaveLength(1)
    })

    it('should handle removing non-existent download gracefully', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      expect(() => {
        act(() => {
          result.current.removeDownload('non-existent-id')
        })
      }).not.toThrow()
      
      expect(result.current.downloads).toEqual({})
    })
  })

  describe('localDownloadingModels management', () => {
    it('should add model to localDownloadingModels', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        result.current.addLocalDownloadingModel('model-1')
      })
      
      expect(result.current.localDownloadingModels.has('model-1')).toBe(true)
    })

    it('should add multiple models to localDownloadingModels', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        result.current.addLocalDownloadingModel('model-1')
        result.current.addLocalDownloadingModel('model-2')
      })
      
      expect(result.current.localDownloadingModels.has('model-1')).toBe(true)
      expect(result.current.localDownloadingModels.has('model-2')).toBe(true)
      expect(result.current.localDownloadingModels.size).toBe(2)
    })

    it('should not add duplicate models to localDownloadingModels', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        result.current.addLocalDownloadingModel('model-1')
        result.current.addLocalDownloadingModel('model-1')
      })
      
      expect(result.current.localDownloadingModels.size).toBe(1)
    })

    it('should remove model from localDownloadingModels', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      // Add model first
      act(() => {
        result.current.addLocalDownloadingModel('model-1')
      })
      
      expect(result.current.localDownloadingModels.has('model-1')).toBe(true)
      
      // Remove model
      act(() => {
        result.current.removeLocalDownloadingModel('model-1')
      })
      
      expect(result.current.localDownloadingModels.has('model-1')).toBe(false)
      expect(result.current.localDownloadingModels.size).toBe(0)
    })

    it('should handle removing non-existent model gracefully', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      expect(() => {
        act(() => {
          result.current.removeLocalDownloadingModel('non-existent-model')
        })
      }).not.toThrow()
      
      expect(result.current.localDownloadingModels.size).toBe(0)
    })

    it('should not affect other models when removing one', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      // Add multiple models
      act(() => {
        result.current.addLocalDownloadingModel('model-1')
        result.current.addLocalDownloadingModel('model-2')
      })
      
      expect(result.current.localDownloadingModels.size).toBe(2)
      
      // Remove one model
      act(() => {
        result.current.removeLocalDownloadingModel('model-1')
      })
      
      expect(result.current.localDownloadingModels.has('model-1')).toBe(false)
      expect(result.current.localDownloadingModels.has('model-2')).toBe(true)
      expect(result.current.localDownloadingModels.size).toBe(1)
    })
  })

  describe('integration tests', () => {
    it('should work with both downloads and localDownloadingModels simultaneously', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        // Add download progress
        result.current.updateProgress('download-1', 50, 'model-1', 500, 1000)
        
        // Add local downloading model
        result.current.addLocalDownloadingModel('model-1')
      })
      
      expect(result.current.downloads['download-1']).toBeDefined()
      expect(result.current.localDownloadingModels.has('model-1')).toBe(true)
      
      act(() => {
        // Remove download but keep local downloading model
        result.current.removeDownload('download-1')
      })
      
      expect(result.current.downloads['download-1']).toBeUndefined()
      expect(result.current.localDownloadingModels.has('model-1')).toBe(true)
    })
  })
})
