import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriPathService } from '../path/tauri'

// Mock the @tauri-apps/api/path module
const mockBasename = vi.fn()
const mockDirname = vi.fn()
const mockExtname = vi.fn()
const mockJoin = vi.fn()
const mockSep = vi.fn()

vi.mock('@tauri-apps/api/path', () => ({
  basename: (...args: any[]) => mockBasename(...args),
  dirname: (...args: any[]) => mockDirname(...args),
  extname: (...args: any[]) => mockExtname(...args),
  join: (...args: any[]) => mockJoin(...args),
  sep: (...args: any[]) => mockSep(...args),
}))

describe('TauriPathService', () => {
  let pathService: TauriPathService

  beforeEach(() => {
    pathService = new TauriPathService()
    vi.clearAllMocks()
  })

  describe('sep', () => {
    it('should return separator from Tauri API', () => {
      mockSep.mockReturnValue('/')
      const result = pathService.sep()
      expect(result).toBe('/')
    })

    it('should return default separator on error', () => {
      mockSep.mockImplementation(() => {
        throw new Error('Test error')
      })
      const result = pathService.sep()
      expect(result).toBe('/')
    })
  })

  describe('join', () => {
    it('should join path segments using Tauri API', async () => {
      mockJoin.mockResolvedValue('/path/to/file')
      const result = await pathService.join('path', 'to', 'file')
      expect(result).toBe('/path/to/file')
      expect(mockJoin).toHaveBeenCalledWith('path', 'to', 'file')
    })

    it('should fallback to slash joining on error', async () => {
      mockJoin.mockRejectedValue(new Error('Test error'))
      const result = await pathService.join('path', 'to', 'file')
      expect(result).toBe('path/to/file')
    })
  })

  describe('dirname', () => {
    it('should get directory name using Tauri API', async () => {
      mockDirname.mockResolvedValue('/path/to')
      const result = await pathService.dirname('/path/to/file.txt')
      expect(result).toBe('/path/to')
      expect(mockDirname).toHaveBeenCalledWith('/path/to/file.txt')
    })

    it('should fallback to manual dirname extraction on error', async () => {
      mockDirname.mockRejectedValue(new Error('Test error'))
      const result = await pathService.dirname('/path/to/file.txt')
      expect(result).toBe('/path/to')
    })

    it('should return dot for paths without directory', async () => {
      mockDirname.mockRejectedValue(new Error('Test error'))
      const result = await pathService.dirname('file.txt')
      expect(result).toBe('.')
    })
  })

  describe('basename', () => {
    it('should get basename using Tauri API for Unix paths', async () => {
      mockBasename.mockResolvedValue('file.txt')
      const result = await pathService.basename('/path/to/file.txt')
      expect(result).toBe('file.txt')
      expect(mockBasename).toHaveBeenCalledWith('/path/to/file.txt')
    })

    it('should fallback to manual extraction for Windows paths with backslashes', async () => {
      mockBasename.mockRejectedValue(new Error('Test error'))
      const result = await pathService.basename('C:\\Users\\John\\model.gguf')
      expect(result).toBe('model.gguf')
    })

    it('should handle mixed slashes in Windows paths in fallback', async () => {
      mockBasename.mockRejectedValue(new Error('Test error'))
      const result = await pathService.basename('C:\\Users/John\\Documents/model.gguf')
      expect(result).toBe('model.gguf')
    })

    it('should handle Unix paths in fallback', async () => {
      mockBasename.mockRejectedValue(new Error('Test error'))
      const result = await pathService.basename('/home/user/models/model.gguf')
      expect(result).toBe('model.gguf')
    })

    it('should return empty string for path ending with slash in fallback', async () => {
      mockBasename.mockRejectedValue(new Error('Test error'))
      const result = await pathService.basename('/path/to/directory/')
      expect(result).toBe('')
    })

    it('should return empty string for empty path in fallback', async () => {
      mockBasename.mockRejectedValue(new Error('Test error'))
      const result = await pathService.basename('')
      expect(result).toBe('')
    })

    it('should handle path with only filename in fallback', async () => {
      mockBasename.mockRejectedValue(new Error('Test error'))
      const result = await pathService.basename('model.gguf')
      expect(result).toBe('model.gguf')
    })

    it('should handle Windows drive letter paths in fallback', async () => {
      mockBasename.mockRejectedValue(new Error('Test error'))
      const result = await pathService.basename('D:\\model.gguf')
      expect(result).toBe('model.gguf')
    })

    it('should handle UNC paths in fallback', async () => {
      mockBasename.mockRejectedValue(new Error('Test error'))
      const result = await pathService.basename('\\\\server\\share\\folder\\file.txt')
      expect(result).toBe('file.txt')
    })

    it('should handle paths with spaces in fallback', async () => {
      mockBasename.mockRejectedValue(new Error('Test error'))
      const result = await pathService.basename('C:\\Program Files\\Jan\\my model.gguf')
      expect(result).toBe('my model.gguf')
    })

    it('should handle paths with special characters in fallback', async () => {
      mockBasename.mockRejectedValue(new Error('Test error'))
      const result = await pathService.basename('/path/to/model-v1.0_final (1).gguf')
      expect(result).toBe('model-v1.0_final (1).gguf')
    })
  })

  describe('extname', () => {
    it('should get file extension using Tauri API', async () => {
      mockExtname.mockResolvedValue('.txt')
      const result = await pathService.extname('/path/to/file.txt')
      expect(result).toBe('.txt')
      expect(mockExtname).toHaveBeenCalledWith('/path/to/file.txt')
    })

    it('should fallback to manual extension extraction on error', async () => {
      mockExtname.mockRejectedValue(new Error('Test error'))
      const result = await pathService.extname('/path/to/file.txt')
      expect(result).toBe('.txt')
    })

    it('should return empty string for files without extension in fallback', async () => {
      mockExtname.mockRejectedValue(new Error('Test error'))
      const result = await pathService.extname('/path/to/file')
      expect(result).toBe('')
    })

    it('should handle multiple dots in filename in fallback', async () => {
      mockExtname.mockRejectedValue(new Error('Test error'))
      const result = await pathService.extname('/path/to/archive.tar.gz')
      expect(result).toBe('.gz')
    })

    it('should return empty string when dot is before last slash in fallback', async () => {
      mockExtname.mockRejectedValue(new Error('Test error'))
      const result = await pathService.extname('/path.old/to/file')
      expect(result).toBe('')
    })
  })
})
