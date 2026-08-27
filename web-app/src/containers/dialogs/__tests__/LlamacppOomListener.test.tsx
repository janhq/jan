import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { act } from '@testing-library/react'
import LlamacppOomListener from '../LlamacppOomListener'
import { useAppState } from '@/hooks/useAppState'
import { useCodeRun } from '@/hooks/useCodeRun'

let loadProgressHandler: ((event: { payload: unknown }) => void) | undefined
let unloadHandler: ((event: { payload: unknown }) => void) | undefined
let oomHandler: ((event: { payload: unknown }) => void) | undefined
let backendErrorHandler: ((event: { payload: unknown }) => void) | undefined

const invokeMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((eventName: string, handler: (event: { payload: unknown }) => void) => {
    if (eventName === 'llamacpp-model-load-progress') {
      loadProgressHandler = handler
    }
    if (eventName === 'llamacpp-model-unloaded') {
      unloadHandler = handler
    }
    if (eventName === 'llamacpp-router-oom') {
      oomHandler = handler
    }
    if (eventName === 'llamacpp-router-backend-error') {
      backendErrorHandler = handler
    }
    return Promise.resolve(() => {})
  }),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
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

describe('LlamacppOomListener - Cowork session attribution', () => {
  beforeEach(() => {
    loadProgressHandler = undefined
    oomHandler = undefined
    backendErrorHandler = undefined
    invokeMock.mockClear()
    act(() => {
      useCodeRun.setState({
        llamacppRuns: {},
        runId: {},
        pendingLlamacppError: {},
        loadingModels: {},
        modelLoadProgress: {},
      })
    })
  })

  it('forwards load progress only to the session(s) loading that model, by id', async () => {
    act(() => {
      useCodeRun.setState({
        llamacppRuns: { 'session-a': 'model-1', 'session-b': 'model-2' },
      })
    })
    render(<LlamacppOomListener />)
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      loadProgressHandler?.({ payload: { model: 'model-1', value: 0.5 } })
    })

    expect(useCodeRun.getState().modelLoadProgress['session-a']).toEqual(
      { modelId: 'model-1', stage: undefined, value: 0.5 }
    )
    expect(useCodeRun.getState().loadingModels['session-a']).toBe(true)
    // session-b is loading a different model — must not see model-1's progress.
    expect(useCodeRun.getState().modelLoadProgress['session-b']).toBeUndefined()
    // Cowork's own load state must never touch chat's Records — that's the
    // exact cross-contamination this separate Record exists to avoid (see
    // useCodeRun.loadingModels).
    expect(useAppState.getState().loadingModels['session-a']).toBeUndefined()
    expect(
      useAppState.getState().modelLoadProgressByThread['session-a']
    ).toBeUndefined()
  })

  it('stashes a friendly message and cancels the run on OOM', async () => {
    act(() => {
      useCodeRun.setState({
        llamacppRuns: { 'session-a': 'model-1' },
        runId: { 'session-a': 'run-123' },
      })
    })
    render(<LlamacppOomListener />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(oomHandler).toBeDefined()
    act(() => {
      oomHandler?.({ payload: 'llama.cpp ran out of memory' })
    })

    expect(useCodeRun.getState().pendingLlamacppError['session-a']).toBe(
      'llama.cpp ran out of memory'
    )
    expect(invokeMock).toHaveBeenCalledWith('agent_cancel', { runId: 'run-123' })
  })

  it('mirrors the same attribution for a backend error', async () => {
    act(() => {
      useCodeRun.setState({
        llamacppRuns: { 'session-a': 'model-1' },
        runId: { 'session-a': 'run-123' },
      })
    })
    render(<LlamacppOomListener />)
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      backendErrorHandler?.({ payload: 'GGML backend encountered an error' })
    })

    expect(useCodeRun.getState().pendingLlamacppError['session-a']).toBe(
      'GGML backend encountered an error'
    )
    expect(invokeMock).toHaveBeenCalledWith('agent_cancel', { runId: 'run-123' })
  })

  it('is a no-op when no Cowork session is running against llamacpp', async () => {
    render(<LlamacppOomListener />)
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      oomHandler?.({ payload: 'llama.cpp ran out of memory' })
    })

    expect(useCodeRun.getState().pendingLlamacppError).toEqual({})
    expect(invokeMock).not.toHaveBeenCalledWith('agent_cancel', expect.anything())
  })

  it('does not attribute to a session tracked as llamacpp-using but whose run already ended', async () => {
    // llamacppRuns not yet cleared, but runId has no entry — a stale/already-
    // finished session must not be cancelled or stamped.
    act(() => {
      useCodeRun.setState({ llamacppRuns: { 'session-a': 'model-1' }, runId: {} })
    })
    render(<LlamacppOomListener />)
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      oomHandler?.({ payload: 'llama.cpp ran out of memory' })
    })

    expect(useCodeRun.getState().pendingLlamacppError).toEqual({})
    expect(invokeMock).not.toHaveBeenCalled()
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
