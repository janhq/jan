import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProxyConfig } from '../useProxyConfig'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    settingProxyConfig: 'proxy-config-settings',
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

describe('useProxyConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to defaults
    const store = useProxyConfig.getState()
    store.setProxyEnabled(false)
    store.setProxyUrl('')
    store.setProxyUsername('')
    store.setProxyPassword('')
    store.setProxyIgnoreSSL(false)
    store.setVerifyProxySSL(true)
    store.setVerifyProxyHostSSL(true)
    store.setVerifyPeerSSL(true)
    store.setVerifyHostSSL(true)
    store.setNoProxy('')
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useProxyConfig())

    expect(result.current.proxyEnabled).toBe(false)
    expect(result.current.proxyUrl).toBe('')
    expect(result.current.proxyUsername).toBe('')
    expect(result.current.proxyPassword).toBe('')
    expect(result.current.proxyIgnoreSSL).toBe(false)
    expect(result.current.verifyProxySSL).toBe(true)
    expect(result.current.verifyProxyHostSSL).toBe(true)
    expect(result.current.verifyPeerSSL).toBe(true)
    expect(result.current.verifyHostSSL).toBe(true)
    expect(result.current.noProxy).toBe('')
  })

  describe('setProxyEnabled', () => {
    it('should enable proxy', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setProxyEnabled(true)
      })

      expect(result.current.proxyEnabled).toBe(true)
    })

    it('should disable proxy', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setProxyEnabled(true)
      })
      expect(result.current.proxyEnabled).toBe(true)

      act(() => {
        result.current.setProxyEnabled(false)
      })
      expect(result.current.proxyEnabled).toBe(false)
    })
  })

  describe('setProxyUrl', () => {
    it('should set proxy URL', () => {
      const { result } = renderHook(() => useProxyConfig())

      const testUrls = [
        'http://proxy.example.com:8080',
        'https://secure-proxy.com:3128',
        'socks5://socks-proxy.com:1080',
        '',
      ]

      testUrls.forEach((url) => {
        act(() => {
          result.current.setProxyUrl(url)
        })

        expect(result.current.proxyUrl).toBe(url)
      })
    })
  })

  describe('setProxyUsername and setProxyPassword', () => {
    it('should set proxy credentials', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setProxyUsername('testuser')
        result.current.setProxyPassword('testpass123')
      })

      expect(result.current.proxyUsername).toBe('testuser')
      expect(result.current.proxyPassword).toBe('testpass123')
    })

    it('should handle empty credentials', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setProxyUsername('user')
        result.current.setProxyPassword('pass')
      })

      expect(result.current.proxyUsername).toBe('user')
      expect(result.current.proxyPassword).toBe('pass')

      act(() => {
        result.current.setProxyUsername('')
        result.current.setProxyPassword('')
      })

      expect(result.current.proxyUsername).toBe('')
      expect(result.current.proxyPassword).toBe('')
    })
  })

  describe('SSL verification settings', () => {
    it('should set proxyIgnoreSSL', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setProxyIgnoreSSL(true)
      })

      expect(result.current.proxyIgnoreSSL).toBe(true)

      act(() => {
        result.current.setProxyIgnoreSSL(false)
      })

      expect(result.current.proxyIgnoreSSL).toBe(false)
    })

    it('should set verifyProxySSL', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setVerifyProxySSL(false)
      })

      expect(result.current.verifyProxySSL).toBe(false)

      act(() => {
        result.current.setVerifyProxySSL(true)
      })

      expect(result.current.verifyProxySSL).toBe(true)
    })

    it('should set verifyProxyHostSSL', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setVerifyProxyHostSSL(false)
      })

      expect(result.current.verifyProxyHostSSL).toBe(false)
    })

    it('should set verifyPeerSSL', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setVerifyPeerSSL(false)
      })

      expect(result.current.verifyPeerSSL).toBe(false)
    })

    it('should set verifyHostSSL', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setVerifyHostSSL(false)
      })

      expect(result.current.verifyHostSSL).toBe(false)
    })
  })

  describe('setNoProxy', () => {
    it('should set no proxy list', () => {
      const { result } = renderHook(() => useProxyConfig())

      const noProxyValues = [
        'localhost,127.0.0.1',
        '*.local,192.168.*',
        '',
        'example.com,test.org,*.internal',
      ]

      noProxyValues.forEach((value) => {
        act(() => {
          result.current.setNoProxy(value)
        })

        expect(result.current.noProxy).toBe(value)
      })
    })
  })

  describe('complex proxy configuration scenarios', () => {
    it('should handle complete proxy setup', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setProxyEnabled(true)
        result.current.setProxyUrl('http://proxy.company.com:8080')
        result.current.setProxyUsername('employee123')
        result.current.setProxyPassword('securepass')
        result.current.setProxyIgnoreSSL(true)
        result.current.setVerifyProxySSL(false)
        result.current.setNoProxy('localhost,127.0.0.1,*.local')
      })

      expect(result.current.proxyEnabled).toBe(true)
      expect(result.current.proxyUrl).toBe('http://proxy.company.com:8080')
      expect(result.current.proxyUsername).toBe('employee123')
      expect(result.current.proxyPassword).toBe('securepass')
      expect(result.current.proxyIgnoreSSL).toBe(true)
      expect(result.current.verifyProxySSL).toBe(false)
      expect(result.current.noProxy).toBe('localhost,127.0.0.1,*.local')
    })

    it('should handle security-focused configuration', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setProxyEnabled(true)
        result.current.setProxyUrl('https://secure-proxy.com:443')
        result.current.setProxyIgnoreSSL(false)
        result.current.setVerifyProxySSL(true)
        result.current.setVerifyProxyHostSSL(true)
        result.current.setVerifyPeerSSL(true)
        result.current.setVerifyHostSSL(true)
      })

      // All SSL verification should be enabled for security
      expect(result.current.proxyIgnoreSSL).toBe(false)
      expect(result.current.verifyProxySSL).toBe(true)
      expect(result.current.verifyProxyHostSSL).toBe(true)
      expect(result.current.verifyPeerSSL).toBe(true)
      expect(result.current.verifyHostSSL).toBe(true)
    })

    it('should handle development/testing configuration', () => {
      const { result } = renderHook(() => useProxyConfig())

      act(() => {
        result.current.setProxyEnabled(true)
        result.current.setProxyUrl('http://localhost:3128')
        result.current.setProxyIgnoreSSL(true)
        result.current.setVerifyProxySSL(false)
        result.current.setVerifyProxyHostSSL(false)
        result.current.setVerifyPeerSSL(false)
        result.current.setVerifyHostSSL(false)
        result.current.setNoProxy('localhost,127.0.0.1,*.test,*.dev')
      })

      // SSL verification should be relaxed for development
      expect(result.current.proxyIgnoreSSL).toBe(true)
      expect(result.current.verifyProxySSL).toBe(false)
      expect(result.current.verifyProxyHostSSL).toBe(false)
      expect(result.current.verifyPeerSSL).toBe(false)
      expect(result.current.verifyHostSSL).toBe(false)
      expect(result.current.noProxy).toBe('localhost,127.0.0.1,*.test,*.dev')
    })
  })

  describe('state persistence', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useProxyConfig())
      const { result: result2 } = renderHook(() => useProxyConfig())

      act(() => {
        result1.current.setProxyEnabled(true)
        result1.current.setProxyUrl('http://test-proxy.com:8080')
        result1.current.setProxyUsername('testuser')
        result1.current.setProxyIgnoreSSL(true)
      })

      expect(result2.current.proxyEnabled).toBe(true)
      expect(result2.current.proxyUrl).toBe('http://test-proxy.com:8080')
      expect(result2.current.proxyUsername).toBe('testuser')
      expect(result2.current.proxyIgnoreSSL).toBe(true)
    })
  })

  describe('function existence', () => {
    it('should have all required setter functions', () => {
      const { result } = renderHook(() => useProxyConfig())

      expect(typeof result.current.setProxyEnabled).toBe('function')
      expect(typeof result.current.setProxyUrl).toBe('function')
      expect(typeof result.current.setProxyUsername).toBe('function')
      expect(typeof result.current.setProxyPassword).toBe('function')
      expect(typeof result.current.setProxyIgnoreSSL).toBe('function')
      expect(typeof result.current.setVerifyProxySSL).toBe('function')
      expect(typeof result.current.setVerifyProxyHostSSL).toBe('function')
      expect(typeof result.current.setVerifyPeerSSL).toBe('function')
      expect(typeof result.current.setVerifyHostSSL).toBe('function')
      expect(typeof result.current.setNoProxy).toBe('function')
    })
  })
})
