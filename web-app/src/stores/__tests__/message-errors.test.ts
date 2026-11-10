import { describe, it, expect, beforeEach } from 'vitest'
import { useMessageErrors } from '../message-errors'

describe('useMessageErrors reports', () => {
  beforeEach(() => useMessageErrors.getState().clearAll())

  it('keeps a diagnostics report with its error until the error is cleared', () => {
    const s = useMessageErrors.getState()
    s.setError('m1', 'boom')
    s.setReport('m1', '## Model load failure')
    expect(useMessageErrors.getState().reports.m1).toBe('## Model load failure')

    useMessageErrors.getState().clearError('m1')
    expect(useMessageErrors.getState().reports.m1).toBeUndefined()
  })

  it('drops reports when errors are hydrated from storage', () => {
    useMessageErrors.getState().setReport('m1', 'r')
    useMessageErrors.getState().hydrate({ m2: 'x' })
    expect(useMessageErrors.getState().reports).toEqual({})
  })
})
