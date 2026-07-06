import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    toolAvailability: 'tool-availability-settings',
  },
}))

import { useToolAvailable } from '../useToolAvailable'

type Migrate = (state: unknown, version: number) => any

const getMigrate = (): Migrate | undefined =>
  (useToolAvailable as any).persist?.getOptions().migrate

describe('useToolAvailable - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useToolAvailable.setState({ disabledTools: [], defaultsInitialized: false })
  })

  it('isDefaultsInitialized starts false; mark flips it', () => {
    const { result } = renderHook(() => useToolAvailable())
    expect(result.current.isDefaultsInitialized()).toBe(false)
    act(() => result.current.markDefaultsAsInitialized())
    expect(result.current.isDefaultsInitialized()).toBe(true)
  })

  describe('v1 -> v2 migration (per-thread -> global)', () => {
    it('collapses onto the previous global default and drops per-thread overrides', () => {
      const migrate = getMigrate()!
      const migrated = migrate(
        {
          disabledTools: { t1: ['exa::web_search_exa'] },
          defaultDisabledTools: ['exa::web_fetch_exa'],
          defaultsInitialized: true,
        },
        1
      )
      expect(migrated.disabledTools).toEqual(['exa::web_fetch_exa'])
      expect(migrated.defaultsInitialized).toBe(true)
    })

    it('re-seeds (defaultsInitialized=false) when old pre-:: keys are dropped', () => {
      const migrate = getMigrate()!
      const migrated = migrate(
        { defaultDisabledTools: ['legacyTool'], defaultsInitialized: true },
        1
      )
      expect(migrated.disabledTools).toEqual([])
      expect(migrated.defaultsInitialized).toBe(false)
    })

    it('null/empty persisted state migrates to an empty global set', () => {
      const migrate = getMigrate()!
      expect(migrate(null, 1).disabledTools).toEqual([])
    })

    it('a v2 state passes through unchanged', () => {
      const migrate = getMigrate()!
      const state = { disabledTools: ['a::b'], defaultsInitialized: true }
      expect(migrate(state, 2)).toEqual(state)
    })
  })
})
