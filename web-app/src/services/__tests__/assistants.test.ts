import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultAssistantsService } from '../assistants/default'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum } from '@janhq/core'

// Mock the ExtensionManager
vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(() => ({
      get: vi.fn()
    }))
  }
}))

describe('DefaultAssistantsService', () => {
  let assistantsService: DefaultAssistantsService
  
  const mockExtension = {
    getAssistants: vi.fn(),
    createAssistant: vi.fn(),
    deleteAssistant: vi.fn()
  }

  const mockExtensionManager = {
    get: vi.fn()
  }

  beforeEach(() => {
    assistantsService = new DefaultAssistantsService()
    vi.clearAllMocks()
    vi.mocked(ExtensionManager.getInstance).mockReturnValue(mockExtensionManager)
    mockExtensionManager.get.mockReturnValue(mockExtension)
  })

  describe('getAssistants', () => {
    it('should fetch assistants successfully', async () => {
      const mockAssistants = [
        { id: 'assistant1', name: 'Assistant 1', description: 'First assistant' },
        { id: 'assistant2', name: 'Assistant 2', description: 'Second assistant' }
      ]
      mockExtension.getAssistants.mockResolvedValue(mockAssistants)

      const result = await assistantsService.getAssistants()

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Assistant)
      expect(mockExtension.getAssistants).toHaveBeenCalled()
      expect(result).toEqual(mockAssistants)
    })

    it('should return null when extension not found', async () => {
      mockExtensionManager.get.mockReturnValue(null)
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await assistantsService.getAssistants()

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Assistant)
      expect(consoleSpy).toHaveBeenCalledWith('AssistantExtension not found')
      expect(result).toBeNull()
      
      consoleSpy.mockRestore()
    })

    it('should handle error when getting assistants', async () => {
      const error = new Error('Failed to get assistants')
      mockExtension.getAssistants.mockRejectedValue(error)

      await expect(assistantsService.getAssistants()).rejects.toThrow('Failed to get assistants')
    })
  })

  describe('createAssistant', () => {
    it('should create assistant successfully', async () => {
      const assistant = { id: 'new-assistant', name: 'New Assistant', description: 'New assistant' }
      mockExtension.createAssistant.mockResolvedValue(assistant)

      const result = await assistantsService.createAssistant(assistant)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Assistant)
      expect(mockExtension.createAssistant).toHaveBeenCalledWith(assistant)
      expect(result).toBeUndefined()
    })

    it('should return undefined when extension not found', async () => {
      mockExtensionManager.get.mockReturnValue(null)
      const assistant = { id: 'new-assistant', name: 'New Assistant', description: 'New assistant' }

      const result = await assistantsService.createAssistant(assistant)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Assistant)
      expect(result).toBeUndefined()
    })

    it('should handle error when creating assistant', async () => {
      const assistant = { id: 'new-assistant', name: 'New Assistant', description: 'New assistant' }
      const error = new Error('Failed to create assistant')
      mockExtension.createAssistant.mockRejectedValue(error)

      await expect(assistantsService.createAssistant(assistant)).rejects.toThrow('Failed to create assistant')
    })
  })

  describe('deleteAssistant', () => {
    it('should delete assistant successfully', async () => {
      const assistant = { id: 'assistant-to-delete', name: 'Assistant to Delete', description: 'Delete me' }
      mockExtension.deleteAssistant.mockResolvedValue(undefined)

      const result = await assistantsService.deleteAssistant(assistant)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Assistant)
      expect(mockExtension.deleteAssistant).toHaveBeenCalledWith(assistant)
      expect(result).toBeUndefined()
    })

    it('should return undefined when extension not found', async () => {
      mockExtensionManager.get.mockReturnValue(null)
      const assistant = { id: 'assistant-to-delete', name: 'Assistant to Delete', description: 'Delete me' }

      const result = await assistantsService.deleteAssistant(assistant)

      expect(mockExtensionManager.get).toHaveBeenCalledWith(ExtensionTypeEnum.Assistant)
      expect(result).toBeUndefined()
    })

    it('should handle error when deleting assistant', async () => {
      const assistant = { id: 'assistant-to-delete', name: 'Assistant to Delete', description: 'Delete me' }
      const error = new Error('Failed to delete assistant')
      mockExtension.deleteAssistant.mockRejectedValue(error)

      await expect(assistantsService.deleteAssistant(assistant)).rejects.toThrow('Failed to delete assistant')
    })
  })
})