import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { act } from '@testing-library/react'
import LlamacppOomListener from '../LlamacppOomListener'
import { useAppState } from '@/hooks/useAppState'

let loadProgressHandler: ((event: { payload: unknown }) => void) | undefined
let unloadHandler: ((event: { payload: unknown }) => void) | undefined

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((eventName: string, handler: (event: { payload: unknown }) => void) => {
    if (eventName === 'llamacpp-model-load-progress') {
      loadProgressHandler = handler
    }
    if (eventName === 'llamacpp-model-unloaded') {
      unloadHandler = handler
    }
    return Promise.resolve(() => {})
  }),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => true,
}))

describe('LlamacppOomListener - model load progress', () => {
  beforeEach(() => {
    loadProgressHandler = undefined
    act(() => {
      useAppState.setState({
        modelLoadProgress: undefined,
        modelLoadProgressByThread: {},
        currentStreamThreadId: undefined,
      })
    })
  })

  it('updates global model load progress on event', async () => {
    render(<LlamacppOomListener />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(loadProgressHandler).toBeDefined()
    act(() => {
      loadProgressHandler?.({
        payload: {
          model: 'model-1',
          stage: 'mmproj_model',
          stages: ['text_model', 'mmproj_model'],
          value: 0.75,
        },
      })
    })

    expect(useAppState.getState().modelLoadProgress).toEqual({
      modelId: 'model-1',
      stage: 'mmproj_model',
      stages: ['text_model', 'mmproj_model'],
      value: 0.75,
    })
  })

  it('also updates per-thread progress when a stream thread is active', async () => {
    act(() => {
      useAppState.setState({ currentStreamThreadId: 'thread-1' })
    })
    render(<LlamacppOomListener />)
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      loadProgressHandler?.({
        payload: { model: 'model-1', value: 0.3 },
      })
    })

    expect(useAppState.getState().modelLoadProgressByThread['thread-1']).toEqual({
      modelId: 'model-1',
      stage: undefined,
      value: 0.3,
    })
  })
})

describe('LlamacppOomListener - model unloaded', () => {
  beforeEach(() => {
    unloadHandler = undefined
    act(() => {
      useAppState.setState({ activeModels: ['model-1', 'model-2'] })
    })
  })

  it('removes the unloaded model from activeModels', async () => {
    render(<LlamacppOomListener />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(unloadHandler).toBeDefined()
    act(() => {
      unloadHandler?.({ payload: { model: 'model-1', exit_code: 0 } })
    })

    expect(useAppState.getState().activeModels).toEqual(['model-2'])
  })

  it('is a no-op when the unloaded model was already reconciled', async () => {
    act(() => {
      useAppState.setState({ activeModels: ['model-2'] })
    })
    render(<LlamacppOomListener />)
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      unloadHandler?.({ payload: { model: 'model-1', exit_code: 137 } })
    })

    expect(useAppState.getState().activeModels).toEqual(['model-2'])
  })
})
