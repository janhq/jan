import { renderHook, act } from '@testing-library/react'
import { useAtom } from 'jotai'
import * as SystemBarAtoms from './SystemBar.atom'

describe('SystemBar.atom.ts', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('totalRamAtom', () => {
    it('should initialize as 0', () => {
      const { result } = renderHook(() => useAtom(SystemBarAtoms.totalRamAtom))
      expect(result.current[0]).toBe(0)
    })

    it('should update correctly', () => {
      const { result } = renderHook(() => useAtom(SystemBarAtoms.totalRamAtom))
      act(() => {
        result.current[1](16384)
      })
      expect(result.current[0]).toBe(16384)
    })
  })

  describe('usedRamAtom', () => {
    it('should initialize as 0', () => {
      const { result } = renderHook(() => useAtom(SystemBarAtoms.usedRamAtom))
      expect(result.current[0]).toBe(0)
    })

    it('should update correctly', () => {
      const { result } = renderHook(() => useAtom(SystemBarAtoms.usedRamAtom))
      act(() => {
        result.current[1](8192)
      })
      expect(result.current[0]).toBe(8192)
    })
  })

  describe('cpuUsageAtom', () => {
    it('should initialize as 0', () => {
      const { result } = renderHook(() => useAtom(SystemBarAtoms.cpuUsageAtom))
      expect(result.current[0]).toBe(0)
    })

    it('should update correctly', () => {
      const { result } = renderHook(() => useAtom(SystemBarAtoms.cpuUsageAtom))
      act(() => {
        result.current[1](50)
      })
      expect(result.current[0]).toBe(50)
    })
  })

  describe('ramUtilitizedAtom', () => {
    it('should initialize as 0', () => {
      const { result } = renderHook(() =>
        useAtom(SystemBarAtoms.ramUtilitizedAtom)
      )
      expect(result.current[0]).toBe(0)
    })

    it('should update correctly', () => {
      const { result } = renderHook(() =>
        useAtom(SystemBarAtoms.ramUtilitizedAtom)
      )
      act(() => {
        result.current[1](75)
      })
      expect(result.current[0]).toBe(75)
    })
  })

  describe('gpusAtom', () => {
    it('should initialize as an empty array', () => {
      const { result } = renderHook(() => useAtom(SystemBarAtoms.gpusAtom))
      expect(result.current[0]).toEqual([])
    })

    it('should update correctly', () => {
      const { result } = renderHook(() => useAtom(SystemBarAtoms.gpusAtom))
      const gpus = [{ id: 'gpu1' }, { id: 'gpu2' }]
      act(() => {
        result.current[1](gpus as any)
      })
      expect(result.current[0]).toEqual(gpus)
    })
  })

  describe('nvidiaTotalVramAtom', () => {
    it('should initialize as 0', () => {
      const { result } = renderHook(() =>
        useAtom(SystemBarAtoms.nvidiaTotalVramAtom)
      )
      expect(result.current[0]).toBe(0)
    })

    it('should update correctly', () => {
      const { result } = renderHook(() =>
        useAtom(SystemBarAtoms.nvidiaTotalVramAtom)
      )
      act(() => {
        result.current[1](8192)
      })
      expect(result.current[0]).toBe(8192)
    })
  })

  describe('availableVramAtom', () => {
    it('should initialize as 0', () => {
      const { result } = renderHook(() =>
        useAtom(SystemBarAtoms.availableVramAtom)
      )
      expect(result.current[0]).toBe(0)
    })

    it('should update correctly', () => {
      const { result } = renderHook(() =>
        useAtom(SystemBarAtoms.availableVramAtom)
      )
      act(() => {
        result.current[1](4096)
      })
      expect(result.current[0]).toBe(4096)
    })
  })

  describe('systemMonitorCollapseAtom', () => {
    it('should initialize as false', () => {
      const { result } = renderHook(() =>
        useAtom(SystemBarAtoms.systemMonitorCollapseAtom)
      )
      expect(result.current[0]).toBe(false)
    })

    it('should update correctly', () => {
      const { result } = renderHook(() =>
        useAtom(SystemBarAtoms.systemMonitorCollapseAtom)
      )
      act(() => {
        result.current[1](true)
      })
      expect(result.current[0]).toBe(true)
    })
  })
})
