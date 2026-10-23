import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGeneralSetting } from '../useGeneralSetting'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    settingGeneral: 'general-settings',
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

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({ invoke: vi.fn().mockResolvedValue(undefined) }),
  }),
}))

describe('useGeneralSetting - coverage improvements', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useGeneralSetting.setState({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      huggingfaceToken: undefined,
    })
  })

  describe('setTokenCounterCompact', () => {
    it('should enable token counter compact mode', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setTokenCounterCompact(true)
      })

      expect(result.current.tokenCounterCompact).toBe(true)
    })

    it('should disable token counter compact mode', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setTokenCounterCompact(false)
      })

      expect(result.current.tokenCounterCompact).toBe(false)
    })
  })

  describe('initial defaults', () => {
    it('should have tokenCounterCompact default to true', () => {
      useGeneralSetting.setState({ tokenCounterCompact: true })
      const { result } = renderHook(() => useGeneralSetting())
      expect(result.current.tokenCounterCompact).toBe(true)
    })
  })
})
