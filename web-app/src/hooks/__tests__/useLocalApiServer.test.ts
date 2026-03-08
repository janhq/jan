import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalApiServer } from '../useLocalApiServer'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    settingLocalApiServer: 'local-api-server-settings',
  },
}))

// Mock zustand persist
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

describe('useLocalApiServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to defaults
    const store = useLocalApiServer.getState()
    store.setEnableOnStartup(true)
    store.setServerHost('127.0.0.1')
    store.setServerPort(1337)
    store.setApiPrefix('/v1')
    store.setCorsEnabled(true)
    store.setVerboseLogs(true)
    store.setTrustedHosts([])
    store.setApiKey('')
    store.setProxyTimeout(600)
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useLocalApiServer())

    expect(result.current.enableOnStartup).toBe(true)
    expect(result.current.serverHost).toBe('127.0.0.1')
    expect(result.current.serverPort).toBe(1337)
    expect(result.current.apiPrefix).toBe('/v1')
    expect(result.current.corsEnabled).toBe(true)
    expect(result.current.verboseLogs).toBe(true)
    expect(result.current.trustedHosts).toEqual([])
    expect(result.current.apiKey).toBe('')
    expect(result.current.proxyTimeout).toBe(600)
  })

  describe('enableOnStartup', () => {
    it('should set run on startup', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setEnableOnStartup(false)
      })

      expect(result.current.enableOnStartup).toBe(false)

      act(() => {
        result.current.setEnableOnStartup(true)
      })

      expect(result.current.enableOnStartup).toBe(true)
    })
  })

  describe('serverHost', () => {
    it('should set server host to localhost', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setServerHost('127.0.0.1')
      })

      expect(result.current.serverHost).toBe('127.0.0.1')
    })

    it('should set server host to all interfaces', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setServerHost('0.0.0.0')
      })

      expect(result.current.serverHost).toBe('0.0.0.0')
    })
  })

  describe('serverPort', () => {
    it('should set server port', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setServerPort(8080)
      })

      expect(result.current.serverPort).toBe(8080)
    })

    it('should handle different port numbers', () => {
      const { result } = renderHook(() => useLocalApiServer())

      const testPorts = [3000, 8000, 9090, 5000]

      testPorts.forEach((port) => {
        act(() => {
          result.current.setServerPort(port)
        })

        expect(result.current.serverPort).toBe(port)
      })
    })
  })

  describe('apiPrefix', () => {
    it('should set API prefix', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setApiPrefix('/api/v2')
      })

      expect(result.current.apiPrefix).toBe('/api/v2')
    })

    it('should handle different API prefixes', () => {
      const { result } = renderHook(() => useLocalApiServer())

      const testPrefixes = ['/api', '/v2', '/openai', '']

      testPrefixes.forEach((prefix) => {
        act(() => {
          result.current.setApiPrefix(prefix)
        })

        expect(result.current.apiPrefix).toBe(prefix)
      })
    })
  })

  describe('corsEnabled', () => {
    it('should toggle CORS enabled', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setCorsEnabled(false)
      })

      expect(result.current.corsEnabled).toBe(false)

      act(() => {
        result.current.setCorsEnabled(true)
      })

      expect(result.current.corsEnabled).toBe(true)
    })
  })

  describe('verboseLogs', () => {
    it('should toggle verbose logs', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setVerboseLogs(false)
      })

      expect(result.current.verboseLogs).toBe(false)

      act(() => {
        result.current.setVerboseLogs(true)
      })

      expect(result.current.verboseLogs).toBe(true)
    })
  })

  describe('apiKey', () => {
    it('should set API key', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setApiKey('test-api-key-123')
      })

      expect(result.current.apiKey).toBe('test-api-key-123')
    })

    it('should handle empty API key', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setApiKey('some-key')
      })

      expect(result.current.apiKey).toBe('some-key')

      act(() => {
        result.current.setApiKey('')
      })

      expect(result.current.apiKey).toBe('')
    })
  })

  describe('trustedHosts', () => {
    it('should add trusted host', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.addTrustedHost('example.com')
      })

      expect(result.current.trustedHosts).toEqual(['example.com'])

      act(() => {
        result.current.addTrustedHost('api.example.com')
      })

      expect(result.current.trustedHosts).toEqual(['example.com', 'api.example.com'])
    })

    it('should remove trusted host', () => {
      const { result } = renderHook(() => useLocalApiServer())

      // Add some hosts first
      act(() => {
        result.current.addTrustedHost('example.com')
        result.current.addTrustedHost('api.example.com')
        result.current.addTrustedHost('test.com')
      })

      expect(result.current.trustedHosts).toEqual(['example.com', 'api.example.com', 'test.com'])

      // Remove middle host
      act(() => {
        result.current.removeTrustedHost('api.example.com')
      })

      expect(result.current.trustedHosts).toEqual(['example.com', 'test.com'])

      // Remove first host
      act(() => {
        result.current.removeTrustedHost('example.com')
      })

      expect(result.current.trustedHosts).toEqual(['test.com'])

      // Remove last host
      act(() => {
        result.current.removeTrustedHost('test.com')
      })

      expect(result.current.trustedHosts).toEqual([])
    })

    it('should handle removing non-existent host', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.addTrustedHost('example.com')
      })

      expect(result.current.trustedHosts).toEqual(['example.com'])

      act(() => {
        result.current.removeTrustedHost('nonexistent.com')
      })

      expect(result.current.trustedHosts).toEqual(['example.com'])
    })

    it('should set trusted hosts directly', () => {
      const { result } = renderHook(() => useLocalApiServer())

      const newHosts = ['host1.com', 'host2.com', 'host3.com']

      act(() => {
        result.current.setTrustedHosts(newHosts)
      })

      expect(result.current.trustedHosts).toEqual(newHosts)
    })

    it('should replace existing trusted hosts when setting new ones', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.addTrustedHost('old-host.com')
      })

      expect(result.current.trustedHosts).toEqual(['old-host.com'])

      const newHosts = ['new-host1.com', 'new-host2.com']

      act(() => {
        result.current.setTrustedHosts(newHosts)
      })

      expect(result.current.trustedHosts).toEqual(newHosts)
    })

    it('should handle empty trusted hosts array', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.addTrustedHost('example.com')
      })

      expect(result.current.trustedHosts).toEqual(['example.com'])

      act(() => {
        result.current.setTrustedHosts([])
      })

      expect(result.current.trustedHosts).toEqual([])
    })
  })

  describe('proxyTimeout', () => {
    it('should set proxy timeout', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setProxyTimeout(1800)
      })

      expect(result.current.proxyTimeout).toBe(1800)
    })

    it('should handle different proxy timeouts', () => {
      const { result } = renderHook(() => useLocalApiServer())

      const testTimeouts = [100, 300, 600, 3600]

      testTimeouts.forEach((timeout) => {
        act(() => {
          result.current.setProxyTimeout(timeout)
        })

        expect(result.current.proxyTimeout).toBe(timeout)
      })
    })
  })

  describe('state persistence', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useLocalApiServer())
      const { result: result2 } = renderHook(() => useLocalApiServer())

      act(() => {
        result1.current.setEnableOnStartup(false)
        result1.current.setServerHost('0.0.0.0')
        result1.current.setServerPort(8080)
        result1.current.setApiPrefix('/api')
        result1.current.setCorsEnabled(false)
        result1.current.setVerboseLogs(false)
        result1.current.setApiKey('test-key')
        result1.current.addTrustedHost('example.com')
        result1.current.setProxyTimeout(1800)
      })

      expect(result2.current.enableOnStartup).toBe(false)
      expect(result2.current.serverHost).toBe('0.0.0.0')
      expect(result2.current.serverPort).toBe(8080)
      expect(result2.current.apiPrefix).toBe('/api')
      expect(result2.current.corsEnabled).toBe(false)
      expect(result2.current.verboseLogs).toBe(false)
      expect(result2.current.apiKey).toBe('test-key')
      expect(result2.current.trustedHosts).toEqual(['example.com'])
      expect(result2.current.proxyTimeout).toBe(1800)
    })
  })

  describe('complex state operations', () => {
    it('should handle multiple state changes in sequence', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setServerHost('0.0.0.0')
        result.current.setServerPort(3000)
        result.current.setApiPrefix('/openai')
        result.current.setCorsEnabled(false)
        result.current.addTrustedHost('localhost')
        result.current.addTrustedHost('127.0.0.1')
        result.current.setApiKey('sk-test-key')
        result.current.setProxyTimeout(800)
      })

      expect(result.current.serverHost).toBe('0.0.0.0')
      expect(result.current.serverPort).toBe(3000)
      expect(result.current.apiPrefix).toBe('/openai')
      expect(result.current.corsEnabled).toBe(false)
      expect(result.current.trustedHosts).toEqual(['localhost', '127.0.0.1'])
      expect(result.current.apiKey).toBe('sk-test-key')
      expect(result.current.proxyTimeout).toBe(800)
    })

    it('should preserve independent state changes', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setServerPort(9000)
      })

      expect(result.current.serverPort).toBe(9000)
      expect(result.current.serverHost).toBe('127.0.0.1') // Should remain default
      expect(result.current.apiPrefix).toBe('/v1') // Should remain default
      expect(result.current.proxyTimeout).toBe(600) // Should remain default

      act(() => {
        result.current.setProxyTimeout(400)
      })

      expect(result.current.proxyTimeout).toBe(400)
      expect(result.current.serverPort).toBe(9000) // Should remain default
      expect(result.current.serverHost).toBe('127.0.0.1') // Should remain default
      expect(result.current.apiPrefix).toBe('/v1') // Should remain default

      act(() => {
        result.current.addTrustedHost('example.com')
      })

      expect(result.current.trustedHosts).toEqual(['example.com'])
      expect(result.current.serverPort).toBe(9000) // Should remain changed
    })
  })

  describe('error handling scenarios', () => {
    it('should provide correct configuration for port conflict error messages', () => {
      const { result } = renderHook(() => useLocalApiServer())

      // Test common conflicting ports and verify they're stored correctly
      // These values will be used in error messages when port conflicts occur
      const conflictPorts = [
        { port: 80, expectedMessage: 'Port 80 is already in use' },
        { port: 443, expectedMessage: 'Port 443 is already in use' },
        { port: 3000, expectedMessage: 'Port 3000 is already in use' },
        { port: 8080, expectedMessage: 'Port 8080 is already in use' },
        { port: 11434, expectedMessage: 'Port 11434 is already in use' }
      ]

      conflictPorts.forEach(({ port, expectedMessage }) => {
        act(() => {
          result.current.setServerPort(port)
        })

        expect(result.current.serverPort).toBe(port)
        // Verify the port value that would be used in error message construction
        expect(`Port ${result.current.serverPort} is already in use`).toBe(expectedMessage)
      })
    })

    it('should validate API key requirements for error prevention', () => {
      const { result } = renderHook(() => useLocalApiServer())

      // Test empty API key - should trigger validation error
      act(() => {
        result.current.setApiKey('')
      })
      expect(result.current.apiKey).toBe('')
      expect(result.current.apiKey.trim().length === 0).toBe(true) // Would fail validation

      // Test whitespace only API key - should trigger validation error
      act(() => {
        result.current.setApiKey('   ')
      })
      expect(result.current.apiKey).toBe('   ')
      expect(result.current.apiKey.toString().trim().length === 0).toBe(true) // Would fail validation

      // Test valid API key - should pass validation
      act(() => {
        result.current.setApiKey('sk-valid-api-key-123')
      })
      expect(result.current.apiKey).toBe('sk-valid-api-key-123')
      expect(result.current.apiKey.toString().trim().length > 0).toBe(true) // Would pass validation
    })

    it('should configure trusted hosts for CORS error handling', () => {
      const { result } = renderHook(() => useLocalApiServer())

      // Add hosts that are commonly involved in CORS errors
      const corsRelatedHosts = ['localhost', '127.0.0.1', '0.0.0.0', 'example.com']

      corsRelatedHosts.forEach((host) => {
        act(() => {
          result.current.addTrustedHost(host)
        })
      })

      expect(result.current.trustedHosts).toEqual(corsRelatedHosts)
      expect(result.current.trustedHosts.length).toBe(4) // Verify count for error context

      // Test removing a critical host that might cause access errors
      act(() => {
        result.current.removeTrustedHost('127.0.0.1')
      })

      expect(result.current.trustedHosts).toEqual(['localhost', '0.0.0.0', 'example.com'])
      expect(result.current.trustedHosts.includes('127.0.0.1')).toBe(false) // Might cause localhost access errors
    })

    it('should configure timeout values that prevent timeout errors', () => {
      const { result } = renderHook(() => useLocalApiServer())

      // Test very short timeout - likely to cause timeout errors
      act(() => {
        result.current.setProxyTimeout(1)
      })
      expect(result.current.proxyTimeout).toBe(1)
      expect(result.current.proxyTimeout < 60).toBe(true) // Likely to timeout

      // Test reasonable timeout - should prevent timeout errors
      act(() => {
        result.current.setProxyTimeout(600)
      })
      expect(result.current.proxyTimeout).toBe(600)
      expect(result.current.proxyTimeout >= 600).toBe(true) // Should be sufficient

      // Test very long timeout - prevents timeout but might cause UX issues
      act(() => {
        result.current.setProxyTimeout(3600)
      })
      expect(result.current.proxyTimeout).toBe(3600)
      expect(result.current.proxyTimeout > 1800).toBe(true) // Very long timeout
    })

    it('should configure server host to prevent binding errors', () => {
      const { result } = renderHook(() => useLocalApiServer())

      // Test localhost binding - generally safe
      act(() => {
        result.current.setServerHost('127.0.0.1')
      })
      expect(result.current.serverHost).toBe('127.0.0.1')
      expect(result.current.serverHost === '127.0.0.1').toBe(true) // Localhost binding

      // Test all interfaces binding - might cause permission errors on some systems
      act(() => {
        result.current.setServerHost('0.0.0.0')
      })
      expect(result.current.serverHost).toBe('0.0.0.0')
      expect(result.current.serverHost === '0.0.0.0').toBe(true) // All interfaces binding (potential permission issues)

      // Verify host format for error message construction
      expect(result.current.serverHost.includes('.')).toBe(true) // Valid IP format
    })
  })

  describe('integration error scenarios', () => {
    it('should provide configuration data that matches error message patterns', () => {
      const { result } = renderHook(() => useLocalApiServer())

      // Set up configuration that would be used in actual error messages
      act(() => {
        result.current.setServerHost('127.0.0.1')
        result.current.setServerPort(8080)
        result.current.setApiKey('test-key')
      })

      // Verify values match what error handling expects
      const config = {
        host: result.current.serverHost,
        port: result.current.serverPort,
        apiKey: result.current.apiKey
      }

      expect(config.host).toBe('127.0.0.1')
      expect(config.port).toBe(8080)
      expect(config.apiKey).toBe('test-key')

      // These values would be used in error messages like:
      // "Failed to bind to 127.0.0.1:8080: Address already in use"
      // "Port 8080 is already in use. Please try a different port."
      const expectedErrorContext = `${config.host}:${config.port}`
      expect(expectedErrorContext).toBe('127.0.0.1:8080')
    })

    it('should detect invalid configurations that would cause startup errors', () => {
      const { result } = renderHook(() => useLocalApiServer())

      // Test configuration that would prevent server startup
      act(() => {
        result.current.setApiKey('') // Invalid - empty API key
        result.current.setServerPort(0) // Invalid - port 0
      })

      // Verify conditions that would trigger validation errors
      const hasValidApiKey = !!(result.current.apiKey && result.current.apiKey.toString().trim().length > 0)
      const hasValidPort = result.current.serverPort > 0 && result.current.serverPort <= 65535

      expect(hasValidApiKey).toBe(false) // Would trigger "Missing API key" error
      expect(hasValidPort).toBe(false) // Would trigger "Invalid port" error

      // Fix configuration
      act(() => {
        result.current.setApiKey('valid-key')
        result.current.setServerPort(3000)
      })

      const hasValidApiKeyFixed = !!(result.current.apiKey && result.current.apiKey.toString().trim().length > 0)
      const hasValidPortFixed = result.current.serverPort > 0 && result.current.serverPort <= 65535

      expect(hasValidApiKeyFixed).toBe(true) // Should pass validation
      expect(hasValidPortFixed).toBe(true) // Should pass validation
    })
  })

  describe('configuration validation', () => {
    it('should maintain consistent state for server configuration', () => {
      const { result } = renderHook(() => useLocalApiServer())

      // Set up a complete server configuration
      act(() => {
        result.current.setServerHost('127.0.0.1')
        result.current.setServerPort(8080)
        result.current.setApiPrefix('/api/v1')
        result.current.setApiKey('test-key-123')
        result.current.setTrustedHosts(['localhost', '127.0.0.1'])
        result.current.setProxyTimeout(300)
        result.current.setCorsEnabled(true)
        result.current.setVerboseLogs(false)
      })

      // Verify all settings are consistent
      expect(result.current.serverHost).toBe('127.0.0.1')
      expect(result.current.serverPort).toBe(8080)
      expect(result.current.apiPrefix).toBe('/api/v1')
      expect(result.current.apiKey).toBe('test-key-123')
      expect(result.current.trustedHosts).toEqual(['localhost', '127.0.0.1'])
      expect(result.current.proxyTimeout).toBe(300)
      expect(result.current.corsEnabled).toBe(true)
      expect(result.current.verboseLogs).toBe(false)
    })

    it('should handle edge cases in configuration values', () => {
      const { result } = renderHook(() => useLocalApiServer())

      // Test edge case: empty API prefix
      act(() => {
        result.current.setApiPrefix('')
      })
      expect(result.current.apiPrefix).toBe('')

      // Test edge case: API prefix without leading slash
      act(() => {
        result.current.setApiPrefix('v1')
      })
      expect(result.current.apiPrefix).toBe('v1')

      // Test edge case: minimum port number
      act(() => {
        result.current.setServerPort(1)
      })
      expect(result.current.serverPort).toBe(1)

      // Test edge case: maximum valid port number
      act(() => {
        result.current.setServerPort(65535)
      })
      expect(result.current.serverPort).toBe(65535)
    })
  })
})
