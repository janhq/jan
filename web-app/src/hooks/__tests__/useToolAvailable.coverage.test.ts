import { describe, it, expect, beforeEach, vi } from 'vitest'

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
    useToolAvailable.setState({ disabledTools: [] })
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
      expect(migrated).toEqual({ disabledTools: ['exa::web_fetch_exa'] })
    })

    it('drops old pre-:: keys', () => {
      const migrate = getMigrate()!
      const migrated = migrate(
        { defaultDisabledTools: ['legacyTool'], defaultsInitialized: true },
        1
      )
      expect(migrated.disabledTools).toEqual([])
    })

    it('null/empty persisted state migrates to an empty global set', () => {
      const migrate = getMigrate()!
      expect(migrate(null, 1).disabledTools).toEqual([])
    })

    it('a v2 state passes through unchanged', () => {
      const migrate = getMigrate()!
      const state = { disabledTools: ['a::b'] }
      expect(migrate(state, 2)).toEqual(state)
    })
  })
})
