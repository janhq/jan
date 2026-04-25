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

// Mock ExtensionManager
vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(),
  },
}))

describe('useGeneralSetting - coverage improvements', () => {
  let mockExtensionManager: any

  beforeEach(async () => {
    vi.clearAllMocks()

    const { ExtensionManager } = await import('@/lib/extension')
    mockExtensionManager = ExtensionManager

    useGeneralSetting.setState({
      currentLanguage: 'en',
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      huggingfaceToken: undefined,
    })

    mockExtensionManager.getInstance.mockReturnValue({
      getByName: vi.fn().mockReturnValue({
        getSettings: vi.fn().mockResolvedValue(null),
        updateSettings: vi.fn(),
      }),
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

  describe('setHuggingfaceToken edge cases', () => {
    it('should handle when getByName returns null', async () => {
      mockExtensionManager.getInstance.mockReturnValue({
        getByName: vi.fn().mockReturnValue(null),
      })

      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setHuggingfaceToken('token-123')
      })

      // Token is still set in state even if extension is null
      expect(result.current.huggingfaceToken).toBe('token-123')
    })

    it('should handle when getSettings returns empty array', async () => {
      const mockUpdateSettings = vi.fn()
      mockExtensionManager.getInstance.mockReturnValue({
        getByName: vi.fn().mockReturnValue({
          getSettings: vi.fn().mockResolvedValue([]),
          updateSettings: mockUpdateSettings,
        }),
      })

      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setHuggingfaceToken('token-abc')
      })

      expect(result.current.huggingfaceToken).toBe('token-abc')

      await new Promise((resolve) => setTimeout(resolve, 0))

      // updateSettings called with empty array (no hf-token setting to update)
      expect(mockUpdateSettings).toHaveBeenCalledWith([])
    })

    it('should handle when getSettings rejects', async () => {
      mockExtensionManager.getInstance.mockReturnValue({
        getByName: vi.fn().mockReturnValue({
          getSettings: vi.fn().mockRejectedValue(new Error('fail')),
          updateSettings: vi.fn(),
        }),
      })

      const { result } = renderHook(() => useGeneralSetting())

      // Should not throw
      act(() => {
        result.current.setHuggingfaceToken('token')
      })

      expect(result.current.huggingfaceToken).toBe('token')
    })

    it('should update only hf-token in settings and leave others unchanged', async () => {
      const mockSettings = [
        { key: 'hf-token', controllerProps: { value: '' } },
        { key: 'download-dir', controllerProps: { value: '/tmp' } },
        { key: 'max-concurrent', controllerProps: { value: 3 } },
      ]

      const mockUpdateSettings = vi.fn()
      mockExtensionManager.getInstance.mockReturnValue({
        getByName: vi.fn().mockReturnValue({
          getSettings: vi.fn().mockResolvedValue(mockSettings),
          updateSettings: mockUpdateSettings,
        }),
      })

      const { result } = renderHook(() => useGeneralSetting())

      act(() => {
        result.current.setHuggingfaceToken('my-new-token')
      })

      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockUpdateSettings).toHaveBeenCalledWith([
        { key: 'hf-token', controllerProps: { value: 'my-new-token' } },
        { key: 'download-dir', controllerProps: { value: '/tmp' } },
        { key: 'max-concurrent', controllerProps: { value: 3 } },
      ])
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
