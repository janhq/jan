import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  factoryReset,
  readLogs,
  parseLogLine,
  getJanDataFolder,
  relocateJanDataFolder,
} from '../app'

// Mock dependencies
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
}))

vi.mock('../models', () => ({
  stopAllModels: vi.fn(),
}))

vi.mock('@janhq/core', () => ({
  fs: {
    rm: vi.fn(),
  },
}))

// Mock the global window object
const mockWindow = {
  core: {
    api: {
      installExtensions: vi.fn(),
      relaunch: vi.fn(),
      getAppConfigurations: vi.fn(),
      changeAppDataFolder: vi.fn(),
    },
  },
  localStorage: {
    clear: vi.fn(),
  },
}

Object.defineProperty(window, 'core', {
  value: mockWindow.core,
  writable: true,
})

Object.defineProperty(window, 'localStorage', {
  value: mockWindow.localStorage,
  writable: true,
})

describe('app service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseLogLine', () => {
    it('should parse valid log line', () => {
      const logLine = '[2024-01-01][10:00:00Z][target][INFO] Test message'
      const result = parseLogLine(logLine)

      expect(result).toEqual({
        timestamp: '2024-01-01 10:00:00Z',
        level: 'info',
        target: 'target',
        message: 'Test message',
      })
    })

    it('should handle invalid log line format', () => {
      const logLine = 'Invalid log line'
      const result = parseLogLine(logLine)

      expect(result.message).toBe('Invalid log line')
      expect(result.level).toBe('info')
      expect(result.target).toBe('info')
      expect(typeof result.timestamp).toBe('number')
    })
  })

  describe('readLogs', () => {
    it('should read and parse logs', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockLogs =
        '[2024-01-01][10:00:00Z][target][INFO] Test message\n[2024-01-01][10:01:00Z][target][ERROR] Error message'
      vi.mocked(invoke).mockResolvedValue(mockLogs)

      const result = await readLogs()

      expect(invoke).toHaveBeenCalledWith('read_logs')
      expect(result).toHaveLength(2)
      expect(result[0].message).toBe('Test message')
      expect(result[1].message).toBe('Error message')
    })

    it('should handle empty logs', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue('')

      const result = await readLogs()

      expect(result).toEqual([expect.objectContaining({ message: '' })])
    })
  })

  describe('getJanDataFolder', () => {
    it('should get jan data folder path', async () => {
      const mockConfig = { data_folder: '/path/to/jan/data' }
      mockWindow.core.api.getAppConfigurations.mockResolvedValue(mockConfig)

      const result = await getJanDataFolder()

      expect(mockWindow.core.api.getAppConfigurations).toHaveBeenCalled()
      expect(result).toBe('/path/to/jan/data')
    })
  })

  describe('relocateJanDataFolder', () => {
    it('should relocate jan data folder', async () => {
      const newPath = '/new/path/to/jan/data'
      mockWindow.core.api.changeAppDataFolder.mockResolvedValue(undefined)

      await relocateJanDataFolder(newPath)

      expect(mockWindow.core.api.changeAppDataFolder).toHaveBeenCalledWith({
        newDataFolder: newPath,
      })
    })
  })

  describe('factoryReset', () => {
    it('should perform factory reset', async () => {
      const { stopAllModels } = await import('../models')
      const { invoke } = await import('@tauri-apps/api/core')

      vi.mocked(stopAllModels).mockResolvedValue()

      // Use fake timers
      vi.useFakeTimers()

      const factoryResetPromise = factoryReset()

      // Advance timers and run all pending timers
      await vi.advanceTimersByTimeAsync(1000)

      await factoryResetPromise

      expect(stopAllModels).toHaveBeenCalled()
      expect(mockWindow.localStorage.clear).toHaveBeenCalled()
      expect(invoke).toHaveBeenCalledWith('factory_reset')

      vi.useRealTimers()
    })
  })
})
