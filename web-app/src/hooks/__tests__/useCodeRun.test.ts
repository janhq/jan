import { describe, it, expect, beforeEach } from 'vitest'
import { useCodeRun } from '../useCodeRun'

// Covers only the llamacpp-attribution slice (llamacppRuns/pendingLlamacppError)
// added for Cowork's model-load/OOM feedback parity with regular chat — see
// LlamacppOomListener.test.tsx for how a Tauri event actually drives these.
describe('useCodeRun - llamacpp attribution', () => {
  beforeEach(() => {
    useCodeRun.setState({
      llamacppRuns: {},
      pendingLlamacppError: {},
      runId: {},
      loadingModels: {},
      modelLoadProgress: {},
    })
  })

  it('tracks and clears which session is running which model', () => {
    useCodeRun.getState().setLlamacppRun('session-a', 'model-1')
    expect(useCodeRun.getState().llamacppRuns).toEqual({ 'session-a': 'model-1' })

    useCodeRun.getState().clearLlamacppRun('session-a')
    expect(useCodeRun.getState().llamacppRuns).toEqual({})
  })

  it('clearLlamacppRun on an untracked session is a no-op, not a crash', () => {
    expect(() => useCodeRun.getState().clearLlamacppRun('nobody')).not.toThrow()
    expect(useCodeRun.getState().llamacppRuns).toEqual({})
  })

  it('takePendingLlamacppError reads and clears in one step', () => {
    useCodeRun.getState().setPendingLlamacppError('session-a', 'oom')

    expect(useCodeRun.getState().takePendingLlamacppError('session-a')).toBe('oom')
    // Consumed — a second take (e.g. a duplicate finally-block run) must not
    // re-apply the same message twice.
    expect(useCodeRun.getState().takePendingLlamacppError('session-a')).toBeUndefined()
    expect(useCodeRun.getState().pendingLlamacppError).toEqual({})
  })

  it('takePendingLlamacppError on a session with nothing pending returns undefined', () => {
    expect(useCodeRun.getState().takePendingLlamacppError('idle-session')).toBeUndefined()
  })

  it('does not cross-attribute between two sessions running different models', () => {
    useCodeRun.getState().setLlamacppRun('session-a', 'model-1')
    useCodeRun.getState().setLlamacppRun('session-b', 'model-2')
    useCodeRun.getState().setPendingLlamacppError('session-a', 'oom')

    expect(useCodeRun.getState().llamacppRuns).toEqual({
      'session-a': 'model-1',
      'session-b': 'model-2',
    })
    expect(useCodeRun.getState().takePendingLlamacppError('session-b')).toBeUndefined()
    expect(useCodeRun.getState().takePendingLlamacppError('session-a')).toBe('oom')
  })

  it('clearCodeRun sweeps up llamacppRuns and pendingLlamacppError for that session too', () => {
    useCodeRun.getState().setLlamacppRun('session-a', 'model-1')
    useCodeRun.getState().setPendingLlamacppError('session-a', 'oom')

    useCodeRun.getState().clearCodeRun('session-a')

    expect(useCodeRun.getState().llamacppRuns).toEqual({})
    expect(useCodeRun.getState().pendingLlamacppError).toEqual({})
  })
})

describe('useCodeRun - per-session loading state', () => {
  beforeEach(() => {
    useCodeRun.setState({ loadingModels: {}, modelLoadProgress: {} })
  })

  it('sets and unsets the loading flag per session', () => {
    useCodeRun.getState().setSessionLoadingModel('session-a', true)
    expect(useCodeRun.getState().loadingModels).toEqual({ 'session-a': true })

    useCodeRun.getState().setSessionLoadingModel('session-a', false)
    // Absent, not `false` — mirrors useAppState's own loadingModels
    // convention (key presence, not a boolean value, is the signal).
    expect(useCodeRun.getState().loadingModels).toEqual({})
  })

  it('sets and clears load progress per session', () => {
    useCodeRun
      .getState()
      .setSessionModelLoadProgress('session-a', { modelId: 'model-1', value: 0.4 })
    expect(useCodeRun.getState().modelLoadProgress['session-a']).toEqual({
      modelId: 'model-1',
      value: 0.4,
    })

    useCodeRun.getState().setSessionModelLoadProgress('session-a', undefined)
    expect(useCodeRun.getState().modelLoadProgress).toEqual({})
  })

  it('keeps two sessions\' loading state independent', () => {
    useCodeRun.getState().setSessionLoadingModel('session-a', true)
    useCodeRun.getState().setSessionLoadingModel('session-b', true)

    useCodeRun.getState().setSessionLoadingModel('session-a', false)

    expect(useCodeRun.getState().loadingModels).toEqual({ 'session-b': true })
  })

  it('clearCodeRun sweeps up per-session loading state too', () => {
    useCodeRun.getState().setSessionLoadingModel('session-a', true)
    useCodeRun
      .getState()
      .setSessionModelLoadProgress('session-a', { modelId: 'model-1', value: 0.4 })

    useCodeRun.getState().clearCodeRun('session-a')

    expect(useCodeRun.getState().loadingModels).toEqual({})
    expect(useCodeRun.getState().modelLoadProgress).toEqual({})
  })
})
