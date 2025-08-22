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
      })

      expect(result2.current.enableOnStartup).toBe(false)
      expect(result2.current.serverHost).toBe('0.0.0.0')
      expect(result2.current.serverPort).toBe(8080)
      expect(result2.current.apiPrefix).toBe('/api')
      expect(result2.current.corsEnabled).toBe(false)
      expect(result2.current.verboseLogs).toBe(false)
      expect(result2.current.apiKey).toBe('test-key')
      expect(result2.current.trustedHosts).toEqual(['example.com'])
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
      })

      expect(result.current.serverHost).toBe('0.0.0.0')
      expect(result.current.serverPort).toBe(3000)
      expect(result.current.apiPrefix).toBe('/openai')
      expect(result.current.corsEnabled).toBe(false)
      expect(result.current.trustedHosts).toEqual(['localhost', '127.0.0.1'])
      expect(result.current.apiKey).toBe('sk-test-key')
    })

    it('should preserve independent state changes', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => {
        result.current.setServerPort(9000)
      })

      expect(result.current.serverPort).toBe(9000)
      expect(result.current.serverHost).toBe('127.0.0.1') // Should remain default
      expect(result.current.apiPrefix).toBe('/v1') // Should remain default

      act(() => {
        result.current.addTrustedHost('example.com')
      })

      expect(result.current.trustedHosts).toEqual(['example.com'])
      expect(result.current.serverPort).toBe(9000) // Should remain changed
    })
  })
})