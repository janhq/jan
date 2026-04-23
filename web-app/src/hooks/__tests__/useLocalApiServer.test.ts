import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalApiServer } from '../useLocalApiServer'

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    settingLocalApiServer: 'local-api-server-settings',
  },
}))

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

  describe.each([
    ['enableOnStartup', 'setEnableOnStartup', false, true],
    ['corsEnabled', 'setCorsEnabled', false, true],
    ['verboseLogs', 'setVerboseLogs', false, true],
  ] as const)('%s toggle', (prop, setter, offVal, onVal) => {
    it(`should toggle ${prop}`, () => {
      const { result } = renderHook(() => useLocalApiServer())
      act(() => { (result.current as any)[setter](offVal) })
      expect((result.current as any)[prop]).toBe(offVal)
      act(() => { (result.current as any)[setter](onVal) })
      expect((result.current as any)[prop]).toBe(onVal)
    })
  })

  describe.each([
    ['serverHost', 'setServerHost', ['127.0.0.1', '0.0.0.0']],
    ['serverPort', 'setServerPort', [3000, 8000, 8080, 9090]],
    ['apiPrefix', 'setApiPrefix', ['/api', '/v2', '/openai', '']],
    ['proxyTimeout', 'setProxyTimeout', [100, 300, 600, 3600]],
  ] as const)('%s setter', (prop, setter, values) => {
    it(`should set ${prop} to various values`, () => {
      const { result } = renderHook(() => useLocalApiServer())
      values.forEach((val) => {
        act(() => { (result.current as any)[setter](val) })
        expect((result.current as any)[prop]).toBe(val)
      })
    })
  })

  describe('apiKey', () => {
    it('should set and clear API key', () => {
      const { result } = renderHook(() => useLocalApiServer())
      act(() => { result.current.setApiKey('some-key') })
      expect(result.current.apiKey).toBe('some-key')
      act(() => { result.current.setApiKey('') })
      expect(result.current.apiKey).toBe('')
    })
  })

  describe('trustedHosts', () => {
    it('should add, remove, and replace trusted hosts', () => {
      const { result } = renderHook(() => useLocalApiServer())

      act(() => { result.current.addTrustedHost('example.com') })
      act(() => { result.current.addTrustedHost('api.example.com') })
      expect(result.current.trustedHosts).toEqual(['example.com', 'api.example.com'])

      act(() => { result.current.removeTrustedHost('example.com') })
      expect(result.current.trustedHosts).toEqual(['api.example.com'])

      act(() => { result.current.removeTrustedHost('nonexistent.com') })
      expect(result.current.trustedHosts).toEqual(['api.example.com'])

      const newHosts = ['host1.com', 'host2.com', 'host3.com']
      act(() => { result.current.setTrustedHosts(newHosts) })
      expect(result.current.trustedHosts).toEqual(newHosts)

      act(() => { result.current.setTrustedHosts([]) })
      expect(result.current.trustedHosts).toEqual([])
    })
  })

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

  it('should preserve independent state changes', () => {
    const { result } = renderHook(() => useLocalApiServer())

    act(() => { result.current.setServerPort(9000) })
    expect(result.current.serverPort).toBe(9000)
    expect(result.current.serverHost).toBe('127.0.0.1')
    expect(result.current.apiPrefix).toBe('/v1')

    act(() => { result.current.setProxyTimeout(400) })
    expect(result.current.proxyTimeout).toBe(400)
    expect(result.current.serverPort).toBe(9000)
  })

  it('should handle edge cases in configuration values', () => {
    const { result } = renderHook(() => useLocalApiServer())

    act(() => { result.current.setApiPrefix('') })
    expect(result.current.apiPrefix).toBe('')

    act(() => { result.current.setApiPrefix('v1') })
    expect(result.current.apiPrefix).toBe('v1')

    act(() => { result.current.setServerPort(1) })
    expect(result.current.serverPort).toBe(1)

    act(() => { result.current.setServerPort(65535) })
    expect(result.current.serverPort).toBe(65535)
  })
})
