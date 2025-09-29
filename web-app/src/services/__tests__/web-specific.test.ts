import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('Web-Specific Service Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  describe('WebThemeService', () => {
    it('should set theme by modifying DOM attributes', async () => {
      const { WebThemeService } = await import('../theme/web')
      
      // Mock document.documentElement
      const mockSetAttribute = vi.fn()
      const mockRemoveAttribute = vi.fn()
      Object.defineProperty(document, 'documentElement', {
        value: {
          setAttribute: mockSetAttribute,
          removeAttribute: mockRemoveAttribute
        }
      })

      const service = new WebThemeService()
      await service.setTheme('dark')
      
      expect(mockSetAttribute).toHaveBeenCalledWith('data-theme', 'dark')

      await service.setTheme(null)
      expect(mockRemoveAttribute).toHaveBeenCalledWith('data-theme')
    })

    it('should provide getCurrentWindow method', async () => {
      const { WebThemeService } = await import('../theme/web')
      const service = new WebThemeService()
      
      const currentWindow = service.getCurrentWindow()
      expect(typeof currentWindow.setTheme).toBe('function')
    })
  })

  describe('WebProvidersService', () => {
    it('should use browser fetch for API calls', async () => {
      // Mock the dependencies before importing
      vi.mock('token.js', () => ({
        models: {}
      }))
      vi.mock('@/lib/extension', () => ({
        ExtensionManager: {
          getInstance: vi.fn(() => ({
            getEngine: vi.fn()
          }))
        }
      }))
      vi.mock('@janhq/core', () => ({
        EngineManager: {
          instance: vi.fn(() => ({
            engines: new Map()
          }))
        }
      }))

      const { WebProvidersService } = await import('../providers/web')
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [{ id: 'gpt-4' }] })
      }
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

      const service = new WebProvidersService()
      const provider = {
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        api_key: 'test-key'
      }

      const models = await service.fetchModelsFromProvider(provider)

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/models',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      )
      expect(models).toEqual(['gpt-4'])
    }, 10000) // Increase timeout to 10 seconds
  })

  describe('WebAppService', () => {
    it('should handle web-specific app operations', async () => {
      const { WebAppService } = await import('../app/web')
      
      const service = new WebAppService()
      
      // Test basic service methods exist
      expect(typeof service.getJanDataFolder).toBe('function')
      expect(typeof service.factoryReset).toBe('function')
    })
  })
})