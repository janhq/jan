import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockInvoke, mockRefresh, mockLogInfo, mockLogError } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockRefresh: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogError: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('@/lib/logger', () => ({
  logInfo: mockLogInfo,
  logError: mockLogError,
}))

import { useOllamaLifecycleController } from '../useOllamaLifecycleController'

describe('useOllamaLifecycleController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefresh.mockResolvedValue(undefined)
  })

  it('drives starting to running and disables re-toggle while reconciling', async () => {
    let release!: () => void
    mockInvoke.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    const { result } = renderHook(() =>
      useOllamaLifecycleController({
        isInstalled: true,
        isRunning: false,
        refresh: mockRefresh,
      })
    )

    void act(() => {
      void result.current.setDesiredRunning(true)
    })

    expect(result.current.phase).toBe('starting')
    expect(result.current.switchChecked).toBe(true)
    expect(result.current.switchDisabled).toBe(true)

    release()

    await waitFor(() => {
      expect(result.current.phase).toBe('running')
    })
  })

  it('falls back to error while keeping the last stable switch position when reconciliation fails', async () => {
    mockInvoke.mockRejectedValue(new Error('Timed out'))

    const { result } = renderHook(() =>
      useOllamaLifecycleController({
        isInstalled: true,
        isRunning: true,
        refresh: mockRefresh,
      })
    )

    await act(async () => {
      await result.current.setDesiredRunning(false)
    })

    expect(result.current.phase).toBe('error')
    expect(result.current.switchChecked).toBe(true)
    expect(result.current.errorMessage).toContain('未达到期望状态')
    expect(mockLogError).toHaveBeenCalled()
  })

  it('surfaces backend permission guidance when stop fails due to privilege mismatch', async () => {
    mockInvoke.mockRejectedValue(
      new Error(
        'Failed to stop Ollama because Windows denied terminating one or more Ollama processes. This usually means Ollama is running with higher privileges than RongxinAI/Jan. Restart RongxinAI as administrator or restart Ollama without administrator privileges.'
      )
    )

    const { result } = renderHook(() =>
      useOllamaLifecycleController({
        isInstalled: true,
        isRunning: true,
        refresh: mockRefresh,
      })
    )

    await act(async () => {
      await result.current.setDesiredRunning(false)
    })

    expect(result.current.phase).toBe('error')
    expect(result.current.errorMessage).toContain('higher privileges')
  })
})
