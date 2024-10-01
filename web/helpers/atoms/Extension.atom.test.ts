// Extension.atom.test.ts

import { act, renderHook } from '@testing-library/react'
import * as ExtensionAtoms from './Extension.atom'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

describe('Extension.atom.ts', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('installingExtensionAtom', () => {
    it('should initialize as an empty array', () => {
      const { result } = renderHook(() => useAtomValue(ExtensionAtoms.installingExtensionAtom))
      expect(result.current).toEqual([])
    })
  })

  describe('setInstallingExtensionAtom', () => {
    it('should add a new installing extension', () => {
      const { result: setAtom } = renderHook(() => useSetAtom(ExtensionAtoms.setInstallingExtensionAtom))
      const { result: getAtom } = renderHook(() => useAtomValue(ExtensionAtoms.installingExtensionAtom))

      act(() => {
        setAtom.current('ext1', { extensionId: 'ext1', percentage: 0 })
      })

      expect(getAtom.current).toEqual([{ extensionId: 'ext1', percentage: 0 }])
    })

    it('should update an existing installing extension', () => {
      const { result: setAtom } = renderHook(() => useSetAtom(ExtensionAtoms.setInstallingExtensionAtom))
      const { result: getAtom } = renderHook(() => useAtomValue(ExtensionAtoms.installingExtensionAtom))

      act(() => {
        setAtom.current('ext1', { extensionId: 'ext1', percentage: 0 })
        setAtom.current('ext1', { extensionId: 'ext1', percentage: 50 })
      })

      expect(getAtom.current).toEqual([{ extensionId: 'ext1', percentage: 50 }])
    })
  })

  describe('removeInstallingExtensionAtom', () => {
    it('should remove an installing extension', () => {
      const { result: setAtom } = renderHook(() => useSetAtom(ExtensionAtoms.setInstallingExtensionAtom))
      const { result: removeAtom } = renderHook(() => useSetAtom(ExtensionAtoms.removeInstallingExtensionAtom))
      const { result: getAtom } = renderHook(() => useAtomValue(ExtensionAtoms.installingExtensionAtom))

      act(() => {
        setAtom.current('ext1', { extensionId: 'ext1', percentage: 0 })
        setAtom.current('ext2', { extensionId: 'ext2', percentage: 50 })
        removeAtom.current('ext1')
      })

      expect(getAtom.current).toEqual([{ extensionId: 'ext2', percentage: 50 }])
    })
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
