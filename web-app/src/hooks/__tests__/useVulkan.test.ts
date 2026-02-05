import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVulkan } from '../useVulkan'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    settingVulkan: 'vulkan-settings',
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

describe('useVulkan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to defaults
    const store = useVulkan.getState()
    store.setVulkanEnabled(false)
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useVulkan())

    expect(result.current.vulkanEnabled).toBe(false)
    expect(typeof result.current.setVulkanEnabled).toBe('function')
    expect(typeof result.current.toggleVulkan).toBe('function')
  })

  describe('setVulkanEnabled', () => {
    it('should enable Vulkan', () => {
      const { result } = renderHook(() => useVulkan())

      act(() => {
        result.current.setVulkanEnabled(true)
      })

      expect(result.current.vulkanEnabled).toBe(true)
    })

    it('should disable Vulkan', () => {
      const { result } = renderHook(() => useVulkan())

      // First enable it
      act(() => {
        result.current.setVulkanEnabled(true)
      })

      expect(result.current.vulkanEnabled).toBe(true)

      // Then disable it
      act(() => {
        result.current.setVulkanEnabled(false)
      })

      expect(result.current.vulkanEnabled).toBe(false)
    })

    it('should handle multiple state changes', () => {
      const { result } = renderHook(() => useVulkan())

      const testSequence = [true, false, true, true, false]

      testSequence.forEach((enabled) => {
        act(() => {
          result.current.setVulkanEnabled(enabled)
        })

        expect(result.current.vulkanEnabled).toBe(enabled)
      })
    })
  })

  describe('toggleVulkan', () => {
    it('should toggle from false to true', () => {
      const { result } = renderHook(() => useVulkan())

      expect(result.current.vulkanEnabled).toBe(false)

      act(() => {
        result.current.toggleVulkan()
      })

      expect(result.current.vulkanEnabled).toBe(true)
    })

    it('should toggle from true to false', () => {
      const { result } = renderHook(() => useVulkan())

      // First enable Vulkan
      act(() => {
        result.current.setVulkanEnabled(true)
      })

      expect(result.current.vulkanEnabled).toBe(true)

      // Then toggle it
      act(() => {
        result.current.toggleVulkan()
      })

      expect(result.current.vulkanEnabled).toBe(false)
    })

    it('should toggle multiple times correctly', () => {
      const { result } = renderHook(() => useVulkan())

      // Start with false
      expect(result.current.vulkanEnabled).toBe(false)

      // Toggle to true
      act(() => {
        result.current.toggleVulkan()
      })
      expect(result.current.vulkanEnabled).toBe(true)

      // Toggle to false
      act(() => {
        result.current.toggleVulkan()
      })
      expect(result.current.vulkanEnabled).toBe(false)

      // Toggle to true again
      act(() => {
        result.current.toggleVulkan()
      })
      expect(result.current.vulkanEnabled).toBe(true)

      // Toggle to false again
      act(() => {
        result.current.toggleVulkan()
      })
      expect(result.current.vulkanEnabled).toBe(false)
    })
  })

  describe('state persistence', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useVulkan())
      const { result: result2 } = renderHook(() => useVulkan())

      act(() => {
        result1.current.setVulkanEnabled(true)
      })

      expect(result2.current.vulkanEnabled).toBe(true)

      act(() => {
        result2.current.toggleVulkan()
      })

      expect(result1.current.vulkanEnabled).toBe(false)
      expect(result2.current.vulkanEnabled).toBe(false)
    })
  })

  describe('mixed operations', () => {
    it('should handle combinations of setVulkanEnabled and toggleVulkan', () => {
      const { result } = renderHook(() => useVulkan())

      // Start with default false
      expect(result.current.vulkanEnabled).toBe(false)

      // Set to true
      act(() => {
        result.current.setVulkanEnabled(true)
      })
      expect(result.current.vulkanEnabled).toBe(true)

      // Toggle (should become false)
      act(() => {
        result.current.toggleVulkan()
      })
      expect(result.current.vulkanEnabled).toBe(false)

      // Toggle again (should become true)
      act(() => {
        result.current.toggleVulkan()
      })
      expect(result.current.vulkanEnabled).toBe(true)

      // Set to false explicitly
      act(() => {
        result.current.setVulkanEnabled(false)
      })
      expect(result.current.vulkanEnabled).toBe(false)
    })

    it('should handle setting the same value multiple times', () => {
      const { result } = renderHook(() => useVulkan())

      // Set to true multiple times
      act(() => {
        result.current.setVulkanEnabled(true)
        result.current.setVulkanEnabled(true)
        result.current.setVulkanEnabled(true)
      })
      expect(result.current.vulkanEnabled).toBe(true)

      // Set to false multiple times
      act(() => {
        result.current.setVulkanEnabled(false)
        result.current.setVulkanEnabled(false)
        result.current.setVulkanEnabled(false)
      })
      expect(result.current.vulkanEnabled).toBe(false)
    })
  })
})
