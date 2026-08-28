import { describe, it, expect, beforeEach } from 'vitest'
import { useCoworkRun } from '../useCoworkRun'

// Covers only the llamacpp-attribution slice (llamacppRuns/pendingLlamacppError)
// added for Cowork's model-load/OOM feedback parity with regular chat — see
// LlamacppOomListener.test.tsx for how a Tauri event actually drives these.
describe('useCoworkRun - llamacpp attribution', () => {
  beforeEach(() => {
    useCoworkRun.setState({
      llamacppRuns: {},
      pendingLlamacppError: {},
      runId: {},
      loadingModels: {},
      modelLoadProgress: {},
    })
  })

  it('tracks and clears which session is running which model', () => {
    useCoworkRun.getState().setLlamacppRun('session-a', 'model-1')
    expect(useCoworkRun.getState().llamacppRuns).toEqual({ 'session-a': 'model-1' })

    useCoworkRun.getState().clearLlamacppRun('session-a')
    expect(useCoworkRun.getState().llamacppRuns).toEqual({})
  })

  it('clearLlamacppRun on an untracked session is a no-op, not a crash', () => {
    expect(() => useCoworkRun.getState().clearLlamacppRun('nobody')).not.toThrow()
    expect(useCoworkRun.getState().llamacppRuns).toEqual({})
  })

  it('takePendingLlamacppError reads and clears in one step', () => {
    useCoworkRun.getState().setPendingLlamacppError('session-a', 'oom')

    expect(useCoworkRun.getState().takePendingLlamacppError('session-a')).toBe('oom')
    // Consumed — a second take (e.g. a duplicate finally-block run) must not
    // re-apply the same message twice.
    expect(useCoworkRun.getState().takePendingLlamacppError('session-a')).toBeUndefined()
    expect(useCoworkRun.getState().pendingLlamacppError).toEqual({})
  })

  it('takePendingLlamacppError on a session with nothing pending returns undefined', () => {
    expect(useCoworkRun.getState().takePendingLlamacppError('idle-session')).toBeUndefined()
  })

  it('does not cross-attribute between two sessions running different models', () => {
    useCoworkRun.getState().setLlamacppRun('session-a', 'model-1')
    useCoworkRun.getState().setLlamacppRun('session-b', 'model-2')
    useCoworkRun.getState().setPendingLlamacppError('session-a', 'oom')

    expect(useCoworkRun.getState().llamacppRuns).toEqual({
      'session-a': 'model-1',
      'session-b': 'model-2',
    })
    expect(useCoworkRun.getState().takePendingLlamacppError('session-b')).toBeUndefined()
    expect(useCoworkRun.getState().takePendingLlamacppError('session-a')).toBe('oom')
  })

  it('clearCodeRun sweeps up llamacppRuns and pendingLlamacppError for that session too', () => {
    useCoworkRun.getState().setLlamacppRun('session-a', 'model-1')
    useCoworkRun.getState().setPendingLlamacppError('session-a', 'oom')

    useCoworkRun.getState().clearCodeRun('session-a')

    expect(useCoworkRun.getState().llamacppRuns).toEqual({})
    expect(useCoworkRun.getState().pendingLlamacppError).toEqual({})
  })
})

describe('useCoworkRun - per-session loading state', () => {
  beforeEach(() => {
    useCoworkRun.setState({ loadingModels: {}, modelLoadProgress: {} })
  })

  it('sets and unsets the loading flag per session', () => {
    useCoworkRun.getState().setSessionLoadingModel('session-a', true)
    expect(useCoworkRun.getState().loadingModels).toEqual({ 'session-a': true })

    useCoworkRun.getState().setSessionLoadingModel('session-a', false)
    // Absent, not `false` — mirrors useAppState's own loadingModels
    // convention (key presence, not a boolean value, is the signal).
    expect(useCoworkRun.getState().loadingModels).toEqual({})
  })

  it('sets and clears load progress per session', () => {
    useCoworkRun
      .getState()
      .setSessionModelLoadProgress('session-a', { modelId: 'model-1', value: 0.4 })
    expect(useCoworkRun.getState().modelLoadProgress['session-a']).toEqual({
      modelId: 'model-1',
      value: 0.4,
    })

    useCoworkRun.getState().setSessionModelLoadProgress('session-a', undefined)
    expect(useCoworkRun.getState().modelLoadProgress).toEqual({})
  })

  it('keeps two sessions\' loading state independent', () => {
    useCoworkRun.getState().setSessionLoadingModel('session-a', true)
    useCoworkRun.getState().setSessionLoadingModel('session-b', true)

    useCoworkRun.getState().setSessionLoadingModel('session-a', false)

    expect(useCoworkRun.getState().loadingModels).toEqual({ 'session-b': true })
  })

  it('clearCodeRun sweeps up per-session loading state too', () => {
    useCoworkRun.getState().setSessionLoadingModel('session-a', true)
    useCoworkRun
      .getState()
      .setSessionModelLoadProgress('session-a', { modelId: 'model-1', value: 0.4 })

    useCoworkRun.getState().clearCodeRun('session-a')

    expect(useCoworkRun.getState().loadingModels).toEqual({})
    expect(useCoworkRun.getState().modelLoadProgress).toEqual({})
  })
})

describe('useCoworkRun - subagent lanes', () => {
  it('empties only the given session at the start of a run', () => {
    useCoworkRun.getState().startSubagent('s1', 'r1', 'researcher')
    useCoworkRun.getState().startSubagent('s2', 'r2', 'reviewer')
    useCoworkRun.getState().resetSubagents('s1')
    expect(useCoworkRun.getState().subagents.s1).toEqual([])
    // A background session's children must survive another session's new run.
    expect(useCoworkRun.getState().subagents.s2).toHaveLength(1)
  })

  it('keeps concurrent children in separate lanes', () => {
    useCoworkRun.getState().resetSubagents('s3')
    useCoworkRun.getState().startSubagent('s3', 'a', 'one')
    useCoworkRun.getState().startSubagent('s3', 'b', 'two')
    useCoworkRun.getState().routeIntoSubagent('s3', 'a', {
      type: 'token',
      text: 'from a',
    })
    const runs = useCoworkRun.getState().subagents.s3
    expect(runs.find((r) => r.runId === 'a')?.turns[0].content).toBe('from a')
    expect(runs.find((r) => r.runId === 'b')?.turns).toEqual([])
  })
})
