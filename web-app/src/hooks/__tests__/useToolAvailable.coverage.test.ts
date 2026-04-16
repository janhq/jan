import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/lib/fileStorage', () => ({
  fileStorage: {
    getItem: vi.fn(() => Promise.resolve(null)),
    setItem: vi.fn(() => Promise.resolve()),
    removeItem: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    toolAvailability: 'tool-availability-settings',
  },
}))

import { useToolAvailable } from '../useToolAvailable'

describe('useToolAvailable - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToolAvailable.setState({
      disabledTools: {},
      defaultDisabledTools: [],
      defaultsInitialized: false,
    })
  })

  it('isDefaultsInitialized should return false initially', () => {
    const { result } = renderHook(() => useToolAvailable())
    expect(result.current.isDefaultsInitialized()).toBe(false)
  })

  it('markDefaultsAsInitialized should set flag', () => {
    const { result } = renderHook(() => useToolAvailable())

    act(() => {
      result.current.markDefaultsAsInitialized()
    })

    expect(result.current.isDefaultsInitialized()).toBe(true)
  })

  it('should test migrate function with old format keys', () => {
    const persistApi = (useToolAvailable as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    if (migrate) {
      const oldState = {
        disabledTools: { 't1': ['oldTool'] },
        defaultDisabledTools: ['oldDefault'],
        defaultsInitialized: true,
      }
      const migrated = migrate(oldState)
      expect(migrated.disabledTools).toEqual({})
      expect(migrated.defaultDisabledTools).toEqual([])
      expect(migrated.defaultsInitialized).toBe(false)
    }
  })

  it('should test migrate function with new format keys', () => {
    const persistApi = (useToolAvailable as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    if (migrate) {
      const newState = {
        disabledTools: { 't1': ['server::tool'] },
        defaultDisabledTools: ['server::default'],
        defaultsInitialized: true,
      }
      const migrated = migrate(newState)
      expect(migrated.disabledTools).toEqual({ 't1': ['server::tool'] })
      expect(migrated.defaultDisabledTools).toEqual(['server::default'])
      expect(migrated.defaultsInitialized).toBe(true)
    }
  })

  it('should test migrate with null state', () => {
    const persistApi = (useToolAvailable as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    if (migrate) {
      const migrated = migrate(null)
      expect(migrated).toBeNull()
    }
  })

  it('should test migrate with non-object state', () => {
    const persistApi = (useToolAvailable as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    if (migrate) {
      const migrated = migrate('string')
      expect(migrated).toBe('string')
    }
  })
})
