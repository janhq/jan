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

// Mock ServiceHub (setHuggingfaceToken persists to the keyring via set_secret)
const mockInvoke = vi.fn().mockResolvedValue(undefined)
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke: mockInvoke }) }),
}))

describe('useGeneralSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset store state to defaults
    useGeneralSetting.setState({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      huggingfaceToken: undefined,
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useGeneralSetting())

    expect(result.current.currentLanguage).toBe('en')
    expect(result.current.spellCheckChatInput).toBe(true)
    expect(result.current.huggingfaceToken).toBeUndefined()
    expect(typeof result.current.setCurrentLanguage).toBe('function')
    expect(typeof result.current.setSpellCheckChatInput).toBe('function')
    expect(typeof result.current.setHuggingfaceToken).toBe('function')
  })

  describe('setCurrentLanguage', () => {
    it('should set language to English', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setCurrentLanguage('en')
      })

      expect(result.current.currentLanguage).toBe('en')
    })

    it('should set language to Indonesian', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setCurrentLanguage('id')
      })

      expect(result.current.currentLanguage).toBe('id')
    })

    it('should set language to Vietnamese', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setCurrentLanguage('vn')
      })

      expect(result.current.currentLanguage).toBe('vn')
    })

    it('should change language multiple times', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setCurrentLanguage('id')
      })
      expect(result.current.currentLanguage).toBe('id')

      act(() => {
        result.current.setCurrentLanguage('vn')
      })
      expect(result.current.currentLanguage).toBe('vn')

      act(() => {
        result.current.setCurrentLanguage('en')
      })
      expect(result.current.currentLanguage).toBe('en')
    })
  })

  describe('setSpellCheckChatInput', () => {
    it('should enable spell check', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setSpellCheckChatInput(true)
      })

      expect(result.current.spellCheckChatInput).toBe(true)
    })

    it('should disable spell check', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setSpellCheckChatInput(false)
      })

      expect(result.current.spellCheckChatInput).toBe(false)
    })

    it('should toggle spell check multiple times', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setSpellCheckChatInput(false)
      })
      expect(result.current.spellCheckChatInput).toBe(false)

      act(() => {
        result.current.setSpellCheckChatInput(true)
      })
      expect(result.current.spellCheckChatInput).toBe(true)
    })
  })

  describe('setHuggingfaceToken', () => {
    it('should set huggingface token', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setHuggingfaceToken('test-token-123')
      })

      expect(result.current.huggingfaceToken).toBe('test-token-123')
      expect(mockInvoke).toHaveBeenCalledWith('set_secret', {
        key: 'huggingface',
        value: 'test-token-123',
      })
    })

    it('should update huggingface token', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setHuggingfaceToken('old-token')
      })
      expect(result.current.huggingfaceToken).toBe('old-token')

      act(() => {
        result.current.setHuggingfaceToken('new-token')
      })
      expect(result.current.huggingfaceToken).toBe('new-token')
    })

    it('should handle empty token', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setHuggingfaceToken('')
      })

      expect(result.current.huggingfaceToken).toBe('')
    })

    it('writes the token only to the keyring', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setHuggingfaceToken('new-token')
      })

      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(mockInvoke).toHaveBeenCalledWith('set_secret', {
        key: 'huggingface',
        value: 'new-token',
      })
    })
  })

  describe('state management', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useGeneralSetting())
      const { result: result2 } = renderHook(() => useGeneralSetting())

      act(() => {
        result1.current.setCurrentLanguage('id')
        result1.current.setSpellCheckChatInput(false)
        result1.current.setHuggingfaceToken('shared-token')
      })

      expect(result2.current.currentLanguage).toBe('id')
      expect(result2.current.spellCheckChatInput).toBe(false)
      expect(result2.current.huggingfaceToken).toBe('shared-token')
    })
  })

  describe('complex scenarios', () => {
    it('should handle complete settings configuration', () => {
      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setCurrentLanguage('vn')
        result.current.setSpellCheckChatInput(false)
        result.current.setHuggingfaceToken('complex-token-123')
      })

      expect(result.current.currentLanguage).toBe('vn')
      expect(result.current.spellCheckChatInput).toBe(false)
      expect(result.current.huggingfaceToken).toBe('complex-token-123')
    })

    it('should handle multiple sequential updates', () => {
      const { result } = renderHook(() => useGeneralSetting())

      // First update
      act(() => {
        result.current.setCurrentLanguage('id')
        result.current.setSpellCheckChatInput(false)
      })

      expect(result.current.currentLanguage).toBe('id')
      expect(result.current.spellCheckChatInput).toBe(false)

      // Second update
      act(() => {
        result.current.setHuggingfaceToken('sequential-token')
      })

      expect(result.current.huggingfaceToken).toBe('sequential-token')

      // Third update
      act(() => {
        result.current.setCurrentLanguage('en')
        result.current.setSpellCheckChatInput(true)
      })

      expect(result.current.currentLanguage).toBe('en')
      expect(result.current.spellCheckChatInput).toBe(true)
    })
  })
})
