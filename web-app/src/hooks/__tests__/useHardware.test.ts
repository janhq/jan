import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHardware, HardwareData, OS, RAM } from '../useHardware'

// Mock dependencies
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    settingHardware: 'hardware-storage-key',
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

describe('useHardware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with default hardware state', () => {
    const { result } = renderHook(() => useHardware())

    expect(result.current.hardwareData).toEqual({
      cpu: {
        arch: '',
        core_count: 0,
        extensions: [],
        name: '',
        usage: 0,
      },
      os_type: '',
      os_name: '',
      total_memory: 0,
    })
    expect(result.current.systemUsage).toEqual({
      cpu: 0,
      used_memory: 0,
      total_memory: 0,
    })
    expect(result.current.pollingPaused).toBe(false)
  })

  it('should set hardware data', () => {
    const { result } = renderHook(() => useHardware())

    const testHardwareData = {
      cpu: {
        arch: 'x86_64',
        core_count: 8,
        extensions: ['SSE', 'AVX'],
        name: 'Intel Core i7',
        usage: 25.5,
        instructions: [],
      },
      ram: {
        available: 0,
        total: 0,
      },
      os_type: 'linux',
      os_name: 'Ubuntu',
      total_memory: 17179869184,
    }

    act(() => {
      result.current.setHardwareData(testHardwareData)
    })

    expect(result.current.hardwareData).toEqual(testHardwareData)
  })

  it('should set CPU data', () => {
    const { result } = renderHook(() => useHardware())

    const testCPU = {
      arch: 'x86_64',
      core_count: 8,
      extensions: ['SSE', 'AVX'],
      name: 'Intel Core i7',
      usage: 25.5,
    }

    act(() => {
      result.current.setCPU(testCPU)
    })

    expect(result.current.hardwareData.cpu).toEqual(testCPU)
  })

  it('should update system usage', () => {
    const { result } = renderHook(() => useHardware())

    const testSystemUsage = {
      cpu: 45.2,
      used_memory: 8589934592,
      total_memory: 17179869184,
    }

    act(() => {
      result.current.updateSystemUsage(testSystemUsage)
    })

    expect(result.current.systemUsage).toEqual(testSystemUsage)
  })

  it('should manage polling state', () => {
    const { result } = renderHook(() => useHardware())

    expect(result.current.pollingPaused).toBe(false)

    act(() => {
      result.current.pausePolling()
    })

    expect(result.current.pollingPaused).toBe(true)

    act(() => {
      result.current.resumePolling()
    })

    expect(result.current.pollingPaused).toBe(false)
  })

  describe('setOS', () => {
    it('should update OS data', () => {
      const { result } = renderHook(() => useHardware())

      const os: OS = {
        name: 'Windows',
        version: '11',
      }

      act(() => {
        result.current.setOS(os)
      })

      expect(result.current.hardwareData.os).toEqual(os)
    })
  })

  describe('setRAM', () => {
    it('should update RAM data', () => {
      const { result } = renderHook(() => useHardware())

      const ram: RAM = {
        available: 16384,
        total: 32768,
      }

      act(() => {
        result.current.setRAM(ram)
      })

      expect(result.current.hardwareData.ram).toEqual(ram)
    })
  })
})
