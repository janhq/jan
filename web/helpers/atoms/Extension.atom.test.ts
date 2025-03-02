// Extension.atom.test.ts

import { act, renderHook } from '@testing-library/react'
import * as ExtensionAtoms from './Extension.atom'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

describe('Extension.atom.ts', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('inActiveEngineProviderAtom', () => {
    it('should initialize as an empty array', () => {
      const { result } = renderHook(() => useAtomValue(ExtensionAtoms.inActiveEngineProviderAtom))
      expect(result.current).toEqual([])
    })

    it('should persist value in storage', () => {
      const { result } = renderHook(() => useAtom(ExtensionAtoms.inActiveEngineProviderAtom))
      
      act(() => {
        result.current[1](['provider1', 'provider2'])
      })

      // Simulate a re-render to check if the value persists
      const { result: newResult } = renderHook(() => useAtomValue(ExtensionAtoms.inActiveEngineProviderAtom))
      expect(newResult.current).toEqual(['provider1', 'provider2'])
    })
  })
})
