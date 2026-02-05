import { describe, it, expect } from 'vitest'
import { windowKey } from '../windows'

describe('windows constants', () => {
  it('should export correct window keys', () => {
    expect(windowKey).toBeDefined()
    expect(typeof windowKey).toBe('object')
  })

  it('should have logsAppWindow key', () => {
    expect(windowKey.logsAppWindow).toBe('logs-app-window')
  })

  it('should have logsWindowLocalApiServer key', () => {
    expect(windowKey.logsWindowLocalApiServer).toBe('logs-window-local-api-server')
  })

  it('should have systemMonitorWindow key', () => {
    expect(windowKey.systemMonitorWindow).toBe('system-monitor-window')
  })

  it('should have all required keys', () => {
    const expectedKeys = ['logsAppWindow', 'logsWindowLocalApiServer', 'systemMonitorWindow']
    const actualKeys = Object.keys(windowKey)
    
    expect(actualKeys).toEqual(expect.arrayContaining(expectedKeys))
    expect(actualKeys.length).toBe(expectedKeys.length)
  })

  it('should have string values for all keys', () => {
    Object.values(windowKey).forEach(value => {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
    })
  })
})
