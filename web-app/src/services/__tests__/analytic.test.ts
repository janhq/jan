import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultAnalyticService } from '../analytic/default'

// Mock window.core API
const mockGetAppConfigurations = vi.fn()
const mockUpdateAppConfiguration = vi.fn()

const mockCore = {
  api: {
    getAppConfigurations: mockGetAppConfigurations,
    updateAppConfiguration: mockUpdateAppConfiguration,
  },
}

// Setup global window mock
Object.defineProperty(window, 'core', {
  writable: true,
  value: mockCore,
})

describe('DefaultAnalyticService', () => {
  let analyticService: DefaultAnalyticService

  beforeEach(() => {
    vi.clearAllMocks()
    analyticService = new DefaultAnalyticService()
  })

  describe('updateDistinctId', () => {
    it('should update distinct id in app configuration', async () => {
      const mockConfiguration = {
        distinct_id: 'old-id',
        other_setting: 'value',
      }
      
      mockGetAppConfigurations.mockResolvedValue(mockConfiguration)
      mockUpdateAppConfiguration.mockResolvedValue(undefined)
      
      await analyticService.updateDistinctId('new-distinct-id')
      
      expect(mockGetAppConfigurations).toHaveBeenCalledTimes(1)
      expect(mockUpdateAppConfiguration).toHaveBeenCalledWith({
        configuration: {
          distinct_id: 'new-distinct-id',
          other_setting: 'value',
        },
      })
    })

    it('should handle when configuration has no existing distinct_id', async () => {
      const mockConfiguration = {
        other_setting: 'value',
      }
      
      mockGetAppConfigurations.mockResolvedValue(mockConfiguration)
      mockUpdateAppConfiguration.mockResolvedValue(undefined)
      
      await analyticService.updateDistinctId('first-distinct-id')
      
      expect(mockUpdateAppConfiguration).toHaveBeenCalledWith({
        configuration: {
          distinct_id: 'first-distinct-id',
          other_setting: 'value',
        },
      })
    })

    it('should handle empty string as distinct id', async () => {
      const mockConfiguration = {
        distinct_id: 'old-id',
      }
      
      mockGetAppConfigurations.mockResolvedValue(mockConfiguration)
      mockUpdateAppConfiguration.mockResolvedValue(undefined)
      
      await analyticService.updateDistinctId('')
      
      expect(mockUpdateAppConfiguration).toHaveBeenCalledWith({
        configuration: {
          distinct_id: '',
        },
      })
    })

    it('should handle UUID format distinct id', async () => {
      const mockConfiguration = {}
      const uuidId = '550e8400-e29b-41d4-a716-446655440000'
      
      mockGetAppConfigurations.mockResolvedValue(mockConfiguration)
      mockUpdateAppConfiguration.mockResolvedValue(undefined)
      
      await analyticService.updateDistinctId(uuidId)
      
      expect(mockUpdateAppConfiguration).toHaveBeenCalledWith({
        configuration: {
          distinct_id: uuidId,
        },
      })
    })

    it('should handle API errors gracefully', async () => {
      mockGetAppConfigurations.mockRejectedValue(new Error('API Error'))
      
      await expect(analyticService.updateDistinctId('test-id')).rejects.toThrow('API Error')
      expect(mockUpdateAppConfiguration).not.toHaveBeenCalled()
    })

    it('should handle update configuration errors', async () => {
      const mockConfiguration = { distinct_id: 'old-id' }
      
      mockGetAppConfigurations.mockResolvedValue(mockConfiguration)
      mockUpdateAppConfiguration.mockRejectedValue(new Error('Update Error'))
      
      await expect(analyticService.updateDistinctId('new-id')).rejects.toThrow('Update Error')
    })
  })

  describe('getAppDistinctId', () => {
    it('should return distinct id from app configuration', async () => {
      const mockConfiguration = {
        distinct_id: 'test-distinct-id',
        other_setting: 'value',
      }
      
      mockGetAppConfigurations.mockResolvedValue(mockConfiguration)
      
      const result = await analyticService.getAppDistinctId()
      
      expect(result).toBe('test-distinct-id')
      expect(mockGetAppConfigurations).toHaveBeenCalledTimes(1)
    })

    it('should return undefined when distinct_id is not set', async () => {
      const mockConfiguration = {
        other_setting: 'value',
      }
      
      mockGetAppConfigurations.mockResolvedValue(mockConfiguration)
      
      const result = await analyticService.getAppDistinctId()
      
      expect(result).toBeUndefined()
    })

    it('should return empty string if distinct_id is empty', async () => {
      const mockConfiguration = {
        distinct_id: '',
      }
      
      mockGetAppConfigurations.mockResolvedValue(mockConfiguration)
      
      const result = await analyticService.getAppDistinctId()
      
      expect(result).toBe('')
    })

    it('should handle null configuration', async () => {
      mockGetAppConfigurations.mockResolvedValue(null)
      
      await expect(analyticService.getAppDistinctId()).rejects.toThrow()
    })

    it('should handle undefined configuration', async () => {
      mockGetAppConfigurations.mockResolvedValue(undefined)
      
      await expect(analyticService.getAppDistinctId()).rejects.toThrow()
    })

    it('should handle API errors', async () => {
      mockGetAppConfigurations.mockRejectedValue(new Error('Get Config Error'))
      
      await expect(analyticService.getAppDistinctId()).rejects.toThrow('Get Config Error')
    })

    it('should handle different types of distinct_id values', async () => {
      // Test with UUID
      mockGetAppConfigurations.mockResolvedValue({
        distinct_id: '550e8400-e29b-41d4-a716-446655440000',
      })
      
      let result = await analyticService.getAppDistinctId()
      expect(result).toBe('550e8400-e29b-41d4-a716-446655440000')
      
      // Test with simple string
      mockGetAppConfigurations.mockResolvedValue({
        distinct_id: 'user123',
      })
      
      result = await analyticService.getAppDistinctId()
      expect(result).toBe('user123')
      
      // Test with numeric string
      mockGetAppConfigurations.mockResolvedValue({
        distinct_id: '12345',
      })
      
      result = await analyticService.getAppDistinctId()
      expect(result).toBe('12345')
    })
  })

  describe('integration tests', () => {
    it('should update and retrieve distinct id', async () => {
      const newId = 'integration-test-id'
      const mockConfiguration = { other_setting: 'value' }
      
      // Mock get configuration for update
      mockGetAppConfigurations.mockResolvedValueOnce(mockConfiguration)
      mockUpdateAppConfiguration.mockResolvedValue(undefined)
      
      // Mock get configuration for retrieval
      mockGetAppConfigurations.mockResolvedValueOnce({
        ...mockConfiguration,
        distinct_id: newId,
      })
      
      // Update the distinct id
      await analyticService.updateDistinctId(newId)
      
      // Retrieve the distinct id
      const retrievedId = await analyticService.getAppDistinctId()
      
      expect(retrievedId).toBe(newId)
      expect(mockGetAppConfigurations).toHaveBeenCalledTimes(2)
      expect(mockUpdateAppConfiguration).toHaveBeenCalledTimes(1)
    })
  })

  describe('edge cases', () => {
    it('should handle when window.core is undefined', async () => {
      const originalCore = window.core
      
      // Temporarily remove core
      Object.defineProperty(window, 'core', {
        writable: true,
        value: undefined,
      })
      
      await expect(analyticService.updateDistinctId('test')).rejects.toThrow()
      await expect(analyticService.getAppDistinctId()).rejects.toThrow()
      
      // Restore core
      Object.defineProperty(window, 'core', {
        writable: true,
        value: originalCore,
      })
    })

    it('should handle when window.core.api is undefined', async () => {
      const originalCore = window.core
      
      // Set core without api
      Object.defineProperty(window, 'core', {
        writable: true,
        value: {},
      })
      
      await expect(analyticService.updateDistinctId('test')).rejects.toThrow()
      await expect(analyticService.getAppDistinctId()).rejects.toThrow()
      
      // Restore core
      Object.defineProperty(window, 'core', {
        writable: true,
        value: originalCore,
      })
    })
  })
})