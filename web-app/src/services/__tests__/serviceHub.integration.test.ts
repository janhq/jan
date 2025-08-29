import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initializeServiceHub, type ServiceHub } from '../index'
import { isPlatformTauri } from '@/lib/platform/utils'

// Mock platform detection
vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: vi.fn().mockReturnValue(false)
}))

// Mock @jan/extensions-web to return empty extensions for testing
vi.mock('@jan/extensions-web', () => ({
  WEB_EXTENSIONS: {}
}))

// Mock console to avoid noise in tests
vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

describe('ServiceHub Integration Tests', () => {
  let serviceHub: ServiceHub

  beforeEach(async () => {
    vi.clearAllMocks()
    serviceHub = await initializeServiceHub()
  })

  describe('ServiceHub Initialization', () => {
    it('should initialize with web services when not on Tauri', async () => {
      vi.mocked(isPlatformTauri).mockReturnValue(false)

      serviceHub = await initializeServiceHub()

      expect(serviceHub).toBeDefined()
      expect(console.log).toHaveBeenCalledWith(
        'Initializing service hub for platform:',
        'Web'
      )
    })

    it('should initialize with Tauri services when on Tauri', async () => {
      vi.mocked(isPlatformTauri).mockReturnValue(true)

      serviceHub = await initializeServiceHub()

      expect(serviceHub).toBeDefined()
      expect(console.log).toHaveBeenCalledWith(
        'Initializing service hub for platform:',
        'Tauri'
      )
    })
  })

  describe('Service Access', () => {
    it('should provide access to all required services', () => {
      const services = [
        'theme', 'window', 'events', 'hardware', 'app', 'analytic',
        'messages', 'mcp', 'threads', 'providers', 'models', 'assistants',
        'dialog', 'opener', 'updater', 'path', 'core', 'deeplink'
      ]

      services.forEach(serviceName => {
        expect(typeof serviceHub[serviceName as keyof ServiceHub]).toBe('function')
        expect(serviceHub[serviceName as keyof ServiceHub]()).toBeDefined()
      })
    })

    it('should return same service instance on multiple calls', () => {
      const themeService1 = serviceHub.theme()
      const themeService2 = serviceHub.theme()
      
      expect(themeService1).toBe(themeService2)
    })
  })

  describe('Basic Service Functionality', () => {
    it('should have working theme service', () => {
      const theme = serviceHub.theme()
      
      expect(typeof theme.setTheme).toBe('function')
      expect(typeof theme.getCurrentWindow).toBe('function')
    })

    it('should have working events service', () => {
      const events = serviceHub.events()
      
      expect(typeof events.emit).toBe('function')
      expect(typeof events.listen).toBe('function')
    })

  })
})